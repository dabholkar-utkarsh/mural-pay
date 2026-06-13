import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CompanyDiscoveryService } from './company-discovery.service';
import { SearchRateLimitGuard } from './search-rate-limit.guard';

@Controller('company-search')
export class CompanyDiscoveryController {
  constructor(private readonly companyDiscovery: CompanyDiscoveryService) {}

  @Post()
  @UseGuards(SearchRateLimitGuard)
  search(@Body() body: unknown) {
    return this.companyDiscovery.search(body);
  }
}
