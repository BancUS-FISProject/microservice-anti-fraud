import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { Redis as RedisClient } from 'ioredis';
import { CheckTransactionDto } from './dto/check-transaction.dto';

@Injectable()
export class TransactionCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(TransactionCacheService.name);
  private client: RedisClient | null = null;
  private readonly ttlSeconds: number;
  private readonly redisUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.redisUrl =
      this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379';

    const ttlFromEnv = Number(
      this.configService.get<number>('TRANSACTION_CACHE_TTL_SECONDS'),
    );
    this.ttlSeconds = Number.isFinite(ttlFromEnv) && ttlFromEnv > 0 ? ttlFromEnv : 300;

    this.bootstrapClient();
  }

  private bootstrapClient() {
    try {
      this.client = new Redis(this.redisUrl);
      this.client.on('error', (err) =>
        this.logger.warn(`Redis error: ${err?.message ?? err}`),
      );
      this.client.on('connect', () =>
        this.logger.log('Redis connection established'),
      );
    } catch (err) {
      this.logger.error(
        `Failed to initialize Redis client: ${err instanceof Error ? err.message : err}`,
      );
      this.client = null;
    }
  }

  private buildKey(data: CheckTransactionDto): string {
    const origin = encodeURIComponent(data.origin ?? '');
    const destination = encodeURIComponent(data.destination ?? '');
    const amount = Number.isFinite(data.amount) ? data.amount : 'na';
    return `tx:${origin}:${destination}:${amount}`;
  }

  async getDecision(data: CheckTransactionDto): Promise<boolean | null> {
    if (!this.client) {
      return null;
    }

    try {
      const cached = await this.client.get(this.buildKey(data));
      if (cached === null) {
        return null;
      }
      return cached === '1';
    } catch (err) {
      this.logger.warn(
        `Cache getDecision failed: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  async setDecision(data: CheckTransactionDto, isFraud: boolean): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      await this.client.set(
        this.buildKey(data),
        isFraud ? '1' : '0',
        'EX',
        this.ttlSeconds,
      );
    } catch (err) {
      this.logger.warn(
        `Cache setDecision failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
    }
  }
}
