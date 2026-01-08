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
  const validIban = 'ES0012345678901234567890';
  const mockToken =
    'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYmFuIjoiRVMwMDEyMzQ1Njc4OTAxMjM0NTY3ODkwIn0.firma_falsa';
  let service: AntiFraudService;

  // Mocks
  let httpServiceMock: { get: jest.Mock; patch: jest.Mock; post: jest.Mock };
  let cacheManagerMock: { get: jest.Mock; set: jest.Mock };
  let fraudAlertModelMock: {
    create: jest.Mock;
    find: jest.Mock;
    findById: jest.Mock;
    findByIdAndUpdate: jest.Mock;
    findByIdAndDelete: jest.Mock;
  };
  let accountViewModelMock: {
    findOne: jest.Mock;
    bulkWrite: jest.Mock;
    updateOne: jest.Mock;
  };

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
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      findByIdAndDelete: jest.fn(),
    };

    accountViewModelMock = {
      findOne: jest.fn(),
      bulkWrite: jest.fn(),
      updateOne: jest.fn(),
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
      origin: 'ES0012345678901234567890',
      destination: 'ES4567890123456789012345',
      transactionDate: new Date(),
    };

    it('should throw BadRequestException if account does not exist', async () => {
      accountViewModelMock.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });
      const error = new Error('Simulated 404');
      const axiosError = error as Error & { response: { status: number } };
      axiosError.response = { status: 404 };
      httpServiceMock.get.mockImplementation(() => {
        throw axiosError;
      });
      await expect(
        service.checkTransactionRisk(validDto, mockToken),
      ).rejects.toThrow(BadRequestException);
    });

    it('should sync account from MS if not found locally (Lazy Loading)', async () => {
      accountViewModelMock.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });
      const remoteAccount = { iban: validIban, isBlocked: 'active' };
      httpServiceMock.get.mockImplementation((url: string) => {
        if (url.includes('/accounts/')) {
          return of({ data: remoteAccount });
        }
        if (url.includes('/transactions/')) {
          return of({ data: [] });
        }
        return of({ data: [] });
      });

      // Simulamos que el cache de historial está vacío para forzar la llamada HTTP
      cacheManagerMock.get.mockResolvedValue(null);
      accountViewModelMock.updateOne.mockResolvedValue({});
      const result = await service.checkTransactionRisk(validDto, mockToken);
      expect(httpServiceMock.get).toHaveBeenCalledWith(
        expect.stringContaining(`/v1/accounts/${validIban}`),
        expect.anything(),
      );
      expect(accountViewModelMock.updateOne).toHaveBeenCalled();
      expect(result).toBe(false);
    });

    // TEST AMOUNT ALTO (> 2000)
    it('should BLOCK immediately if amount > 2000 (Rule 1)', async () => {
      const riskyDto = { ...validDto, amount: 2500 }; // 2500 > 2000

      accountViewModelMock.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ iban: validIban }),
      });

      // Mock creación alerta inicial
      fraudAlertModelMock.create.mockResolvedValue({ _id: '1', ...riskyDto });

      // Mock updateAlert (findById + findByIdAndUpdate)
      fraudAlertModelMock.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: '1', origin: validIban }),
      });
      fraudAlertModelMock.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({}),
      });

      const result = await service.checkTransactionRisk(riskyDto, mockToken);

      expect(result).toBe(true); // Debe devolver true (Fraude)
      // Debe haber llamado a blockUserAccount (http patch)
      expect(httpServiceMock.patch).toHaveBeenCalled();
      // Debe haber actualizado la alerta a CONFIRMED
      expect(fraudAlertModelMock.findByIdAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: 'CONFIRMED' }),
        expect.anything(),
      );
    });

    // TEST: VARIAS TRANSACCIONES CON AMOUNT DE MAS DE 1000 (> 1000 REPETIDO)
    it('should BLOCK if pattern detected (amount > 1000 repeated >= 2 times)', async () => {
      const normalDto = { ...validDto, amount: 1200 }; // 1200 < 2000 (Pasa regla 1)

      accountViewModelMock.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ iban: validIban }),
      });

      // Historial peligroso: 2 transacciones previas de 1500 (> 1000)
      const pastTransactions = [
        { date: new Date().toISOString(), quantity: 1500 },
        { date: new Date().toISOString(), quantity: 1500 },
      ];

      cacheManagerMock.get.mockResolvedValue(null);
      httpServiceMock.get.mockReturnValue(of({ data: pastTransactions }));

      fraudAlertModelMock.create.mockResolvedValue({ _id: '1', ...normalDto });

      fraudAlertModelMock.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: '1', origin: validIban }),
      });
      fraudAlertModelMock.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({}),
      });
      const result = await service.checkTransactionRisk(normalDto, mockToken);
      expect(result).toBe(true);
      expect(httpServiceMock.patch).toHaveBeenCalled();
    });

    // TEST: TRANSACCIÓN SEGURA
    it('should APPROVE if amount <= 2000 and no risky history', async () => {
      const safeDto = { ...validDto, amount: 500 };

      accountViewModelMock.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ iban: validIban }),
      });
      cacheManagerMock.get.mockResolvedValue([]);
      httpServiceMock.get.mockReturnValue(of({ data: [] }));
      const result = await service.checkTransactionRisk(safeDto, mockToken);
      expect(result).toBe(false); // False (Safe transaction)
      // Aseguramos que no se ha creado ni actualizado ninguna alerta
      expect(fraudAlertModelMock.create).not.toHaveBeenCalled();
      expect(fraudAlertModelMock.findByIdAndUpdate).not.toHaveBeenCalled();
    });
  });

  // --- TESTS: HISTORIAL (GET) ---

  describe('getAlertsForAccount', () => {
    it('should return alerts if found', async () => {
      const mockAlerts = [{ _id: '1', origin: 'ES0012345678901234567890' }];
      fraudAlertModelMock.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockAlerts),
      });

      const result = await service.getAlertsForAccount(
        'ES0012345678901234567890',
        mockToken,
      );
      expect(result).toEqual(mockAlerts);
    });

    it('should throw NotFoundException if no alerts found', async () => {
      fraudAlertModelMock.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      });

      await expect(
        service.getAlertsForAccount('ES0012345678901234567890', mockToken),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // --- TESTS: PUT ---

  describe('updateAlert', () => {
    it('should update and return alert if exists', async () => {
      const updateDto = { status: AlertStatus.CONFIRMED };
      const existingAlert = {
        _id: '1',
        origin: 'ES0012345678901234567890',
        ...updateDto,
      };
      fraudAlertModelMock.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(existingAlert),
      });

      fraudAlertModelMock.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(existingAlert),
      });

      const result = await service.updateAlert('1', updateDto, mockToken);
      expect(result).toEqual(existingAlert);
    });
  });

  // --- TESTS: DELETE ---

  describe('deleteAlert', () => {
    it('should return success message if deleted', async () => {
      const existingAlert = { _id: '1', origin: 'ES0012345678901234567890' };
      fraudAlertModelMock.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(existingAlert),
      });

      fraudAlertModelMock.findByIdAndDelete.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: '1' }),
      });

      const result = await service.deleteAlert('1', mockToken);
      expect(result).toEqual({
        message: 'Alert deleted successfully',
        id: '1',
      });
    });

    it('should throw NotFoundException if alert not found', async () => {
      fraudAlertModelMock.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.deleteAlert('1', mockToken)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
