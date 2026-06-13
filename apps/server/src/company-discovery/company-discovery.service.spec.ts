import {
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_FILTERS, searchApolloCompanies } from '@mural/company-discovery';
import { CompanyDiscoveryService } from './company-discovery.service';
import { SearchCache } from './search-cache';

jest.mock('@mural/company-discovery', () => ({
  ...jest.requireActual('@mural/company-discovery'),
  searchApolloCompanies: jest.fn(),
}));

const searchMock = searchApolloCompanies as jest.MockedFunction<
  typeof searchApolloCompanies
>;

function buildService(env: Record<string, string>) {
  const config = { get: (key: string) => env[key] } as ConfigService;
  // No-op cache: always a miss, so the search path runs as before.
  const cache = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  } as unknown as SearchCache;

  return new CompanyDiscoveryService(config, cache);
}

describe('CompanyDiscoveryService', () => {
  beforeEach(() => {
    searchMock.mockReset();
  });

  it('returns the pipeline result and passes both API keys through', async () => {
    const result = { companies: [], requestedLimit: 10, returnedCount: 0 };
    searchMock.mockResolvedValueOnce(result);

    const service = buildService({
      APOLLO_API_KEY: 'apollo-key',
      ANTHROPIC_API_KEY: 'anthropic-key',
    });

    await expect(
      service.search({ filters: DEFAULT_FILTERS, limit: 10 }),
    ).resolves.toBe(result);

    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'apollo-key',
        anthropicApiKey: 'anthropic-key',
        request: { filters: DEFAULT_FILTERS, limit: 10 },
      }),
    );
  });

  it('responds 500 when the Apollo key is not configured', async () => {
    const service = buildService({});

    await expect(
      service.search({ filters: DEFAULT_FILTERS, limit: 10 }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('responds 400 on an invalid request body', async () => {
    const service = buildService({ APOLLO_API_KEY: 'apollo-key' });

    await expect(service.search({ limit: 10 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('maps an Apollo 401 to UnauthorizedException', async () => {
    searchMock.mockRejectedValueOnce(
      new Error('Apollo search failed with status 401'),
    );

    const service = buildService({ APOLLO_API_KEY: 'bad-key' });

    await expect(
      service.search({ filters: DEFAULT_FILTERS, limit: 10 }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
