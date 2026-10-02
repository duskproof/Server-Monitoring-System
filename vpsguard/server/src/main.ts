import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  const prefix = config.get<string>('app.apiPrefix');
  // Installer assets live at the origin root so generated one-liners stay short.
  app.setGlobalPrefix(prefix, {
    exclude: [
      'install.sh',
      'download/vpsguard-agent.tar.gz',
      'download/vpsguard-agent.service',
    ],
  });

  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.enableCors({
    origin: config.get<string[]>('app.corsOrigins'),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      // Agent payloads carry a free-form metrics object, so unknown keys are tolerated.
      forbidNonWhitelisted: false,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('VPSGuard API')
    .setDescription('Central server API for VPS/VDS monitoring, alerting and remote management')
    .setVersion('1.0.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'agent-api-key')
    .build();
  SwaggerModule.setup(
    `${prefix}/docs`,
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
    { swaggerOptions: { persistAuthorization: true } },
  );

  const port = config.get<number>('app.port');
  await app.listen(port, '0.0.0.0');

  logger.log(`VPSGuard server listening on port ${port}`);
  logger.log(`API base:   /${prefix}`);
  logger.log(`Swagger UI: /${prefix}/docs`);
}

void bootstrap();
