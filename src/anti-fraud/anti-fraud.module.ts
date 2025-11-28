import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AntiFraudService } from './anti-fraud.service';
import { AntiFraudController } from './anti-fraud.controller';
import { FraudAlert, FraudAlertSchema } from './schemas/fraud-alert.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FraudAlert.name, schema: FraudAlertSchema },
    ]),
  ],
  controllers: [AntiFraudController],
  providers: [AntiFraudService],
})
export class AntiFraudModule {}
