import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AntiFraudService } from './anti-fraud.service';
import { CheckTransactionDto } from './dto/check-transaction.dto';
import { UpdateFraudAlertDto } from './dto/update-fraud-alert.dto';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiParam,
  ApiBody,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';

@ApiTags('Anti-Fraud')
@Controller('v1/antifraud')
export class AntiFraudController {
  constructor(private readonly antiFraudService: AntiFraudService) {}

  @Post('transaction-check')
  @ApiOperation({ summary: 'Check if a transaction is fraudulent' })
  @ApiBody({
    type: CheckTransactionDto,
    examples: {
      safeCase: {
        summary: 'Example: Safe Transaction',
        value: {
          origin: 'ES9601698899486406184873',
          destination: 'ES3814819892286713210283',
          amount: 500,
          transactionDate: '2025-12-26T10:00:00Z',
        },
      },
      fraudCase: {
        summary: 'Example: Risk Transaction',
        value: {
          origin: 'ES9601698899486406184873',
          destination: 'KY-OFFSHORE-999',
          amount: 2500,
          transactionDate: '2025-12-26T10:00:00Z',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Transaction approved.' })
  @ApiBadRequestResponse({
    description: 'Bad request: Missing fields or invalid types.',
  })
  @HttpCode(HttpStatus.OK)
  async checkTransaction(@Body() data: CheckTransactionDto) {
    const isRisky = await this.antiFraudService.checkTransactionRisk(data);
    if (isRisky) {
      return {
        message: 'Fraudulent behaviour detected.',
      };
    }
    return { message: 'Transaction approved' };
  }

  @Get('accounts/:iban/fraud-alerts')
  @ApiOperation({
    summary:
      'Retrieves transaction history alerts for a specific account using the IBAN.',
    description: 'Returns all alerts where this IBAN/Card was the origin.',
  })
  @ApiParam({
    name: 'iban',
    example: 'ES4220946904812190707297',
    description: 'Target Account number',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'List of alerts retrieved successfully.',
  })
  @ApiBadRequestResponse({ description: 'Invalid request format.' })
  @ApiNotFoundResponse({
    description: 'No alerts found for the provided IBAN.',
  })
  @ApiResponse({ status: 200, description: 'List of alerts retrieved.' })
  async getAccountAlerts(@Param('iban') iban: string) {
    return this.antiFraudService.getAlertsForAccount(iban);
  }

  // PUT /v1/fraud-alerts/:id
  @Put('fraud-alerts/:id')
  @ApiOperation({ summary: 'Update an existing fraud alert' })
  @ApiParam({ name: 'id', description: 'MongoDB Object ID of the alert' })
  @ApiBody({ type: UpdateFraudAlertDto })
  @ApiResponse({ status: 200, description: 'Alert updated successfully.' })
  @ApiNotFoundResponse({
    description: 'Alert not found',
  })
  @ApiBadRequestResponse({
    description: 'Invalid ID format.',
  })
  async updateAlert(
    @Param('id') id: string,
    @Body() updateData: UpdateFraudAlertDto,
  ) {
    return this.antiFraudService.updateAlert(id, updateData);
  }

  // DELETE /v1/fraud-alerts/:id
  @Delete('fraud-alerts/:id')
  @ApiOperation({ summary: 'Delete a fraud alert permanently' })
  @ApiParam({ name: 'id', description: 'MongoDB Object ID of the alert' })
  @ApiResponse({ status: 200, description: 'Alert deleted successfully.' })
  @ApiNotFoundResponse({
    description: 'Alert not found',
  })
  @ApiBadRequestResponse({ description: 'Invalid ID format.' })
  async deleteAlert(@Param('id') id: string) {
    return this.antiFraudService.deleteAlert(id);
  }
}
