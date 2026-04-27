import '../src/core/metadata';
import { Suite, Test, BeforeEach, expect, mock } from '../src/testing/decorators';
import { describe, test, expect as bunExpect } from 'bun:test';
import { VelocityApplication } from '../src/core/application';
import { Controller } from '../src/decorators/controller';
import { Get, Post } from '../src/decorators/route';
import { Middlewares } from '../src/decorators/middleware';
import { TestUtils } from '../src/testing/test-utils';
import { CorsMiddleware } from '../src/middleware/cors';
import { RateLimitMiddleware } from '../src/middleware/rate-limit';
import { MiddlewareFunction, VelocityRequest, VelocityResponse } from '../src/types';

// ─── Middleware chain ────────────────────────────────────────────────────────

@Suite('Middleware chain')
class MiddlewareChainTests {
  private app!: VelocityApplication;

  @BeforeEach
  setup() {
    this.app = TestUtils.createTestApp();
  }

  @Test('middleware is called before the handler')
  async beforeHandler() {
    const order: string[] = [];

    const mid: MiddlewareFunction = (_req, _res, next) => { order.push('middleware'); next(); };

    @Controller('/test')
    class TestCtrl {
      @Get('/')
      @Middlewares(mid)
      handle() { order.push('handler'); return 'ok'; }
    }

    this.app.register(TestCtrl);
    await TestUtils.makeRequest(this.app, { method: 'GET', path: '/test' });
    expect(order).toEqual(['middleware', 'handler']);
  }

  @Test('middleware that does not call next() blocks the handler')
  async blockingMiddleware() {
    const blocker: MiddlewareFunction = (_req, res, _next) => {
      res.status(403).json({ error: 'forbidden' });
    };

    @Controller('/guarded')
    class GuardedCtrl {
      @Get('/')
      @Middlewares(blocker)
      handle() { return 'should not reach here'; }
    }

    this.app.register(GuardedCtrl);
    const { status, body } = await TestUtils.makeRequest(this.app, { method: 'GET', path: '/guarded' });
    expect(status).toBe(403);
    expect(body.error).toBe('forbidden');
  }

  @Test('multiple middlewares execute in declaration order')
  async multipleInOrder() {
    const log: string[] = [];
    const mw1: MiddlewareFunction = (_q, _s, n) => { log.push('mw1'); n(); };
    const mw2: MiddlewareFunction = (_q, _s, n) => { log.push('mw2'); n(); };

    @Controller('/ordered')
    class OrderedCtrl {
      @Get('/')
      @Middlewares(mw1, mw2)
      handle() { return 'ok'; }
    }

    this.app.register(OrderedCtrl);
    await TestUtils.makeRequest(this.app, { method: 'GET', path: '/ordered' });
    expect(log).toEqual(['mw1', 'mw2']);
  }

  @Test('registration-level middleware runs before route-level middleware')
  async registrationLevelFirst() {
    const log: string[] = [];
    const regMw:   MiddlewareFunction = (_q, _s, n) => { log.push('reg');   n(); };
    const routeMw: MiddlewareFunction = (_q, _s, n) => { log.push('route'); n(); };

    @Controller('/layered')
    class LayeredCtrl {
      @Get('/')
      @Middlewares(routeMw)
      handle() { return 'ok'; }
    }

    this.app.register(LayeredCtrl, { middleware: [regMw] });
    await TestUtils.makeRequest(this.app, { method: 'GET', path: '/layered' });
    expect(log).toEqual(['reg', 'route']);
  }
}

// ─── CorsMiddleware (unit tests, no server) ─────────────────────────────────

describe('CorsMiddleware', () => {
  test('sets Access-Control-Allow-Origin header', () => {
    const cors = new CorsMiddleware({ origin: 'https://example.com' });
    const req  = TestUtils.createMockRequest({ headers: { origin: 'https://example.com' } });
    const res  = TestUtils.createMockResponse();
    let nextCalled = false;
    cors.use(req, res, () => { nextCalled = true; });
    bunExpect(res.headers['access-control-allow-origin']).toBe('https://example.com');
    bunExpect(nextCalled).toBe(true);
  });

  test('does not set origin header when origin is not in allowlist', () => {
    const cors = new CorsMiddleware({ origin: ['https://allowed.com'] });
    const req  = TestUtils.createMockRequest({ headers: { origin: 'https://evil.com' } });
    const res  = TestUtils.createMockResponse();
    cors.use(req, res, () => {});
    bunExpect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('handles OPTIONS preflight — calls status(204) and skips next()', () => {
    const cors = new CorsMiddleware({ origin: '*' });
    const req  = TestUtils.createMockRequest({ method: 'OPTIONS' });
    const res  = TestUtils.createMockResponse();
    let nextCalled = false;
    cors.use(req, res, () => { nextCalled = true; });
    bunExpect(nextCalled).toBe(false);
    bunExpect(res.statusCode).toBe(204);
  });

  test('sets credentials header when credentials: true', () => {
    const cors = new CorsMiddleware({ origin: '*', credentials: true });
    const req  = TestUtils.createMockRequest();
    const res  = TestUtils.createMockResponse();
    cors.use(req, res, () => {});
    bunExpect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});

// ─── RateLimitMiddleware (unit tests) ────────────────────────────────────────

describe('RateLimitMiddleware', () => {
  test('allows requests under the limit', () => {
    const rl = new RateLimitMiddleware({ windowMs: 60_000, max: 5 });
    const req = TestUtils.createMockRequest({ headers: { 'x-forwarded-for': '1.2.3.4' } });
    const res = TestUtils.createMockResponse();
    let ok = false;
    rl.use(req, res, () => { ok = true; });
    bunExpect(ok).toBe(true);
    bunExpect(res.statusCode).toBe(200);
  });

  test('blocks requests over the limit with 429', () => {
    const rl = new RateLimitMiddleware({ windowMs: 60_000, max: 2 });
    const req = TestUtils.createMockRequest({ headers: { 'x-forwarded-for': '1.2.3.4' } });

    for (let i = 0; i < 2; i++) rl.use(req, TestUtils.createMockResponse(), () => {});

    const res = TestUtils.createMockResponse();
    let nextCalled = false;
    rl.use(req, res, () => { nextCalled = true; });

    bunExpect(nextCalled).toBe(false);
    bunExpect(res.statusCode).toBe(429);
  });

  test('sets X-RateLimit-* headers', () => {
    const rl  = new RateLimitMiddleware({ windowMs: 60_000, max: 10 });
    const req = TestUtils.createMockRequest({ headers: { 'x-forwarded-for': '5.6.7.8' } });
    const res = TestUtils.createMockResponse();
    rl.use(req, res, () => {});
    bunExpect(res.headers['x-ratelimit-limit']).toBe('10');
    bunExpect(res.headers['x-ratelimit-remaining']).toBe('9');
  });

  test('uses custom key generator', () => {
    const rl = new RateLimitMiddleware({
      windowMs: 60_000,
      max: 1,
      keyGenerator: (req) => (req.headers['x-user-id'] as string) || 'anon',
    });

    const reqA = TestUtils.createMockRequest({ headers: { 'x-user-id': 'user-1' } });
    const reqB = TestUtils.createMockRequest({ headers: { 'x-user-id': 'user-2' } });

    let nextA = false, nextB = false;
    rl.use(reqA, TestUtils.createMockResponse(), () => { nextA = true; });
    rl.use(reqB, TestUtils.createMockResponse(), () => { nextB = true; });

    bunExpect(nextA).toBe(true);
    bunExpect(nextB).toBe(true);
  });
});
