import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  ParseIntPipe,
} from '@nestjs/common';
import { AntiFraudService } from './anti-fraud.service';
import { CheckTransactionDto } from './dto/check-transaction.dto';
import { CreateFraudReportDto } from './dto/create-fraud-report.dto';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';

@ApiTags('Anti-Fraud')
@Controller('v1')
export class AntiFraudController {
  constructor(private readonly antiFraudService: AntiFraudService) {}

  // Endpoint Interno: Validar transacción antes de aprobarla. POST /v1/fraud-alerts/check
  @Post('fraud-alerts/check')
  @ApiOperation({ summary: 'Validate transaction risk' })
  @ApiBody({
    type: CheckTransactionDto,
    examples: {
      safeCase: {
        summary: 'Example: Safe Transaction',
        description: 'Low amount transaction between known accounts.',
        value: {
          transactionId: 30,
          userId: 3,
          amount: 500,
          origin: 'ES-ACCOUNT-111',
          destination: 'ES-ACCOUNT-222',
        },
      },
      fraudCase: {
        summary: 'Example: High Risk',
        description: 'High amount transaction to a suspicious destination.',
        value: {
          transactionId: 35,
          userId: 10,
          amount: 5000,
          origin: 'ES-ACCOUNT-666',
          destination: 'KY-OFFSHORE-999',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Transaction approved.' })
  @ApiResponse({
    status: 403,
    description: 'Transaction rejected due to high risk.',
  })
  @HttpCode(HttpStatus.OK)
  async checkTransaction(@Body() data: CheckTransactionDto) {
    const isRisky = await this.antiFraudService.checkTransactionRisk(data);
    if (isRisky) {
      throw new ForbiddenException({
        message: 'Transaction rejected',
        code: 'HIGH_RISK',
      });
    }
    return { status: 'APPROVED', message: 'Transaction seems safe' };
  }

  // Obtener alertas de posible fraude. GET /v1/users/{userId}/fraud-alerts
  @Get('users/:userId/fraud-alerts')
  @ApiOperation({ summary: 'Retrieve fraud alert history for an user' })
  @ApiParam({
    name: 'userId',
    example: 1,
    description: 'Target User ID',
  })
  @ApiResponse({
    status: 200,
    description: 'List of alerts retrieved successfully.',
  })
  @ApiResponse({ status: 400, description: 'Invalid User ID format.' })
  async getUserAlerts(@Param('userId', ParseIntPipe) userId: number) {
    return this.antiFraudService.getAlertsForUser(userId);
  }

  // Reportar un movimiento como fraudulento. POST /v1/movements/{movementId}/report
  @Post('movements/:movementId/report')
  @ApiOperation({ summary: 'Report a transaction as fraudulent' })
  @ApiParam({
    name: 'movementId',
    example: 40,
    description: 'ID of the suspicious transaction',
  })
  @ApiResponse({
    status: 202,
    description: 'Fraud report received and under review.',
  })
  @ApiResponse({ status: 400, description: 'Invalid input data.' })
  @HttpCode(HttpStatus.ACCEPTED)
  async reportMovement(
    @Param('movementId', ParseIntPipe) movementId: number,
    @Body() body: CreateFraudReportDto,
  ) {
    return await this.antiFraudService.reportFraud(
      movementId,
      body.userId,
      body.reason,
    );
  }
}
