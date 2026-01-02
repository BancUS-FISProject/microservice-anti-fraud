import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { AntiFraudService } from './anti-fraud.service';
import { AntiFraudController } from './anti-fraud.controller';
import { FraudAlert, FraudAlertSchema } from './schemas/fraud-alert.schema';
import {
  TransactionHistoryView,
  TransactionHistoryViewSchema,
} from './schemas/transaction-history.view.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FraudAlert.name, schema: FraudAlertSchema },
      {
        name: TransactionHistoryView.name,
        schema: TransactionHistoryViewSchema,
      },
    ]),
    HttpModule,
    ConfigModule,
  ],
  controllers: [AntiFraudController],
  providers: [AntiFraudService],
})
export class AntiFraudModule {}
