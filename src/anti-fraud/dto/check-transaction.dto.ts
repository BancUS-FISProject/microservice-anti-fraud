import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsNotEmpty, IsDateString } from 'class-validator';

export class CheckTransactionDto {

  @ApiProperty({
    example: 'ES912100...',
    description: 'Source account (IBAN)',
    required: true,
  })
  @IsString({ message: 'Origin must be a valid string.' })
  @IsNotEmpty({ message: 'Missing origin field' }) 
  origin: string;

  @ApiProperty({
    example: 'ES910045...',
    description: 'Destination account (IBAN)',
    required: true,
  })
  @IsString({ message: 'Destination must be a valid string.' })
  @IsNotEmpty({ message: 'Missing destination field' }) 
  destination: string;

  @ApiProperty({ 
    example: 1500,
     description: 'Transaction amount',
     required: true
  })
  @IsNumber({}, { message: 'Amount must be a valid number.' })
  @IsNotEmpty({ message: 'Missing amount field' })
  amount: number;

}
