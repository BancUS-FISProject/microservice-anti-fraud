import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
  Inject,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { lastValueFrom } from 'rxjs';
import CircuitBreaker from 'opossum';
import { AxiosError } from 'axios';
import { CheckTransactionDto } from './dto/check-transaction.dto';
import { FraudAlert, FraudAlertDocument } from './schemas/fraud-alert.schema';
import { UpdateFraudAlertDto, AlertStatus } from './dto/update-fraud-alert.dto';
import {
  TransactionHistoryView,
  TransactionHistoryViewDocument,
} from './schemas/transaction-history.view.schema';

//Interfaz para evitar problemas con linter.
interface TransactionItem {
  id: string;
  currency: string;
  date: string;
  quantity: number;
  sender: string;
  receiver: string;
  sender_balance: number;
  receiver_balance: number;
  status: string;
}

@Injectable()
export class AntiFraudService {
  private readonly logger = new Logger(AntiFraudService.name);
  private readonly blockAccountBreaker: CircuitBreaker<[string], void>;
  private readonly blockRequestTimeoutMs: number;

  constructor(
    @InjectModel(FraudAlert.name) private alertModel: Model<FraudAlertDocument>,
    @InjectModel(TransactionHistoryView.name)
    private historyViewModel: Model<TransactionHistoryViewDocument>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.blockRequestTimeoutMs =
      Number(this.configService.get<number>('ACCOUNTS_BLOCK_TIMEOUT_MS')) ||
      3000;

    this.blockAccountBreaker = new CircuitBreaker(
      (iban: string) => this.performBlockRequest(iban),
      {
        timeout: this.blockRequestTimeoutMs, // corta la llamada lenta
        errorThresholdPercentage: 50, // abre si el 50% fallan
        resetTimeout: 10000, // vuelve a probar tras 10s
        volumeThreshold: 5, // mínimo de solicitudes antes de evaluar
      },
    );

    this.blockAccountBreaker.fallback((iban: string) => {
      this.logger.error(
        `Circuit breaker fallback: could not block account ${iban}.`,
      );
    });

    this.blockAccountBreaker.on('open', () =>
      this.logger.warn('[Breaker] Block account circuit open'),
    );
    this.blockAccountBreaker.on('halfOpen', () =>
      this.logger.warn('[Breaker] Block account circuit half-open'),
    );
    this.blockAccountBreaker.on('close', () =>
      this.logger.log('[Breaker] Block account circuit closed'),
    );
  }

  // POST: Check transaction

  async checkTransactionRisk(data: CheckTransactionDto): Promise<boolean> {
    this.logger.log(
      `Analyzing Transaction: ${data.amount}€ | Origin: ${data.origin}`,
    );
    const isSuspicious = data.amount > 2000;
    if (isSuspicious) {
      this.logger.log(
        `High amount detected (>2000€). Investigating history for account ${data.origin}`,
      );

      const initialAlert = await this.createAlert(
        data,
        `Suspicious transaction detected: high money amount transferred.`,
      );
      try {
        const MONTHS_LOOKBACK = 2;
        const history = await this.fetchUserHistory(data.origin);
        const limitDate = new Date(data.transactionDate);
        limitDate.setMonth(limitDate.getMonth() - MONTHS_LOOKBACK);

        // 2. Count how many times this account moved > 2000€
        const recentHighValueCount = history.filter((tx: TransactionItem) => {
          const txDate = new Date(tx.date);
          const txAmount = tx.quantity;
          const isRecent = txDate >= limitDate;
          const isHighAmount = txAmount > 2000;

          return isRecent && isHighAmount;
        }).length;

        this.logger.log(
          `Found ${recentHighValueCount} previous high-value transactions.`,
        );

        if (recentHighValueCount >= 2) {
          this.logger.warn(
            `REPEATED HIGH VALUE DETECTED (${recentHighValueCount} times). Blocking account.`,
          );
          if (initialAlert) {
            await this.updateAlert(initialAlert._id.toString(), {
              status: AlertStatus.CONFIRMED,
              reason: `Several recent high amount transactions detected: ${recentHighValueCount + 1} times in last ${MONTHS_LOOKBACK} months.`,
            });
          }
          await this.blockUserAccount(data.origin);
          return true;
        }
      } catch (error) {
        const errMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(
          `Failed to fetch history during check. Error: ${errMessage}`,
        );
        if (initialAlert) {
          await this.updateAlert(initialAlert._id.toString(), {
            reason: `High transaction amount detected and unable to retrieve previous records. Error: ${errMessage}`,
            status: AlertStatus.REVIEWED,
          });
        }
        throw new InternalServerErrorException(
          'Could not verify transaction history',
        );
      }
    }
    return false;
  }

  private async fetchUserHistory(iban: string): Promise<TransactionItem[]> {
    const cacheKey = `history:${iban}`;

    // First we try to retrieve the history from cache.
    const cachedHistory =
      await this.cacheManager.get<TransactionItem[]>(cacheKey);
    if (cachedHistory) {
      this.logger.log(`REDIS HIT: History for ${iban} retrieved from memory.`);
      return cachedHistory;
    }

    this.logger.log(`REDIS MISS: Fetching external data for ${iban}...`);

    try {
      // We try to call the transfer microservice.
      const transactionsServiceUrl =
        this.configService.get<string>('TRANSFERS_MS_URL') ||
        'http://microservice-transfers:8000';
      const response = await lastValueFrom(
        this.httpService.get<TransactionItem[]>(
          `${transactionsServiceUrl}/v1/transactions/user/${iban}`,
        ),
      );
      const transactions = response.data;

      // Save the data in caché with a ttl of 24 hours.
      //const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
      const ONE_MINUTE_MS = 60 * 1000;
      await this.cacheManager.set(cacheKey, transactions, ONE_MINUTE_MS);

      // We save the data in the materialized view for auditory purposes.
      this.updateMaterializedView(iban, transactions).catch((err) =>
        this.logger.error('Failed to update Mongo view', err),
      );

      return transactions;
    } catch (error) {
      // If the endpoint call fails, we take the data from the materialized view.
      this.logger.warn(
        `External API Failed. Trying to rescue data from Mongo Materialized View`,
      );

      const mongoView = await this.historyViewModel
        .findOne({ origin: iban })
        .exec();

      if (mongoView) {
        this.logger.log(`Loaded history from persistent backup.`);

        return mongoView.transactions as unknown as TransactionItem[];
      }

      // If we don't have any data at all, we just show a not found history message.
      const axiosError = error as AxiosError;
      if (axiosError.response && axiosError.response.status === 404) return [];
      throw error;
    }
  }

  private async blockUserAccount(iban: string): Promise<void> {
    await this.blockAccountBreaker.fire(iban);
  }

  private async performBlockRequest(iban: string): Promise<void> {
    const accountsServiceUrl =
      this.configService.get<string>('ACCOUNTS_MS_URL') ||
      'http://microservice-accounts:8000';
    await lastValueFrom(
      this.httpService.patch(
        `${accountsServiceUrl}/v1/accounts/${iban}/block`,
        {},
        { timeout: this.blockRequestTimeoutMs },
      ),
    );
  }

  private async createAlert(
    data: CheckTransactionDto,
    reason: string,
  ): Promise<FraudAlertDocument | null> {
    try {
      const newAlert = await this.alertModel.create({
        origin: data.origin,
        destination: data.destination,
        amount: data.amount,
        transactionDate: data.transactionDate,
        reason: reason,
        status: 'PENDING',
      });

      return newAlert;
    } catch (error) {
      this.logger.error(
        `FAILED to create alert with reason ${reason} and error`,
        error,
      );
      return null;
    }
  }

  // Materialized view function
  private async updateMaterializedView(
    iban: string,
    transactions: TransactionItem[],
  ) {
    try {
      await this.historyViewModel.findOneAndUpdate(
        { origin: iban },
        {
          origin: iban,
          transactions: transactions,
        },
        { upsert: true, new: true }, // Opciones: Create if it doesn't exists.
      );
      this.logger.log(`Materialized View updated for ${iban}`);
    } catch (err) {
      this.logger.error(`Failed to update materialized view`, err);
    }
  }

  // GET - Retrieve fraud alerts registered by the system.

  async getAlertsForAccount(iban: string) {
    this.logger.log(`Searching alerts for IBAN: ${iban}`);
    const alerts = await this.alertModel.find({ origin: iban }).exec();
    if (!alerts || alerts.length === 0) {
      throw new NotFoundException(`No alerts found for account: ${iban}`);
    }
    return alerts;
  }

  // PUT - Update registered alert's data.
  async updateAlert(id: string, updateData: UpdateFraudAlertDto) {
    this.logger.log(
      `Updating alert ${id} with data: ${JSON.stringify(updateData)}`,
    );
    const updatedAlert = await this.alertModel
      .findByIdAndUpdate(id, updateData, { new: true })
      .exec();
    if (!updatedAlert) {
      throw new NotFoundException(`Alert with ID ${id} not found`);
    }
    return updatedAlert;
  }

  //DELETE - Delete an specified registered alert.
  async deleteAlert(id: string) {
    this.logger.log(`Deleting alert ${id}...`);
    const deletedAlert = await this.alertModel.findByIdAndDelete(id).exec();
    if (!deletedAlert) {
      throw new NotFoundException(`Alert with ID ${id} not found`);
    }
    return { message: 'Alert deleted successfully', id };
  }
}
