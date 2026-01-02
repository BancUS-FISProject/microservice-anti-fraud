import { ConfigService } from '@nestjs/config';
import { TransactionCacheService } from './transaction-cache.service';

jest.mock('ioredis', () => {
  const mockGet = jest.fn();
  const mockSet = jest.fn();
  const mockOn = jest.fn();
  const mockQuit = jest.fn();

  const RedisMock = jest.fn().mockImplementation(() => ({
    get: mockGet,
    set: mockSet,
    on: mockOn,
    quit: mockQuit,
  }));

  return {
    __esModule: true,
    default: RedisMock,
    Redis: RedisMock,
    mockGet,
    mockSet,
    mockOn,
    mockQuit,
  };
});

const redisMockModule = jest.requireMock('ioredis') as {
  mockGet: jest.Mock;
  mockSet: jest.Mock;
  mockQuit: jest.Mock;
};

const createService = (configValues: Record<string, unknown> = {}) => {
  const configService = {
    get: jest.fn((key: string) => configValues[key]),
  } as unknown as ConfigService;

  return new TransactionCacheService(configService);
};

describe('TransactionCacheService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null on cache miss', async () => {
    redisMockModule.mockGet.mockResolvedValueOnce(null);
    const service = createService();

    const result = await service.getDecision({
      origin: 'ES1',
      destination: 'ES2',
      amount: 100,
    });

    expect(result).toBeNull();
    expect(redisMockModule.mockGet).toHaveBeenCalledWith('tx:ES1:ES2:100');
  });

  it('returns cached true when value is 1', async () => {
    redisMockModule.mockGet.mockResolvedValueOnce('1');
    const service = createService();

    const result = await service.getDecision({
      origin: 'ES1',
      destination: 'ES2',
      amount: 200,
    });

    expect(result).toBe(true);
    expect(redisMockModule.mockGet).toHaveBeenCalledWith('tx:ES1:ES2:200');
  });

  it('stores decision with TTL from config', async () => {
    const service = createService({ TRANSACTION_CACHE_TTL_SECONDS: 120 });

    await service.setDecision(
      { origin: 'ES1', destination: 'ES2', amount: 300 },
      true,
    );

    expect(redisMockModule.mockSet).toHaveBeenCalledWith(
      'tx:ES1:ES2:300',
      '1',
      'EX',
      120,
    );
  });

  it('closes the redis client on destroy', async () => {
    const service = createService();

    await service.onModuleDestroy();

    expect(redisMockModule.mockQuit).toHaveBeenCalledTimes(1);
  });
});
