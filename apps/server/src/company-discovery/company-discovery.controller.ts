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

  // Reverse ICP: derive filters/signals from example company domains.
  // Shares the search rate limit — it spends the same Apollo/Anthropic credits.
  @Post('derive-icp')
  @UseGuards(SearchRateLimitGuard)
  deriveIcp(@Body() body: unknown) {
    return this.companyDiscovery.deriveIcp(body);
  }
}
