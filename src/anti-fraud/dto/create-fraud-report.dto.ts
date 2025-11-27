import { ApiProperty } from '@nestjs/swagger';

export class CreateFraudReportDto {
@ApiProperty({ 
    example: 2, 
    description: 'ID of the user reporting the fraud' 
  })
  userId: number;

  @ApiProperty({ 
    example: 'I do not recognize this charge', 
    description: 'Reason or description of the reported fraud' 
  })
  reason: string;
}