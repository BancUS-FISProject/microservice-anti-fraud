import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import * as redisStore from 'cache-manager-redis-store';
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
    CacheModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        store: redisStore,
        host: configService.get<string>('REDIS_HOST') || 'redis',
        port: configService.get<number>('REDIS_PORT') || 6379,
        ttl: 3600,
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AntiFraudController],
  providers: [AntiFraudService],
})
export class AntiFraudModule {}
