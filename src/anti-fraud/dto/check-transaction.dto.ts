import { ApiProperty } from '@nestjs/swagger';


export class CheckTransactionDto {
  @ApiProperty({ example: 'tx-12345', description: 'Unique transaction ID' })
  transactionId: string;

  @ApiProperty({ example: 'user-007', description: 'User ID performing the transaction' })
  userId: string;

  @ApiProperty({ example: 1500.50, description: 'Transaction amount' })
  amount: number;

  @ApiProperty({ example: 'ES912100...', description: 'Source account (IBAN or ID)', required: false })
  origin: string;

  @ApiProperty({ example: 'ES910045...', description: 'Destination account (IBAN or ID)', required: false })
  destination:string;
}