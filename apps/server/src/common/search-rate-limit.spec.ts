import {
  createSearchRateLimiter,
  getClientIp,
  SEARCH_RATE_LIMIT_MAX,
  SEARCH_RATE_LIMIT_WINDOW_MS,
} from './search-rate-limit';

describe('getClientIp', () => {
  it('reads the first address from X-Forwarded-For', () => {
    expect(
      getClientIp({ 'x-forwarded-for': '203.0.113.1, 10.0.0.1' }),
    ).toBe('203.0.113.1');
  });

  it('falls back to the socket address', () => {
    expect(getClientIp({}, '127.0.0.1')).toBe('127.0.0.1');
  });
});

describe('createSearchRateLimiter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows up to 10 searches per hour for a client', () => {
    const limiter = createSearchRateLimiter();

    for (let i = 0; i < SEARCH_RATE_LIMIT_MAX; i++) {
      expect(limiter.check('client-a')).toEqual({ allowed: true });
    }

    expect(limiter.check('client-a')).toEqual({
      allowed: false,
      retryAfterSeconds: SEARCH_RATE_LIMIT_WINDOW_MS / 1000,
    });
  });

  it('tracks clients independently', () => {
    const limiter = createSearchRateLimiter();

    for (let i = 0; i < SEARCH_RATE_LIMIT_MAX; i++) {
      limiter.check('client-a');
    }

    expect(limiter.check('client-b')).toEqual({ allowed: true });
  });

  it('expires entries after the hour window', () => {
    const limiter = createSearchRateLimiter();

    for (let i = 0; i < SEARCH_RATE_LIMIT_MAX; i++) {
      limiter.check('client-a');
    }

    jest.advanceTimersByTime(SEARCH_RATE_LIMIT_WINDOW_MS + 1);

    expect(limiter.check('client-a')).toEqual({ allowed: true });
  });
});
