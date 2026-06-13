import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  getClientIp,
  searchRateLimiter,
} from '../common/search-rate-limit';

@Injectable()
export class SearchRateLimitGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const clientIp = getClientIp(
      request.headers,
      request.socket.remoteAddress,
    );
    const result = searchRateLimiter.check(clientIp);

    if (!result.allowed) {
      const minutes = Math.ceil(result.retryAfterSeconds / 60);

      throw new HttpException(
        `Search limit reached (10 per hour). Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
