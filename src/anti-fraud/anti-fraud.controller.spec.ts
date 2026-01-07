import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AntiFraudController } from './anti-fraud.controller';
import { AntiFraudService } from './anti-fraud.service';
import { CheckTransactionDto } from './dto/check-transaction.dto';
import { UpdateFraudAlertDto, AlertStatus } from './dto/update-fraud-alert.dto';

describe('AntiFraudController', () => {
  let controller: AntiFraudController;
  let service: AntiFraudService;
  const mockToken =
    'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYmFuIjoiRVMwMDEyMzQ1Njc4OTAxMjM0NTY3ODkwIn0.firma_falsa';

  const mockAntiFraudService = {
    checkTransactionRisk: jest.fn(),
    getAlertsForAccount: jest.fn(),
    updateAlert: jest.fn(),
    deleteAlert: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AntiFraudController],
      providers: [
        {
          provide: AntiFraudService,
          useValue: mockAntiFraudService,
        },
      ],
    }).compile();

    controller = module.get<AntiFraudController>(AntiFraudController);
    service = module.get<AntiFraudService>(AntiFraudService);

    // Limpiamos los mocks antes de cada test para que no se mezclen llamadas
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // --- TEST: POST /check (Transacción Segura) ---
  describe('checkTransaction', () => {
    it('should return approved message if transaction is safe', async () => {
      const dto: CheckTransactionDto = {
        origin: 'ES0012345678901234567890',
        destination: 'ES456',
        amount: 500,
        transactionDate: new Date(),
      };

      // Simulamos que el servicio dice "No hay riesgo" (false)
      mockAntiFraudService.checkTransactionRisk.mockResolvedValue(false);

      const result = await controller.checkTransaction(dto, mockToken);

      expect(result).toEqual({ message: 'No risk detected' });
      expect(service.checkTransactionRisk).toHaveBeenCalledWith(dto, mockToken);
    });

    // --- TEST: POST /check (Fraude Detectado - 200 OK con aviso) ---
    it('should return fraud warning if risk is detected', async () => {
      const dto: CheckTransactionDto = {
        origin: 'ES0012345678901234567890',
        destination: 'ES-BAD',
        amount: 5000,
        transactionDate: new Date(),
      };

      // Simulamos que el servicio dice "Riesgo detectado" (true)
      mockAntiFraudService.checkTransactionRisk.mockResolvedValue(true);

      const result = await controller.checkTransaction(dto, mockToken);

      // Verificamos que devuelve el mensaje de advertencia
      expect(result.message).toContain('Fraudulent behaviour detected');
      expect(service.checkTransactionRisk).toHaveBeenCalledWith(dto, mockToken);
    });

    // --- TEST: POST /check caso sin token (validación de seguridad) ---
    it('should throw UnauthorizedException if header is missing', async () => {
      const dto: CheckTransactionDto = {
        origin: 'ES0012345678901234567890',
        destination: 'ES456',
        amount: 5000,
        transactionDate: new Date(),
      };

      // Simulamos que el servicio dice "Riesgo detectado" (true)
      await expect(
        controller.checkTransaction(dto, undefined as unknown as string),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // --- TEST: GET /history ---
  describe('getAccountAlerts', () => {
    it('should return a list of alerts', async () => {
      const mockAlerts = [{ id: '1', status: 'PENDING' }];
      mockAntiFraudService.getAlertsForAccount.mockResolvedValue(mockAlerts);

      const result = await controller.getAccountAlerts(
        'ES0012345678901234567890',
        mockToken,
      );

      expect(result).toEqual(mockAlerts);
      expect(service.getAlertsForAccount).toHaveBeenCalledWith(
        'ES0012345678901234567890',
        mockToken,
      );
    });
  });

  // --- TEST: PUT /update ---
  describe('updateAlert', () => {
    it('should update an alert', async () => {
      const dto: UpdateFraudAlertDto = { status: AlertStatus.CONFIRMED };
      const updated = { id: '1', ...dto };

      mockAntiFraudService.updateAlert.mockResolvedValue(updated);

      const result = await controller.updateAlert('1', dto, mockToken);

      expect(result).toEqual(updated);
      expect(service.updateAlert).toHaveBeenCalledWith('1', dto, mockToken);
    });
  });

  // --- TEST: DELETE /delete ---
  describe('deleteAlert', () => {
    it('should delete an alert', async () => {
      const response = { message: 'Deleted', id: '1' };
      mockAntiFraudService.deleteAlert.mockResolvedValue(response);

      const result = await controller.deleteAlert('1', mockToken);

      expect(result).toEqual(response);
      expect(service.deleteAlert).toHaveBeenCalledWith('1', mockToken);
    });
  });
});
