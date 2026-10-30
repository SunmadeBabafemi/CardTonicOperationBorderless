import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { configureApplication } from './core/bootstrap';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApplication(app);
  app.enableShutdownHooks();
  await app.listen(
    app.get(ConfigService).getOrThrow<number>('PORT'),
    '0.0.0.0',
  );
}
void bootstrap().catch(() => {
  Logger.error(
    'BorderFlow startup failed; check configuration and database availability',
  );
  process.exitCode = 1;
});
