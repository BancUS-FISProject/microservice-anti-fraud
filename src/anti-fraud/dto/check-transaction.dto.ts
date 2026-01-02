import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsNotEmpty, IsDateString } from 'class-validator';

export class CheckTransactionDto {
  @ApiProperty({
    example: 'ES9601698899486406184873',
    description: 'Source account (IBAN)',
    required: true,
  })
  @IsString({ message: 'Origin must be a valid string.' })
  @IsNotEmpty({ message: 'Missing origin field' })
  origin: string;

  @ApiProperty({
    example: 'ES3814819892286713210283',
    description: 'Destination account (IBAN)',
    required: true,
  })
  @IsString({ message: 'Destination must be a valid string.' })
  @IsNotEmpty({ message: 'Missing destination field' })
  destination: string;

  @ApiProperty({
    example: 1500,
    description: 'Transaction amount',
    required: true,
  })
  @IsNumber({}, { message: 'Amount must be a valid number.' })
  @IsNotEmpty({ message: 'Missing amount field' })
  amount: number;

  @ApiProperty({
    example: '2025-12-26T10:00:00.000Z',
    description: 'Date of the transaction',
  })
  @IsDateString(
    {},
    { message: 'The field transactionDate must be a valid date' },
  )
  @IsNotEmpty({ message: 'The field transactionDate is mandatory.' })
  transactionDate: Date;
}
