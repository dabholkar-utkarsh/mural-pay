import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  parseCompanySearchRequest,
  searchApolloCompanies,
} from '@mural/company-discovery';
import type { CompanySearchRequest } from '@mural/company-discovery';

@Injectable()
export class CompanyDiscoveryService {
  constructor(private readonly config: ConfigService) {}

  async search(body: unknown) {
    const apiKey = this.config.get<string>('APOLLO_API_KEY');

    if (!apiKey) {
      throw new InternalServerErrorException(
        'Missing APOLLO_API_KEY. Add it to apps/server/.env and restart the server.',
      );
    }

    // The pipeline's parser is the single source of truth for request
    // validation and normalization (it is unit-tested in the package).
    let request: CompanySearchRequest;

    try {
      request = parseCompanySearchRequest(body);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid company search request',
      );
    }

    try {
      return await searchApolloCompanies({
        apiKey,
        request,
        anthropicApiKey: this.config.get<string>('ANTHROPIC_API_KEY'),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Company search failed';

      if (message.includes('status 401')) {
        throw new UnauthorizedException('Apollo rejected the API key');
      }

      throw new BadGatewayException(message);
    }
  }
}
