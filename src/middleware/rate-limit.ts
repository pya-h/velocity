import { VelocityRequest, VelocityResponse } from '../types';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  message?: string;
  keyGenerator?: (req: VelocityRequest) => string;
}

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

export class RateLimitMiddleware {
  private store: RateLimitStore = {};

  constructor(private options: RateLimitOptions) {}

  public use(req: VelocityRequest, res: VelocityResponse, next: () => void): void {
    const key = this.options.keyGenerator 
      ? this.options.keyGenerator(req)
      : this.getClientKey(req);

    const now = Date.now();
    const windowStart = now - this.options.windowMs;

    this.cleanup(windowStart);

    let entry = this.store[key];
    if (!entry || entry.resetTime <= now) {
      entry = { count: 0, resetTime: now + this.options.windowMs };
      this.store[key] = entry;
    }

    entry.count++;

    res.setHeader('X-RateLimit-Limit', this.options.max.toString());
    res.setHeader('X-RateLimit-Remaining', Math.max(0, this.options.max - entry.count).toString());
    res.setHeader('X-RateLimit-Reset', new Date(entry.resetTime).toISOString());

    if (entry.count > this.options.max) {
      const message = this.options.message || 'Too many requests';
      res.status(429).json({ error: message });
      return;
    }

    next();
  }

  private getClientKey(req: VelocityRequest): string {
    return req.headers['x-forwarded-for'] as string || 
           req.headers['x-real-ip'] as string ||
           req.socket?.remoteAddress || 
           'unknown';
  }

  private cleanup(windowStart: number): void {
    Object.keys(this.store).forEach(key => {
      if (this.store[key].resetTime <= windowStart) {
        delete this.store[key];
      }
    });
  }
}
