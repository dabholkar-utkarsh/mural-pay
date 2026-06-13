export const SEARCH_RATE_LIMIT_MAX = 10;
export const SEARCH_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

type RateLimitStore = Map<string, number[]>;

export function getClientIp(
  headers: Record<string, string | string[] | undefined>,
  fallback?: string,
): string {
  const forwarded = headers['x-forwarded-for'];

  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() || fallback || 'unknown';
  }

  if (Array.isArray(forwarded) && forwarded[0]) {
    return forwarded[0].split(',')[0]?.trim() || fallback || 'unknown';
  }

  return fallback || 'unknown';
}

export function createSearchRateLimiter(store: RateLimitStore = new Map()) {
  return {
    check(key: string): RateLimitResult {
      const now = Date.now();
      const windowStart = now - SEARCH_RATE_LIMIT_WINDOW_MS;
      const timestamps = (store.get(key) ?? []).filter(
        (timestamp) => timestamp > windowStart,
      );

      if (timestamps.length >= SEARCH_RATE_LIMIT_MAX) {
        const oldest = timestamps[0] ?? now;
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil(
            (oldest + SEARCH_RATE_LIMIT_WINDOW_MS - now) / 1000,
          ),
        );

        return { allowed: false, retryAfterSeconds };
      }

      timestamps.push(now);
      store.set(key, timestamps);

      return { allowed: true };
    },

    reset(key?: string) {
      if (key) {
        store.delete(key);
        return;
      }

      store.clear();
    },
  };
}

export const searchRateLimiter = createSearchRateLimiter();
