import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { of } from 'rxjs';
import { AntiFraudService } from './anti-fraud.service';
import { FraudAlert } from './schemas/fraud-alert.schema';
import { AccountView } from './schemas/account.view.schema';
import { AlertStatus } from './dto/update-fraud-alert.dto';

describe('AntiFraudService', () => {
  let service: AntiFraudService;

  // Mocks
  let httpServiceMock: { get: jest.Mock; patch: jest.Mock; post: jest.Mock };
  let cacheManagerMock: { get: jest.Mock; set: jest.Mock };
  let fraudAlertModelMock: {
    create: jest.Mock;
    find: jest.Mock;
    findByIdAndUpdate: jest.Mock;
    findByIdAndDelete: jest.Mock;
  };
  let accountViewModelMock: { findOne: jest.Mock; bulkWrite: jest.Mock };

  beforeEach(async () => {
    httpServiceMock = {
      get: jest.fn(),
      patch: jest.fn().mockReturnValue(of({})),
      post: jest.fn().mockReturnValue(of({})),
    };

    cacheManagerMock = {
      get: jest.fn(),
      set: jest.fn(),
    };

    fraudAlertModelMock = {
      create: jest
        .fn()
        .mockImplementation((dto) =>
          Promise.resolve({ _id: 'new_alert_id', ...dto }),
        ),
      find: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      findByIdAndDelete: jest.fn(),
    };

    accountViewModelMock = {
      findOne: jest.fn(),
      bulkWrite: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AntiFraudService,
        {
          provide: getModelToken(FraudAlert.name),
          useValue: fraudAlertModelMock,
        },
        {
          provide: getModelToken(AccountView.name),
          useValue: accountViewModelMock,
        },
        { provide: HttpService, useValue: httpServiceMock },
        { provide: CACHE_MANAGER, useValue: cacheManagerMock },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'ACCOUNTS_BLOCK_TIMEOUT_MS') return 3000;
              return 'http://localhost:3000';
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AntiFraudService>(AntiFraudService);
  });

  // --- TESTS: CHECK TRANSACTION (POST) ---

  describe('checkTransactionRisk', () => {
    const validDto = {
      amount: 500,
      origin: 'ES123',
      destination: 'ES456',
      transactionDate: new Date(),
    };

    it('should throw BadRequestException if account does not exist locally or remotely', async () => {
      // Mock: No en local
      accountViewModelMock.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });
      // Mock: No en remoto (lista vacía)
      httpServiceMock.get.mockReturnValue(of({ data: [] }));

      await expect(service.checkTransactionRisk(validDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should approve transaction if amount <= 2000 (Safe)', async () => {
      // Mock: Account exists.
      accountViewModelMock.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ iban: 'ES123' }),
      });

      const result = await service.checkTransactionRisk(validDto);

      expect(result).toBe(false); // False = No risk
      expect(httpServiceMock.get).not.toHaveBeenCalledWith(
        expect.stringContaining('/transactions/'),
      );
    });

    it('should block account if amount > 2000 AND pattern found', async () => {
      const riskyDto = { ...validDto, amount: 5000 };

      // Account exists
      accountViewModelMock.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ iban: 'ES123' }),
      });

      // Fraudulent history.
      const pastTransactions = [
        { date: new Date().toISOString(), quantity: 5000 },
        { date: new Date().toISOString(), quantity: 3000 },
      ];

      // Cache miss -> API call
      cacheManagerMock.get.mockResolvedValue(null);
      httpServiceMock.get.mockReturnValueOnce(of({ data: pastTransactions }));

      // Mock update alert
      fraudAlertModelMock.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({}),
      });

      const result = await service.checkTransactionRisk(riskyDto);

      expect(result).toBe(true); // Fraud detected
      expect(httpServiceMock.patch).toHaveBeenCalled(); // Block account
    });
  });

  // --- TESTS: HISTORIAL (GET) ---

  describe('getAlertsForAccount', () => {
    it('should return alerts if found', async () => {
      const mockAlerts = [{ _id: '1', origin: 'ES123' }];
      fraudAlertModelMock.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockAlerts),
      });

      const result = await service.getAlertsForAccount('ES123');
      expect(result).toEqual(mockAlerts);
    });

    it('should throw NotFoundException if no alerts found', async () => {
      fraudAlertModelMock.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      });

      await expect(service.getAlertsForAccount('ES123')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // --- TESTS: PUT ---

  describe('updateAlert', () => {
    it('should update and return alert if exists', async () => {
      const updateDto = { status: AlertStatus.CONFIRMED };
      const updatedAlert = { _id: '1', ...updateDto };

      fraudAlertModelMock.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updatedAlert),
      });

      const result = await service.updateAlert('1', updateDto);
      expect(result).toEqual(updatedAlert);
    });
  });

  // --- TESTS: DELETE ---

  describe('deleteAlert', () => {
    it('should return success message if deleted', async () => {
      fraudAlertModelMock.findByIdAndDelete.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: '1' }),
      });

      const result = await service.deleteAlert('1');
      expect(result).toEqual({
        message: 'Alert deleted successfully',
        id: '1',
      });
    });

    it('should throw NotFoundException if alert not found', async () => {
      fraudAlertModelMock.findByIdAndDelete.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.deleteAlert('1')).rejects.toThrow(NotFoundException);
    });
  });
});
