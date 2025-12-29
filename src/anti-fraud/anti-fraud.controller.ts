import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { AntiFraudService } from './anti-fraud.service';
import { CheckTransactionDto } from './dto/check-transaction.dto';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiParam,
  ApiBody,
  ApiNotFoundResponse
} from '@nestjs/swagger';

@ApiTags('Anti-Fraud')
@Controller('v1')
export class AntiFraudController {
  constructor(private readonly antiFraudService: AntiFraudService) {}

  @Post('fraud-alerts/check')
  @ApiOperation({ summary: 'Check if a transaction is fraudulent' })
  @ApiBody({
    type: CheckTransactionDto,
    examples: {
      safeCase: {
        summary: 'Example: Safe Transaction',
        value: {
          origin: 'ES4220946904812190707297',
          destination: 'ES-222',
          amount: 500
        },
      },
      fraudCase: {
        summary: 'Example: Risk Transaction',
        value: {
          origin: 'ES4220946904812190707297',
          destination: 'KY-OFFSHORE-999',
          amount: 2500
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Transaction approved.' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden: Transaction denied.',
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Bad request: Missing fields or invalid types.' 
  })
  @HttpCode(HttpStatus.OK)
  async checkTransaction(@Body() data: CheckTransactionDto) {
    const isRisky = await this.antiFraudService.checkTransactionRisk(data);
    if (isRisky) {
      throw new ForbiddenException({
        message: 'Transaction denied',
        code: 'HIGH_RISK',
      });
    }
    return { status: 'APPROVED', message: 'Transaction approved' };
  }




  @Get('users/:iban/fraud-alerts')
  @ApiOperation({
    summary:
      'Retrieves transaction history alerts for a specific account using the IBAN.',
    description:
      'Returns all alerts where this IBAN/Card was the origin.'
  })
  @ApiParam({
    name: 'iban',
    example: 'ES4220946904812190707297',
    description: 'Target Account number',
    required: true
  })
  @ApiResponse({
    status: 200,
    description: 'List of alerts retrieved successfully.',
  })
  @ApiResponse({ 
    status: 404, 
    description: 'No alerts found for the provided IBAN.' 
  })
  @ApiResponse({ status: 200, description: 'List of alerts retrieved.' })
  async getAccountAlerts(@Param('iban') iban: string) {
    return this.antiFraudService.getAlertsForAccount(iban);
  }
}
