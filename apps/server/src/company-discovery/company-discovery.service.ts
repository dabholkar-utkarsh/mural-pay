import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  deriveIcpFromExamples,
  parseCompanySearchRequest,
  parseDeriveIcpRequest,
  searchApolloCompanies,
} from '@mural/company-discovery';
import type {
  CompanySearchRequest,
  DeriveIcpRequest,
} from '@mural/company-discovery';
import { SearchCache } from './search-cache';

// Deterministic JSON so semantically identical requests hash to the same key
// regardless of property order.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

@Injectable()
export class CompanyDiscoveryService {
  constructor(
    private readonly config: ConfigService,
    private readonly cache: SearchCache,
  ) {}

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

    const cacheKey = createHash('sha256')
      .update(stableStringify(request))
      .digest('hex');

    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const result = await searchApolloCompanies({
        apiKey,
        request,
        anthropicApiKey: this.config.get<string>('ANTHROPIC_API_KEY'),
      });

      await this.cache.set(cacheKey, result);

      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Company search failed';

      if (message.includes('status 401')) {
        throw new UnauthorizedException('Apollo rejected the API key');
      }

      throw new BadGatewayException(message);
    }
  }

  // Reverse ICP: enrich example domains and derive the filters/signals that
  // would find lookalikes. Shares the search cache (different key namespace).
  async deriveIcp(body: unknown) {
    const apiKey = this.config.get<string>('APOLLO_API_KEY');

    if (!apiKey) {
      throw new InternalServerErrorException(
        'Missing APOLLO_API_KEY. Add it to apps/server/.env and restart the server.',
      );
    }

    let request: DeriveIcpRequest;

    try {
      request = parseDeriveIcpRequest(body);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid ICP derive request',
      );
    }

    const cacheKey = createHash('sha256')
      .update(stableStringify({ kind: 'icp-derive', request }))
      .digest('hex');

    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const result = await deriveIcpFromExamples({
        apiKey,
        request,
        anthropicApiKey: this.config.get<string>('ANTHROPIC_API_KEY'),
      });

      await this.cache.set(cacheKey, result);

      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'ICP derivation failed';

      if (message.includes('status 401')) {
        throw new UnauthorizedException('Apollo rejected the API key');
      }

      if (message.includes('could not enrich')) {
        throw new BadRequestException(message);
      }

      throw new BadGatewayException(message);
    }
  }
}
