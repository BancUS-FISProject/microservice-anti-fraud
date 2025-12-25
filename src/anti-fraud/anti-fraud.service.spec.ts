import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { AntiFraudService } from './anti-fraud.service';
import { FraudAlert } from './schemas/fraud-alert.schema';

describe('AntiFraudService', () => {
  let service: AntiFraudService;
  let httpServiceMock: {
    patch: jest.Mock;
    post: jest.Mock;
  };

  beforeEach(async () => {
    httpServiceMock = {
      patch: jest.fn().mockReturnValue(of({})),
      post: jest.fn().mockReturnValue(of({})),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AntiFraudService,
        {
          provide: getModelToken(FraudAlert.name),
          useValue: {
            create: jest.fn(),
            find: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue([]),
            }),
          },
        },
        {
          provide: HttpService,
          useValue: httpServiceMock,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(() => undefined),
          },
        },
        {
          provide: 'BANK_STATEMENTS_SERVICE',
          useValue: {
            send: jest.fn().mockReturnValue(of([])),
          },
        },
      ],
    }).compile();

    service = module.get<AntiFraudService>(AntiFraudService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should skip HTTP call when circuit is open', async () => {
    // Forzamos la apertura del breaker y verificamos que no intente hacer la llamada HTTP
    (service as any).blockAccountBreaker.open();

    await (service as any).blockUserAccount('ES123');

    expect(httpServiceMock.patch).not.toHaveBeenCalled();
  });
});
