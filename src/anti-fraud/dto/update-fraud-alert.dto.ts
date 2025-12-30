import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum } from 'class-validator';

export enum AlertStatus {
  PENDING = 'PENDING',
  REVIEWED = 'REVIEWED',
  CONFIRMED = 'CONFIRMED',
  FALSE_POSITIVE = 'FALSE_POSITIVE',
}

export class UpdateFraudAlertDto {
  @ApiProperty({
    example: 'FALSE_POSITIVE',
    description: 'New status of the alert',
    enum: AlertStatus,
    required: false,
  })
  @IsOptional()
  @IsEnum(AlertStatus, {
    message:
      'The status value must be one of the following: PENDING, REVIEWED, CONFIRMED, FALSE_POSITIVE',
  })
  status?: AlertStatus;

  @ApiProperty({
    example: 'Customer confirmed transaction via phone call',
    description: 'Updated reason or notes',
    required: false,
  })
  @IsOptional()
  @IsString()
  reason?: string;
}