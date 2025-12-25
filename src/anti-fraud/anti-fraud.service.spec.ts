import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { AntiFraudService } from './anti-fraud.service';
import { FraudAlert } from './schemas/fraud-alert.schema';

describe('AntiFraudService', () => {
  let service: AntiFraudService;

  beforeEach(async () => {
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
          useValue: {
            patch: jest.fn().mockReturnValue(of({})),
            post: jest.fn().mockReturnValue(of({})),
          },
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
});
