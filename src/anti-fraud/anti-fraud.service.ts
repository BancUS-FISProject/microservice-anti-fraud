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

  getAlertsForUser(userId: string) {
    return [
      {
        id: 'alert-123',
        userId: userId,
        type: 'SUSPICIOUS_LOCATION',
        message: 'Intento de acceso desde Rusia',
        date: new Date().toISOString()
      },
      {
        id: 'alert-456',
        userId: userId,
        type: 'HIGH_VELOCITY',
        message: '3 transacciones en menos de 10 segundos',
        date: new Date(Date.now() - 86400000).toISOString()
      }
    ];
  }

  reportFraud(movementId: string, userId: string, reason: string) {
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