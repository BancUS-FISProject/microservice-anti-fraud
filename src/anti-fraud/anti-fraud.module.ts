import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { AntiFraudService } from './anti-fraud.service';
import { AntiFraudController } from './anti-fraud.controller';
import { FraudAlert, FraudAlertSchema } from './schemas/fraud-alert.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FraudAlert.name, schema: FraudAlertSchema }
    ]),
    HttpModule,
    ConfigModule,
    ClientsModule.registerAsync([
      {
        name: 'BANK_STATEMENTS_SERVICE',
        imports: [ConfigModule],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [configService.get<string>('RABBITMQ_URL') || 'amqp://localhost:5672'],
            queue: 'bank_statements_queue',
            queueOptions: {
              durable: false
            },
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  controllers: [AntiFraudController],
  providers: [AntiFraudService],
})
export class AntiFraudModule {}
