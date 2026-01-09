import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { HealthService } from './health/health.service';
import { ValidationPipe, Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Esto asegura que todos los endpoints validen automáticamente el cuerpo de la petición
  // basándose en los decoradores (@IsString, @IsNumber, ...) de los DTOs.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Anti-Fraud Microservice')
    .setDescription('API for banking fraud detection and reporting')
    .setVersion('1.0')
    .addTag('Anti-Fraud')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        in: 'header',
      },
      'access-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    deepScanRoutes: true, // Incluye el prefijo de versión en los paths de Swagger
  });
  SwaggerModule.setup('api', app, document); // La documentacion estara en /api

  await app.startAllMicroservices();
  await app.listen(process.env.PORT ?? 3000);

  const health = app.get(HealthService);
  health.markReady();
}
bootstrap().catch((error: unknown) => {
  Logger.log('Error starting server', error);
  process.exit(1);
});
