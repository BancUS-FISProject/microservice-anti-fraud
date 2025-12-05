import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { CheckTransactionDto } from './dto/check-transaction.dto';
import { FraudAlert, FraudAlertDocument } from './schemas/fraud-alert.schema';

@Injectable()
export class AntiFraudService {
  private readonly logger = new Logger(AntiFraudService.name);

  constructor(
    @InjectModel(FraudAlert.name) private alertModel: Model<FraudAlertDocument>,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @Inject('BANK_STATEMENTS_SERVICE')
    private readonly bankStatementsClient: ClientProxy,
  ) {}

  async checkTransactionRisk(data: CheckTransactionDto): Promise<boolean> {
    const isFraud = data.amount > 2000;
    if (isFraud) {
      await this.createAlert(data, 'Fraud attempt', 'Transaction denied.');
      await this.blockUserAccount(
        data.userId,
        data.transactionId,
        'Sending account block order',
      );
      return true;
    }
    return false;
  }

  async checkTransactionHistory(data: CheckTransactionDto): Promise<void> {
    try {
      const history = await this.fetchUserHistory(data.userId);
      // B. Analizar patrones
      const isSuspicious = this.analyzeHistoryPatterns(history);
      if (isSuspicious) {
        await this.createAlert(
          data,
          'FRAUDULENT_BEHAVIOR',
          'Anomalous transaction history detected',
        );
        await this.blockUserAccount(
          data.userId,
          data.transactionId,
          'History Pattern Anomaly',
        );
      }
    } catch (error) {
      const errMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed during history check: ${errMessage}`);
    }
  }

  private async fetchUserHistory(userId: number): Promise<any[]> {
    // .send(patrón, datos) -> Envía un mensaje y espera una respuesta.
    // El servicio de historial debe tener un @MessagePattern('get_history')
    return await lastValueFrom(
      this.bankStatementsClient.send({ cmd: 'get_history' }, { userId }),
    );
  }

  private analyzeHistoryPatterns(history: any[]): boolean {
    if (history && Array.isArray(history) && history.length > 10) {
      return true;
    }
    return false;
  }

  private async blockUserAccount(
    userId: number,
    reasonTxId: number,
    reasonMsg: string,
  ): Promise<void> {
    try {
      const accountsServiceUrl =
        this.configService.get<string>('ACCOUNTS_MS_URL') ||
        'http://localhost:3002';
      await lastValueFrom(
        this.httpService.patch(
          `${accountsServiceUrl}/v1/accounts/${userId}/block`,
          {
            reason: `Anti-Fraud System: ${reasonMsg}`,
            referenceTransactionId: reasonTxId,
          },
        ),
      );
    } catch (error) {
      this.logger.error(`FAILED to block user ${userId}`, error);
    }
  }

  private async sendNotification(
    userId: number,
    message: string,
    type: string,
  ): Promise<void> {
    try {
      const notificationsServiceUrl =
        this.configService.get<string>('NOTIFICATIONS_MS_URL') ||
        'http://localhost:3004';
      await lastValueFrom(
        this.httpService.post(`${notificationsServiceUrl}/v1/notifications`, {
          userId: userId,
          message: message,
          type: type,
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
    type: string,
    reason: string,
  ): Promise<void> {
    try {
      await this.alertModel.create({
        userId: data.userId,
        transactionId: data.transactionId,
        source: 'SYSTEM_DETECTED',
        type: type,
        reason: reason,
        status: 'PENDING',
      });

      await this.sendNotification(data.userId, `Fraud Alert: ${reason}`, type);
    } catch (error) {
      this.logger.error(
        `FAILED to create alert with reason ${reason} and error`,
        error,
      );
    }
  }

  async getAlertsForUser(userId: number) {
    return this.alertModel.find({ userId: userId }).exec();
  }
}
