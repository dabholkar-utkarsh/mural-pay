import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Bind to :: (all IPv6, plus IPv4 on dual-stack). Railway's private
  // network is IPv6-only, so the default bind leaves the service
  // unreachable over private networking.
  await app.listen(process.env.PORT ?? 4000, '::');
}
bootstrap();
