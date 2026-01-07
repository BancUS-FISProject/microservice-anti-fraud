import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { Model } from 'mongoose';
import { AccountView } from '../src/anti-fraud/schemas/account.view.schema';
import { FraudAlert } from '../src/anti-fraud/schemas/fraud-alert.schema';

const mockToken =
  'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYmFuIjoiRVMwMDEyMzQ1Njc4OTAxMjM0NTY3ODkwIn0.firma_falsa';

interface TransactionResponse {
  message: string;
}

interface AlertResponse {
  _id: string;
  origin: string;
  status: string;
}

describe('AntiFraudController (e2e)', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let accountModel: Model<AccountView>;
  let alertModel: Model<FraudAlert>;

  // Valid IBANs for testing
  const VALID_IBAN_ORIGIN = 'ES0012345678901234567890';
  const VALID_IBAN_DEST = 'ES2400491845342106661369';

  const httpServiceMock = {
    get: jest.fn(),
    patch: jest.fn(),
    post: jest.fn(),
  };

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri();
  });

  afterAll(async () => {
    if (mongod) await mongod.stop();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(process.env.MONGO_URI!), AppModule],
    })
      .overrideProvider(HttpService)
      .useValue(httpServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    accountModel = moduleFixture.get<Model<AccountView>>(
      getModelToken(AccountView.name),
    );
    alertModel = moduleFixture.get<Model<FraudAlert>>(
      getModelToken(FraudAlert.name),
    );
    await app.init();
  });

  // Full cleanup after each test
  afterEach(async () => {
    await accountModel.deleteMany({});
    await alertModel.deleteMany({});
    await app.close(); // Closes the connection and prevents the Jest warning
  });

  // --- TEST 1: Safe Transaction ---
  it('/v1/antifraud/transaction-check (POST) - Safe Transaction', async () => {
    // Mock: Historial vacío y cuenta ok
    httpServiceMock.get.mockImplementation((url: string) => {
      if (url.includes('/transactions')) return of({ data: [] });
      if (url.includes('/accounts')) return of({ data: { items: [] } });
      return of({ data: [] });
    });

    await accountModel.create({
      iban: VALID_IBAN_ORIGIN,
      status: 'active',
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return request(app.getHttpServer())
      .post('/v1/antifraud/transaction-check')
      .set('Authorization', mockToken)
      .send({
        origin: VALID_IBAN_ORIGIN,
        destination: VALID_IBAN_DEST,
        amount: 500, // 500 < 2000 (Safe)
        transactionDate: new Date().toISOString(),
      })
      .expect(200)
      .expect((res) => {
        const body = res.body as TransactionResponse;
        expect(body.message).toBe('No risk detected');
      });
  });

  // --- TEST 2: REGLA 1 - Immediate Block (> 2000) ---
  it('/v1/antifraud/transaction-check (POST) - Fraud Detected (Immediate > 2000)', async () => {
    await accountModel.create({
      iban: VALID_IBAN_ORIGIN,
      status: 'active',
    });

    // Mock: Historial vacío (Para demostrar que bloquea sin mirar historial)
    // Mock: Patch (bloqueo) devuelve OK
    httpServiceMock.get.mockReturnValue(of({ data: [] }));
    httpServiceMock.patch.mockReturnValue(of({ status: 200 }));
    httpServiceMock.post.mockReturnValue(of({ status: 200 })); // Notification
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return request(app.getHttpServer())
      .post('/v1/antifraud/transaction-check')
      .set('Authorization', mockToken)
      .send({
        origin: VALID_IBAN_ORIGIN,
        destination: VALID_IBAN_DEST,
        amount: 2500,
        transactionDate: new Date().toISOString(),
      })
      .expect(200)
      .expect((res) => {
        const body = res.body as TransactionResponse;
        expect(body.message).toContain('Fraudulent behaviour detected');
      });
  });

  // --- TEST 3: REGLA 2 - Pattern Block (Amount < 2000 but History Dirty) ---
  it('/v1/antifraud/transaction-check (POST) - Fraud Detected (Pattern Analysis)', async () => {
    await accountModel.create({
      iban: VALID_IBAN_ORIGIN,
      status: 'active',
    });

    // Devolvemos historial con 2 transacciones de 1500 (> 1000) recientes
    httpServiceMock.get.mockImplementation((url: string) => {
      if (url.includes('/transactions')) {
        return of({
          data: [
            {
              date: new Date().toISOString(),
              quantity: 1500,
              sender: VALID_IBAN_ORIGIN,
            },
            {
              date: new Date().toISOString(),
              quantity: 1500,
              sender: VALID_IBAN_ORIGIN,
            },
          ],
        });
      }
      return of({ data: [] });
    });
    httpServiceMock.patch.mockReturnValue(of({ status: 200 }));
    httpServiceMock.post.mockReturnValue(of({ status: 200 }));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return request(app.getHttpServer())
      .post('/v1/antifraud/transaction-check')
      .set('Authorization', mockToken)
      .send({
        origin: VALID_IBAN_ORIGIN,
        destination: VALID_IBAN_DEST,
        amount: 1200, // < 2000 (Pasa el primer filtro)
        transactionDate: new Date().toISOString(),
      })
      .expect(200)
      .expect((res) => {
        const body = res.body as TransactionResponse;
        expect(body.message).toContain('Fraudulent behaviour detected');
      });
  });

  // --- TEST 4: Validation (Bad Request) ---
  it('/v1/antifraud/transaction-check (POST) - Bad Request', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return request(app.getHttpServer())
      .post('/v1/antifraud/transaction-check')
      .set('Authorization', mockToken)
      .send({
        origin: VALID_IBAN_ORIGIN,
        amount: 500,
      })
      .expect(400);
  });

  // --- TEST 4: GET ---
  it('/v1/antifraud/accounts/:iban/fraud-alerts (GET) - Retrieve Alerts', async () => {
    // 1. SEED: Create a fake alert in DB
    await alertModel.create({
      origin: VALID_IBAN_ORIGIN,
      destination: VALID_IBAN_DEST,
      amount: 5000,
      transactionDate: new Date(),
      reason: 'Test Alert',
      status: 'PENDING',
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return request(app.getHttpServer())
      .get(`/v1/antifraud/accounts/${VALID_IBAN_ORIGIN}/fraud-alerts`)
      .set('Authorization', mockToken)
      .expect(200)
      .expect((res) => {
        const body = res.body as AlertResponse[];
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBe(1);
        expect(body[0].origin).toBe(VALID_IBAN_ORIGIN);
        expect(body[0].status).toBe('PENDING');
      });
  });

  // --- TEST 5: PUT ---
  it('/v1/antifraud/fraud-alerts/:id (PUT) - Update Alert Status', async () => {
    const alert = await alertModel.create({
      origin: VALID_IBAN_ORIGIN,
      destination: VALID_IBAN_DEST,
      amount: 9000,
      transactionDate: new Date(),
      reason: 'Huge amount',
      status: 'PENDING',
    });

    const alertId = alert._id.toString();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return request(app.getHttpServer())
      .put(`/v1/antifraud/fraud-alerts/${alertId}`)
      .set('Authorization', mockToken)
      .send({ status: 'CONFIRMED' }) // Ensure this matches your UpdateFraudAlertDto
      .expect(200)
      .expect((res) => {
        const body = res.body as AlertResponse;
        expect(body.status).toBe('CONFIRMED');
        expect(body._id).toBe(alertId);
      });
  });

  // --- TEST 6: DELETE ---
  it('/v1/antifraud/fraud-alerts/:id (DELETE) - Remove Alert', async () => {
    const alert = await alertModel.create({
      origin: VALID_IBAN_ORIGIN,
      destination: VALID_IBAN_DEST,
      amount: 100,
      transactionDate: new Date(),
      reason: 'To delete',
      status: 'FALSE_POSITIVE',
    });

    const alertId = alert._id.toString();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await request(app.getHttpServer())
      .delete(`/v1/antifraud/fraud-alerts/${alertId}`)
      .set('Authorization', mockToken)
      .expect(200);

    const found = await alertModel.findById(alertId);
    expect(found).toBeNull();
  });
});
