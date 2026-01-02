import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import CircuitBreaker from 'opossum';
import { AxiosError } from 'axios';
import { CheckTransactionDto } from './dto/check-transaction.dto';
import { FraudAlert, FraudAlertDocument } from './schemas/fraud-alert.schema';
import { UpdateFraudAlertDto, AlertStatus } from './dto/update-fraud-alert.dto';

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
    const transactionsServiceUrl =
      this.configService.get<string>('TRANSFERS_MS_URL') ||
      'http://microservice-transfers:8000';

    this.logger.log(`Fetching full history for ${iban}...`);

    try {
      const response = await lastValueFrom(
        this.httpService.get<TransactionItem[]>(
          `${transactionsServiceUrl}/v1/transactions/user/${iban}`,
        ),
      );
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response && axiosError.response.status === 404) {
        this.logger.log(`No history found for IBAN ${iban}.`);
        return [];
      }
      this.logger.error(
        `Error fetching history from ${transactionsServiceUrl}: ${axiosError.message}`,
      );
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
