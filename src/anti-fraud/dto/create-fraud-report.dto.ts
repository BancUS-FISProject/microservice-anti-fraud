import { ApiProperty } from '@nestjs/swagger';

export class CreateFraudReportDto {
@ApiProperty({ 
    example: 'user-victim-001', 
    description: 'ID of the user reporting the fraud' 
  })
  userId: string;

  @ApiProperty({ 
    example: 'I do not recognize this charge', 
    description: 'Reason or description of the reported fraud' 
  })
  reason: string;
}