import { ApiProperty } from '@nestjs/swagger';

export class CheckTransactionDto {
  @ApiProperty({ example: 30, description: 'Unique transaction ID' })
  transactionId: number;

  @ApiProperty({
    example: 1,
    description: 'User ID performing the transaction',
  })
  userId: number;

  @ApiProperty({ example: 1500.5, description: 'Transaction amount' })
  amount: number;

  @ApiProperty({
    example: 'ES912100...',
    description: 'Source account (IBAN or ID)',
    required: false,
  })
  origin: string;

  @ApiProperty({
    example: 'ES910045...',
    description: 'Destination account (IBAN or ID)',
    required: false,
  })
  destination: string;

  @ApiProperty({
    example: 'ES910045...',
    description: 'Account IBAN',
    required: false,
  })
  iban: number;
}
