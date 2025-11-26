import { Controller, Get, Post, Body, Param, HttpCode, HttpStatus, ForbiddenException } from '@nestjs/common';
import { AntiFraudService } from './anti-fraud.service';
import { CheckTransactionDto } from './dto/check-transaction.dto';


@Controller('v1') 
export class AntiFraudController {
  constructor(private readonly antiFraudService: AntiFraudService) {}

  // Endpoint Interno: Validar transacción antes de aprobarla. POST /v1/fraud-alerts/check
  @Post('fraud-alerts/check')
  @HttpCode(HttpStatus.OK) // Código 200 OK
  checkTransaction(@Body() data: CheckTransactionDto) {
    const isRisky = this.antiFraudService.checkTransactionRisk(data);
    if (isRisky) {
      // Si hay riesgo, lanzamos error 403 Forbidden
      throw new ForbiddenException({
        message: 'Transacción rechazada por alto riesgo de fraude',
        code: 'HIGH_RISK'
      });
    }

    return { status: 'APPROVED', message: 'Transacción limpia' };
  }


  // Obtener alertas de posible fraude. GET /v1/users/{userId}/fraud-alerts
  @Get('users/:userId/fraud-alerts')
  getUserAlerts(@Param('userId') userId: string) {
    return this.antiFraudService.getAlertsForUser(userId);
  }

  // Reportar un movimiento como fraudulento. POST /v1/movements/{movementId}/report
  @Post('movements/:movementId/report')
  @HttpCode(HttpStatus.ACCEPTED)
  reportMovement(
    @Param('movementId') movementId: string, 
    @Body() body: { userId: string, reason: string }
  ) {
    return this.antiFraudService.reportFraud(movementId, body.userId, body.reason);
  }
}