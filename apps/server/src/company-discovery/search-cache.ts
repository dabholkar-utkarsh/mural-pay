import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

// Company + AI-judgment data is stable day-to-day, so a day-long TTL maximizes
// the savings on repeat Apollo/Anthropic calls while still refreshing daily.
const TTL_SECONDS = 60 * 60 * 24;
const KEY_PREFIX = 'company-search:v1:';

/**
 * Redis-backed cache for company search results. Fail-open by design: if
 * REDIS_URL is unset or Redis is unreachable, every operation is a no-op and
 * search proceeds uncached. A cache problem must never break a search.
 */
@Injectable()
export class SearchCache implements OnModuleDestroy {
  private readonly logger = new Logger(SearchCache.name);
  private readonly client: Redis | null;

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL');

    if (!url) {
      this.client = null;
      this.logger.log('REDIS_URL not set; search caching disabled.');
      return;
    }

    this.client = new Redis(url, {
      // Fail fast instead of queueing/retrying forever when Redis is down, so
      // a degraded cache adds at most a brief delay before falling through.
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });

    this.client.on('error', (err) => {
      this.logger.warn(`Redis unavailable, serving uncached: ${err.message}`);
    });
  }

  async get(key: string): Promise<unknown | null> {
    if (!this.client) return null;

    try {
      const raw = await this.client.get(KEY_PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    if (!this.client) return;

    try {
      await this.client.set(
        KEY_PREFIX + key,
        JSON.stringify(value),
        'EX',
        TTL_SECONDS,
      );
    } catch {
      // Ignore: a failed write just means the next identical search recomputes.
    }
  }

  onModuleDestroy() {
    this.client?.disconnect();
  }
}
