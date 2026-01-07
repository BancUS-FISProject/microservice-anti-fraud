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
    this.validateIdentity(token, data.origin);
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
    // 2. Initial alert created.
    const initialAlert = await this.createAlert(
      data,
      `Suspicious transaction detected: high money amount transferred.`,
    );
    const alertId = initialAlert ? initialAlert._id.toString() : null;

    try {
      // RULE 1: Inmediate detection (> 2000 transaction will automatically block the account)
      if (data.amount > 2000) {
        this.logger.log(
          `High amount detected (>2000€). Investigating history for account ${data.origin}`,
        );
        await this.performFraudBlock(
          alertId,
          data.origin,
          `Suspicious transaction detected: high money amount transferred.`,
          ` Account blocked: Suspicious transaction detected: high money amount transferred.`,
          token,
        );
        return true;
      }

      // RULE 2: Pattern detection (> 1000€ transaction in less than 2 months)
      const history = await this.fetchUserHistory(data.origin, token);
      const { count, monthsLookback } = this.calculateHighValueCount(
        history,
        data.transactionDate,
      );
      this.logger.log(`Found ${count} previous high-value transactions.`);
      if (count >= 2) {
        this.logger.log(
          `REPEATED TRANSFERS WITH HIGH VALUE DETECTED (${count} times). Blocking account.`,
        );
        const reasonString = `Several recent high amount transactions detected: ${count + 1} times in last ${monthsLookback} months.`;
        const notificationString = ` Account blocked: several recent high amount transactions detected: ${count + 1} times in last ${monthsLookback} months.`;
        await this.performFraudBlock(
          alertId,
          data.origin,
          reasonString,
          notificationString,
          token,
        );
        return true;
      }
      // RESULT: Safe transaction
      await this.finalizeSafeAnalysis(alertId, token);
      return false;
    } catch (error) {
      const errMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to fetch history during check. Error: ${errMessage}`,
      );
      if (alertId) {
        // Tu texto de error original
        await this.updateAlert(
          alertId,
          {
            reason: `High transaction amount detected and unable to retrieve previous records. Error: ${errMessage}`,
            status: AlertStatus.REVIEWED,
          },
          token,
        );
      }
      throw new InternalServerErrorException(
        'Could not verify transaction history',
      );
    }
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

  private async performFraudBlock(
    alertId: string | null,
    origin: string,
    alertReason: string,
    notificationReason: string,
    token: string,
  ): Promise<void> {
    if (alertId) {
      await this.updateAlert(
        alertId,
        {
          status: AlertStatus.CONFIRMED,
          reason: alertReason,
        },
        token,
      );
    }
    await this.blockUserAccount(origin, token);
    await this.notificateUser(origin, notificationReason);
  }

  private calculateHighValueCount(
    history: TransactionItem[],
    transactionDateDto: string | number | Date,
  ): { count: number; monthsLookback: number } {
    const MONTHS_LOOKBACK = 2;
    const limitDate = new Date(transactionDateDto);
    limitDate.setMonth(limitDate.getMonth() - MONTHS_LOOKBACK);
    const count = history.filter((tx: TransactionItem) => {
      const txDate = new Date(tx.date);
      const txAmount = tx.quantity;
      const isRecent = txDate >= limitDate;
      const isHighAmount = txAmount > 1000;
      return isRecent && isHighAmount;
    }).length;
    return { count, monthsLookback: MONTHS_LOOKBACK };
  }

  private async finalizeSafeAnalysis(
    alertId: string | null,
    token: string,
  ): Promise<void> {
    if (alertId) {
      await this.updateAlert(
        alertId,
        {
          status: AlertStatus.REVIEWED,
          reason: 'Risk analysis passed.',
        },
        token,
      );
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

  private validateIdentity(token: string, targetIban: string): void {
    try {
      const cleanToken = token.replace('Bearer ', '').trim();
      const decoded: any = jwtDecode(cleanToken);
      const tokenIban = decoded.iban || decoded.userId || decoded.sub;
      if (!tokenIban) {
        throw new UnauthorizedException('Invalid token: No identity found.');
      }
      if (tokenIban !== targetIban) {
        throw new ForbiddenException(
          `You are not authorized to access data for account ${targetIban}`,
        );
      }
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }
      this.logger.error('Token validation failed', error);
      throw new UnauthorizedException('Invalid token format');
    }
  }

  // GET - Retrieve fraud alerts registered by the system.

  async getAlertsForAccount(iban: string, token: string) {
    this.validateIdentity(token, iban);
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
  async updateAlert(
    id: string,
    updateFraudAlertDto: UpdateFraudAlertDto,
    token: string,
  ) {
    const alert = await this.alertModel.findById(id).exec();
    if (!alert) {
      throw new NotFoundException(`Alert with ID ${id} not found`);
    }
    this.validateIdentity(token, alert.origin);
    return this.alertModel
      .findByIdAndUpdate(id, updateFraudAlertDto, { new: true })
      .exec();
  }

  //DELETE - Delete an specified registered alert.
  async deleteAlert(id: string, token: string) {
    const alert = await this.alertModel.findById(id).exec();
    if (!alert) {
      throw new NotFoundException(`Alert with ID ${id} not found`);
    }
    this.validateIdentity(token, alert.origin);
    await this.alertModel.findByIdAndDelete(id).exec();
    return { message: 'Alert deleted successfully', id };
  }
}
