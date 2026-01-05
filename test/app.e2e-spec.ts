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
  const VALID_IBAN_ORIGIN = 'ES7621000418450200051332';
  const VALID_IBAN_DEST = 'ES2400491845342106661369';

  const httpServiceMock = {
    get: jest.fn(),
    patch: jest.fn(),
  };

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri();
  });

  afterAll(async () => {
    if (mongod) await mongod.stop();
  });

  beforeEach(async () => {
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
    // 1. Create the account in the DB
    await accountModel.create({
      iban: VALID_IBAN_ORIGIN,
      status: 'active',
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return request(app.getHttpServer())
      .post('/v1/antifraud/transaction-check')
      .send({
        origin: VALID_IBAN_ORIGIN,
        destination: VALID_IBAN_DEST,
        amount: 500, // Low amount
        transactionDate: new Date().toISOString(),
      })
      .expect(200)
      .expect((res) => {
        const body = res.body as TransactionResponse;
        expect(body.message).toBe('Transaction approved');
      });
  });

  // --- TEST 2: Fraud Detected ---
  it('/v1/antifraud/transaction-check (POST) - Fraud Detected', async () => {
    // 1. Create the account in the DB
    await accountModel.create({
      iban: VALID_IBAN_ORIGIN,
      status: 'active',
    });

    // 2. MOCK HTTP
    httpServiceMock.get.mockImplementation((url: string) => {
      if (url.includes('/transactions')) {
        return of({
          data: [
            {
              // Old transaction 1 (high amount)
              date: new Date(Date.now() - 100000).toISOString(),
              quantity: 3000,
              sender: VALID_IBAN_ORIGIN,
            },
            {
              // Old transaction 2 (high amount)
              date: new Date(Date.now() - 200000).toISOString(),
              quantity: 4500,
              sender: VALID_IBAN_ORIGIN,
            },
          ],
        });
      }
      return of({ data: [] });
    });

    httpServiceMock.patch.mockReturnValue(of({ status: 200 }));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return request(app.getHttpServer())
      .post('/v1/antifraud/transaction-check')
      .send({
        origin: VALID_IBAN_ORIGIN,
        destination: VALID_IBAN_DEST,
        amount: 5000,
        transactionDate: new Date().toISOString(),
      })
      .expect(200)
      .expect((res) => {
        const body = res.body as TransactionResponse;
        expect(body.message).toContain('Fraudulent behaviour detected');
      });
  });

  // --- TEST 3: Validation (Bad Request) ---
  it('/v1/antifraud/transaction-check (POST) - Bad Request', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return request(app.getHttpServer())
      .post('/v1/antifraud/transaction-check')
      .send({
        origin: 'INVALID-IBAN', // This must fail due to DTO
        amount: -500,
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
      .expect(200);

    const found = await alertModel.findById(alertId);
    expect(found).toBeNull();
  });
});
