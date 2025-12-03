<<<<<<< Updated upstream
import { Controller, Get, Post, Body, Param, HttpCode, HttpStatus, ForbiddenException, ParseIntPipe } from '@nestjs/common';
import { AntiFraudService } from './anti-fraud.service';
import { CheckTransactionDto } from './dto/check-transaction.dto';
import { CreateFraudReportDto } from './dto/create-fraud-report.dto';
import { ApiOperation, ApiResponse, ApiTags, ApiParam, ApiBody } from '@nestjs/swagger';
=======
import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Param, 
  HttpCode, 
  HttpStatus, 
  ForbiddenException, 
  ParseIntPipe 
} from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { AntiFraudService } from './anti-fraud.service';
import { CheckTransactionDto } from './dto/check-transaction.dto';
import { 
  ApiOperation, 
  ApiResponse, 
  ApiTags, 
  ApiParam, 
  ApiBody 
} from '@nestjs/swagger';
>>>>>>> Stashed changes

@ApiTags('Anti-Fraud')
@Controller('v1') 
export class AntiFraudController {
  constructor(private readonly antiFraudService: AntiFraudService) {}

  @Post('fraud-alerts/check')
  @ApiOperation({ summary: 'Check if a transaction is risky.' })
  @ApiBody({
    type: CheckTransactionDto,
    examples: {
      safeCase: {
        summary: 'Example: Safe Transaction',
<<<<<<< Updated upstream
        description: 'Low amount transaction between known accounts.',
        value: {
          transactionId: 30,
          userId: 3,
          amount: 500,
          origin: 'ES-ACCOUNT-111',
          destination: 'ES-ACCOUNT-222'
        }
      },
      fraudCase: {
        summary: 'Example: High Risk',
        description: 'High amount transaction to a suspicious destination.',
        value: {
          transactionId: 35,
          userId: 10,
          amount: 5000,
          origin: 'ES-ACCOUNT-666',
          destination: 'KY-OFFSHORE-999'
=======
        value: { 
          transactionId: 1001, userId: 50, amount: 500, origin: 'ES-111', destination: 'ES-222' 
        }
      },
      fraudCase: {
        summary: 'Example: Risk Transaction',
        value: { 
          transactionId: 9999, userId: 666, amount: 2500, origin: 'ES-666', destination: 'KY-OFFSHORE-999' 
>>>>>>> Stashed changes
        }
      }
    }
  })
  @ApiResponse({ status: 200, description: 'Transaction approved.' })
<<<<<<< Updated upstream
  @ApiResponse({ status: 403, description: 'Transaction rejected due to high risk.' })
=======
  @ApiResponse({ status: 403, description: 'Transaction rejected and account blocked.' })
>>>>>>> Stashed changes
  @HttpCode(HttpStatus.OK)
  async checkTransaction(@Body() data: CheckTransactionDto) {
    const isRisky = await this.antiFraudService.checkTransactionRisk(data);
    if (isRisky) {
<<<<<<< Updated upstream
      throw new ForbiddenException({ message: 'Transaction rejected', code: 'HIGH_RISK' });
=======
      throw new ForbiddenException({ 
        message: 'Transaction rejected', 
        code: 'HIGH_RISK' 
      });
>>>>>>> Stashed changes
    }
    return { status: 'APPROVED', message: 'Transaction accepted' };
  }

<<<<<<< Updated upstream

  // Obtener alertas de posible fraude. GET /v1/users/{userId}/fraud-alerts
@ Get('users/:userId/fraud-alerts')
  @ApiOperation({ summary: 'Retrieve fraud alert history for an user' })
  @ApiParam({ 
    name: 'userId', 
    example: 1, 
    description: 'Target User ID'
  })
  @ApiResponse({ status: 200, description: 'List of alerts retrieved successfully.' })
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
    description: 'ID of the suspicious transaction'
  })
  @ApiResponse({ status: 202, description: 'Fraud report received and under review.' })
  @ApiResponse({ status: 400, description: 'Invalid input data.' })
  @HttpCode(HttpStatus.ACCEPTED)
  async reportMovement(
    @Param('movementId', ParseIntPipe) movementId: number, 
    @Body() body: CreateFraudReportDto
  ) {
    return await this.antiFraudService.reportFraud(movementId, body.userId, body.reason);
  }
}
=======
  @EventPattern('transaction_created')
  async handleTransactionCreated(@Payload() data: CheckTransactionDto) {
    await this.antiFraudService.checkTransactionHistory(data);
  }



  @Get('users/:userId/fraud-alerts')
  @ApiOperation({ summary: 'Retrieve transaction history to analize possible past risk transactions' })
  @ApiParam({ name: 'userId', example: 666, description: 'Target User ID (Numeric)' })
  @ApiResponse({ status: 200, description: 'List of alerts retrieved successfully.' })
  async getUserAlerts(@Param('userId', ParseIntPipe) userId: number) {
    return this.antiFraudService.getAlertsForUser(userId);
  }
}
>>>>>>> Stashed changes
