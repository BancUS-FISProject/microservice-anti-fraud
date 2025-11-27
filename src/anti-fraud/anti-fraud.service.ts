import { Injectable } from '@nestjs/common';
import { CheckTransactionDto } from './dto/check-transaction.dto';

@Injectable()
export class AntiFraudService {

  checkTransactionRisk(data: CheckTransactionDto): boolean {
    if (data.amount > 1000) {
      return true;
    }
    return false;
  }

  getAlertsForUser(userId: number) {
    return [
      {
        id: 1,
        userId: userId,
        type: 'SUSPICIOUS_DESTINATION',
        message: 'Attempted transfer to a flagged offshore account',
        date: new Date().toISOString()
      },
      {
        id: 2,
        userId: userId,
        type: 'HIGH_VELOCITY',
        message: 'Multiple transactions in a short time frame',
        date: new Date(Date.now() - 86400000).toISOString()
      }
    ];
  }

  reportFraud(movementId: number, userId: number, reason: string) {
    return {
      status: 'RECEIVED', 
      reportId: 1, 
      linkedTransactionId: movementId,
      reporterId: userId,
      reportDate: new Date().toISOString(),
      userNote: reason
    };
  }
}