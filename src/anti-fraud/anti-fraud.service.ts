import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import CircuitBreaker from 'opossum';
import { CheckTransactionDto } from './dto/check-transaction.dto';
import { FraudAlert, FraudAlertDocument } from './schemas/fraud-alert.schema';

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

  async checkTransactionRisk(data: CheckTransactionDto): Promise<boolean> {
    const isFraud = data.amount > 2000;
    if (isFraud) {
      await this.createAlert(data, 'Transaction denied.');
      await this.blockUserAccount(data.origin);
      return true;
    }
    return false;
  }

  async checkTransactionHistory(data: CheckTransactionDto): Promise<void> {
    try {
      const history = await this.fetchUserHistory(data.origin);
      const isSuspicious = this.analyzeHistoryPatterns(history);
      if (isSuspicious) {
        await this.createAlert(
          data,
          'Anomalous transaction history detected',
        );
        await this.blockUserAccount(data.origin);
      }
    } catch (error) {
      const errMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed during history check: ${errMessage}`);
    }
  }

  private async fetchUserHistory(iban: string): Promise<any[]> {
    const bankStatementsUrl =
      this.configService.get<string>('BANK_STATEMENTS_MS_URL') ||
      'http://localhost:3005';
    const response = await lastValueFrom(
      this.httpService.get(`${bankStatementsUrl}/v1/bankstatemens/${iban}`),
    );

    return response.data;
  }

  private analyzeHistoryPatterns(history: any[]): boolean {
    if (history && Array.isArray(history) && history.length > 10) {
      return true;
    }
    return false;
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

  private async sendNotification(
    origin: string,
    message: string,
  ): Promise<void> {
    try {
      const notificationsServiceUrl =
        this.configService.get<string>('NOTIFICATIONS_MS_URL') ||
        'http://localhost:3004';
      await lastValueFrom(
        this.httpService.post(`${notificationsServiceUrl}/v1/notifications`, {
          origin: origin,
          message: message,
          source: 'ANTI_FRAUD_SERVICE',
        }),
      );
    } catch (error) {
      this.logger.error(
        `FAILED to send notification with message ${message} and error`,
        error,
      );
    }
  }

  private async createAlert(
    data: CheckTransactionDto,
    reason: string,
  ): Promise<void> {
    try {
      await this.alertModel.create({
        origin: data.origin,
        destination: data.destination,
        amount: data.amount,
        reason: reason,
        status: 'PENDING',
      });

      await this.sendNotification(data.origin, `Fraud Alert: ${reason}`);
    } catch (error) {
      this.logger.error(
        `FAILED to create alert with reason ${reason} and error`,
        error,
      );
    }
  }

  async getAlertsForAccount(iban: string) {
    this.logger.log(`Searching alerts for IBAN: ${iban}`);
    const alerts = await this.alertModel.find({ origin: iban }).exec();
    if (!alerts || alerts.length === 0) {
      throw new NotFoundException(`No alerts found for account: ${iban}`);
    }
    return alerts;
  }
}
