import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle('Anti-Fraud Microservice')
    .setDescription('API for banking fraud detection and reporting')
    .setVersion('1.0')
    .addTag('Anti-Fraud')
    .build();

  const document = SwaggerModule.createDocument(app, config,  {
    deepScanRoutes: true, // Incluye el prefijo de versión en los paths de Swagger
  });
  SwaggerModule.setup('api', app, document); // La documentacion estara en /api


  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
