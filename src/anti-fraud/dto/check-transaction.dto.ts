import { ApiProperty } from '@nestjs/swagger';

export class CheckTransactionDto {

  @ApiProperty({
    example: 'ES912100...',
    description: 'Source account (IBAN)',
    required: true,
  })
  origin: string;

  @ApiProperty({
    example: 'ES910045...',
    description: 'Destination account (IBAN)',
    required: true,
  })
  destination: string;

  @ApiProperty({ 
    example: 1500,
     description: 'Transaction amount',
     required: true
  })
  amount: number;

}
