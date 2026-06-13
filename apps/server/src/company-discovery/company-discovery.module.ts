import { Module } from '@nestjs/common';
import { CompanyDiscoveryController } from './company-discovery.controller';
import { CompanyDiscoveryService } from './company-discovery.service';
import { SearchCache } from './search-cache';
import { SearchRateLimitGuard } from './search-rate-limit.guard';

@Module({
  controllers: [CompanyDiscoveryController],
  providers: [CompanyDiscoveryService, SearchCache, SearchRateLimitGuard],
})
export class CompanyDiscoveryModule {}
