import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { AntiFraudService } from './anti-fraud.service';
import { AntiFraudController } from './anti-fraud.controller';
import { FraudAlert, FraudAlertSchema } from './schemas/fraud-alert.schema';
import { TransactionCacheService } from './transaction-cache.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FraudAlert.name, schema: FraudAlertSchema },
    ]),
    HttpModule,
    ConfigModule,
  ],
  controllers: [AntiFraudController],
  providers: [AntiFraudService, TransactionCacheService],
})
export class AntiFraudModule {}
