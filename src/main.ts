import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 2. Conectar el Microservicio RabbitMQ. Esto hace que la app escuche en la cola 'antifraud_queue'
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [process.env.RABBITMQ_URL || 'amqp://localhost:5672'],
      queue: 'antifraud_queue', // Nombre de la cola de este microservicio, donde se conectaran el resto de microservicios.
      queueOptions: {
        durable: false
      },
    },
  });


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

  await app.startAllMicroservices();
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();