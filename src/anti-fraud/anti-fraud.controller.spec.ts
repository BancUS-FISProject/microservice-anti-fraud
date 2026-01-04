import { Test, TestingModule } from '@nestjs/testing';
import { AntiFraudController } from './anti-fraud.controller';
import { AntiFraudService } from './anti-fraud.service';
import { CheckTransactionDto } from './dto/check-transaction.dto';
import { UpdateFraudAlertDto, AlertStatus } from './dto/update-fraud-alert.dto';

describe('AntiFraudController', () => {
  let controller: AntiFraudController;
  let service: AntiFraudService;

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
        origin: 'ES123',
        destination: 'ES456',
        amount: 500,
        transactionDate: new Date(),
      };

      // Simulamos que el servicio dice "No hay riesgo" (false)
      mockAntiFraudService.checkTransactionRisk.mockResolvedValue(false);

      const result = await controller.checkTransaction(dto);

      expect(result).toEqual({ message: 'Transaction approved' });
      expect(service.checkTransactionRisk).toHaveBeenCalledWith(dto);
    });

    // --- TEST: POST /check (Fraude Detectado - 200 OK con aviso) ---
    it('should return fraud warning if risk is detected', async () => {
      const dto: CheckTransactionDto = {
        origin: 'ES123',
        destination: 'ES-BAD',
        amount: 5000,
        transactionDate: new Date(),
      };

      // Simulamos que el servicio dice "Riesgo detectado" (true)
      mockAntiFraudService.checkTransactionRisk.mockResolvedValue(true);

      const result = await controller.checkTransaction(dto);

      // Verificamos que devuelve el mensaje de advertencia
      expect(result.message).toContain('Fraudulent behaviour detected');
      expect(service.checkTransactionRisk).toHaveBeenCalledWith(dto);
    });
  });

  // --- TEST: GET /history ---
  describe('getAccountAlerts', () => {
    it('should return a list of alerts', async () => {
      const mockAlerts = [{ id: '1', status: 'PENDING' }];
      mockAntiFraudService.getAlertsForAccount.mockResolvedValue(mockAlerts);

      const result = await controller.getAccountAlerts('ES123');

      expect(result).toEqual(mockAlerts);
      expect(service.getAlertsForAccount).toHaveBeenCalledWith('ES123');
    });
  });

  // --- TEST: PUT /update ---
  describe('updateAlert', () => {
    it('should update an alert', async () => {
      const dto: UpdateFraudAlertDto = { status: AlertStatus.CONFIRMED };
      const updated = { id: '1', ...dto };

      mockAntiFraudService.updateAlert.mockResolvedValue(updated);

      const result = await controller.updateAlert('1', dto);

      expect(result).toEqual(updated);
      expect(service.updateAlert).toHaveBeenCalledWith('1', dto);
    });
  });

  // --- TEST: DELETE /delete ---
  describe('deleteAlert', () => {
    it('should delete an alert', async () => {
      const response = { message: 'Deleted', id: '1' };
      mockAntiFraudService.deleteAlert.mockResolvedValue(response);

      const result = await controller.deleteAlert('1');

      expect(result).toEqual(response);
      expect(service.deleteAlert).toHaveBeenCalledWith('1');
    });
  });
});
