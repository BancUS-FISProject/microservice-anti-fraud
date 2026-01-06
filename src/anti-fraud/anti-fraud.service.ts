/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
  Inject,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { jwtDecode } from 'jwt-decode';
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
  AccountView,
  AccountViewDocument,
} from './schemas/account.view.schema';

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

interface AccountItem {
  iban: string;
  isBlocked?: string;
}

interface AccountsResponse {
  items: AccountItem[];
  page: number;
  size: number;
  total: number;
}

@Injectable()
export class AntiFraudService {
  private readonly logger = new Logger(AntiFraudService.name);
  private readonly blockAccountBreaker: CircuitBreaker<[string, string], void>;
  private readonly blockRequestTimeoutMs: number;

  constructor(
    @InjectModel(FraudAlert.name) private alertModel: Model<FraudAlertDocument>,
    @InjectModel(AccountView.name)
    private accountViewModel: Model<AccountViewDocument>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.blockRequestTimeoutMs =
      Number(this.configService.get<number>('ACCOUNTS_BLOCK_TIMEOUT_MS')) ||
      3000;

    this.blockAccountBreaker = new CircuitBreaker(
      (iban: string, token: string) => this.performBlockRequest(iban, token),
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

  async checkTransactionRisk(
    data: CheckTransactionDto,
    token: string,
  ): Promise<boolean> {
    try {
      const cleanToken = token.replace('Bearer ', '').trim();
      const decoded: any = jwtDecode(cleanToken);

      // IMPORTANTE: Verifica con tu compañero cómo se llama el campo del IBAN en el token.
      // Puede ser 'iban', 'sub', 'account', 'userId'... Aquí asumo 'iban'.
      const tokenIban = decoded.iban || decoded.userId || decoded.sub;

      if (!tokenIban) {
        this.logger.log('Token without IBAN/ID used.');
      }
      // Opcional: Si quieres ser estricto y asegurar que el dueño del token es el origen:
      else if (tokenIban !== data.origin) {
        throw new ForbiddenException(
          `You are not authorized to inspect account ${data.origin}`,
        );
      }
    } catch (error) {
      this.logger.error('Error decoding token:', error);
      // Decidimos si bloqueamos o seguimos. Por seguridad, mejor fallar si el token es basura.
      throw new UnauthorizedException('Invalid token format');
    }

    this.logger.log(
      `Analyzing Transaction: ${data.amount}€ | Origin: ${data.origin}`,
    );
    const accountExists = await this.validateAccountExists(data.origin, token);
    if (!accountExists) {
      this.logger.log(
        `Transaction analisys aborted: Origin account ${data.origin} does not exist in the system.`,
      );
      throw new BadRequestException(
        `Origin account ${data.origin} is not a valid account in our system.`,
      );
    }

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
        const history = await this.fetchUserHistory(data.origin, token);
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
          this.logger.log(
            `REPEATED TRANSFERS WITH HIGH VALUE DETECTED (${recentHighValueCount} times). Blocking account.`,
          );
          if (initialAlert) {
            await this.updateAlert(initialAlert._id.toString(), {
              status: AlertStatus.CONFIRMED,
              reason: `Several recent high amount transactions detected: ${recentHighValueCount + 1} times in last ${MONTHS_LOOKBACK} months.`,
            });
          }
          await this.blockUserAccount(data.origin, token);
          await this.notificateUser(
            data.origin,
            ` Account blocked: several recent high amount transactions detected: ${recentHighValueCount + 1} times in last ${MONTHS_LOOKBACK} months.`,
          );
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

  private async validateAccountExists(
    iban: string,
    token: string,
  ): Promise<boolean> {
    // 1. We try to retrieve the data from the materialized view
    const localAccount = await this.accountViewModel.findOne({ iban }).exec();
    if (localAccount) return true;

    // 2. If we don't find it, we update the MV calling the endpoint.
    this.logger.log(
      `Account ${iban} not found in materialized view. Retrieving accounts from accounts microservice.`,
    );
    try {
      await this.syncMaterializedView(token);

      // Once the MV is updated, we try to look up for the account in the view again.
      const recheck = await this.accountViewModel.findOne({ iban }).exec();
      return Boolean(recheck);
    } catch (error) {
      // If the service is not working, we assume the account exists to avoid possible fraud problems.
      this.logger.error(
        `Sync failed. Assuming account does not exists.`,
        error,
      );
      return true;
    }
  }

  private async syncMaterializedView(token: string): Promise<void> {
    const accountsServiceUrl =
      this.configService.get<string>('ACCOUNTS_MS_URL') ||
      'http://microservice-accounts:8000';
    const response = await lastValueFrom(
      this.httpService.get<AccountsResponse>(
        `${accountsServiceUrl}/v1/accounts`,
        { headers: { Authorization: token } },
      ),
    );
    const accounts = response.data.items;

    if (!accounts?.length) return;

    // Update old registers and add new ones to the MV.
    const ops = accounts.map((acc) => ({
      updateOne: {
        filter: { iban: acc.iban },
        update: { $set: { iban: acc.iban, status: acc.isBlocked } },
        upsert: true,
      },
    }));

    await this.accountViewModel.bulkWrite(ops);
    this.logger.log(`${ops.length} accounts syncronized .`);
  }

  private async fetchUserHistory(
    iban: string,
    token: string,
  ): Promise<TransactionItem[]> {
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
          {
            headers: { Authorization: token },
          },
        ),
      );
      const transactions = response.data;

      // Save the data in caché with a ttl of 24 hours.
      //const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
      const ONE_MINUTE_MS = 60 * 1000;
      await this.cacheManager.set(cacheKey, transactions, ONE_MINUTE_MS);
      return transactions;
    } catch (error) {
      const errMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to fetch history. Error: ${errMessage}`);
      const axiosError = error as AxiosError;
      if (axiosError.response && axiosError.response.status === 404) return [];
      throw error;
    }
  }

  private async blockUserAccount(iban: string, token: string): Promise<void> {
    await this.blockAccountBreaker.fire(iban, token);
  }

  private async notificateUser(iban: string, reason: string): Promise<void> {
    const notificationsServiceUrl =
      this.configService.get<string>('NOTIFICATIONS_MS_URL') ||
      'http://microservice-notifications:8000';

    const payload = {
      userId: iban,
      type: 'fraud-detected',
      metadata: {
        reason: reason,
        account: iban,
      },
    };
    try {
      await lastValueFrom(
        this.httpService.post(
          `${notificationsServiceUrl}/v1/notifications/events`,
          payload,
        ),
      );
      this.logger.log(`Notification sent for account ${iban}`);
    } catch (error) {
      this.logger.error(
        `Failed to send notification for account ${iban}: ${error.message}`,
        error.stack,
      );
    }
  }

  private async performBlockRequest(
    iban: string,
    token: string,
  ): Promise<void> {
    const accountsServiceUrl =
      this.configService.get<string>('ACCOUNTS_MS_URL') ||
      'http://microservice-accounts:8000';
    await lastValueFrom(
      this.httpService.patch(
        `${accountsServiceUrl}/v1/accounts/${iban}/block`,
        {},
        {
          headers: { Authorization: token },
          timeout: this.blockRequestTimeoutMs,
        },
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
    const isIban = /^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/;
    if (!isIban.test(iban)) {
      throw new BadRequestException(`Invalid IBAN format: ${iban}`);
    }
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
