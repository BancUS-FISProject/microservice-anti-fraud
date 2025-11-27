import { Injectable, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CheckTransactionDto } from './dto/check-transaction.dto';
import { FraudAlert, FraudAlertDocument } from './schemas/fraud-alert.schema';

@Injectable()
export class AntiFraudService {

  constructor(
    @InjectModel(FraudAlert.name) private alertModel: Model<FraudAlertDocument>
  ) {}

  async checkTransactionRisk(data: CheckTransactionDto): Promise<boolean> {
    if (data.amount > 1000) {
      try {
        await this.alertModel.create({
          userId: data.userId,
          transactionId: data.transactionId,
          source: 'SYSTEM_DETECTED',
          type: 'HIGH_AMOUNT',
          reason: `Transaction amount (${data.amount}) exceeds limit`,
          status: 'PENDING'
        });
      } catch (error) {
        if (error.code !== 11000) {
          // Alerta ya existente, no hacer nada.
          throw error;
        }
      }
      return true; // Bloqueamos la transacción
    }
    
    return false;
  }

  async getAlertsForUser(userId: number) {
    return this.alertModel.find({ userId: userId }).exec();
  }

  async reportFraud(movementId: number, userId: number, reason: string) {    
    try {
      const newReport = await this.alertModel.create({
        userId: userId,
        transactionId: movementId,
        source: 'USER_REPORTED',
        type: 'USER_CLAIM',
        reason: reason,
        status: 'PENDING'
      });

      return {
        status: 'RECEIVED',
        alertId: newReport._id,
        linkedTransactionId: newReport.transactionId,
        receivedAt: newReport['createdAt']
      };

    } catch (error) {
        // Error 11000 = Clave duplicada
        if (error.code === 11000) {        
        const existingReport = await this.alertModel.findOne({ userId, transactionId: movementId });
        // Typescript necesita comprobar que existingReport no es null
        if (!existingReport) {
          throw new ConflictException('Report already exists but could not be retrieved');
        }
        return {
          status: 'ALREADY_RECEIVED',
          alertId: existingReport._id,
          linkedTransactionId: existingReport.transactionId,
          receivedAt: existingReport['createdAt'] // TypeScript ya sabe que no es null aquí
        };
      }
      throw error;
    }
  }
}