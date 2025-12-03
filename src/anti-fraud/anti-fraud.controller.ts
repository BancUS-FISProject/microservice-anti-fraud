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
        value: { transactionId: 1001, userId: 50, amount: 500, origin: 'ES-111', destination: 'ES-222' }
      },
      fraudCase: {
        summary: 'Example: Risk Transaction',
        value: { transactionId: 9999, userId: 666, amount: 2500, origin: 'ES-666', destination: 'KY-OFFSHORE-999' }
      }
    }
  })
  @ApiResponse({ status: 200, description: 'Transaction approved.' })
  @ApiResponse({ status: 403, description: 'Transaction rejected and account blocked.' })
  @HttpCode(HttpStatus.OK)
  async checkTransaction(@Body() data: CheckTransactionDto) {
    const isRisky = await this.antiFraudService.checkTransactionRisk(data);
    if (isRisky) {
      throw new ForbiddenException({ 
        message: 'Transaction rejected', 
        code: 'HIGH_RISK' 
      });
    }
    return { status: 'APPROVED', message: 'Transaction accepted' };
  }

  @EventPattern('transaction_created')
  async handleTransactionCreated(@Payload() data: CheckTransactionDto) {
    await this.antiFraudService.checkTransactionHistory(data);
  }

  @Get('users/:userId/fraud-alerts')
  @ApiOperation({ summary: 'Retrieve transaction history to analyze possible past risk transactions' })
  @ApiParam({ name: 'userId', example: 666, description: 'Target User ID (Numeric)' })
  @ApiResponse({ status: 200, description: 'List of alerts retrieved successfully.' })
  async getUserAlerts(@Param('userId', ParseIntPipe) userId: number) {
    return this.antiFraudService.getAlertsForUser(userId);
  }
}