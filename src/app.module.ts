import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AntiFraudModule } from './anti-fraud/anti-fraud.module';
import { HttpModule } from '@nestjs/axios';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    AntiFraudModule,
    HttpModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'),
      }),
    }),
    HealthModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
