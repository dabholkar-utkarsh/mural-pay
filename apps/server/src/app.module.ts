import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CompanyDiscoveryModule } from './company-discovery/company-discovery.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), CompanyDiscoveryModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
