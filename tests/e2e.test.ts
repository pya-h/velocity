/**
 * E2E / integration tests — full request lifecycle through VeloApplication.
 * No real network: TestUtils.makeRequest() drives handleRequest() directly.
 */
import '../src/core/metadata';
import { Suite, Test, BeforeEach, expect } from '../src/testing/decorators';
import { describe, test, expect as bunExpect, beforeEach } from 'bun:test';
import { VeloApplication } from '../src/core/application';
import { Controller } from '../src/decorators/controller';
import { Get, Post, Put, Delete } from '../src/decorators/route';
import { Middlewares } from '../src/decorators/middleware';
import { Interceptors } from '../src/decorators/interceptor';
import { Fn } from '../src/decorators/fn';
import { TestUtils } from '../src/testing/test-utils';

// Note: decorated controller methods use `any` for request params because
// VeloRequest is an interface (erased at runtime) and emitDecoratorMetadata
// would try to reference it as a runtime value.

const authGuard = (req: any, res: any, next: () => void) => {
  if (req.headers['authorization']) next();
  else res.status(401).json({ error: 'Unauthorized' });
};

@Controller('/items')
class ItemController {
  private items = [{ id: 1, name: 'sword' }, { id: 2, name: 'shield' }];

  @Get('/')
  list() { return this.items; }

  @Get('/:id')
  findById(req: any) {
    const id = Number(req.params.id);
    const item = this.items.find(i => i.id === id);
    if (!item) throw new Error('Item not found');
    return item;
  }

  @Post('/')
  @Middlewares(authGuard)
  create(req: any) {
    return { id: 3, ...req.body };
  }

  @Put('/:id')
  update(req: any) {
    return { id: Number(req.params.id), ...req.body };
  }

  @Delete('/:id')
  remove() {
    return undefined; // 204
  }

  @Fn()
  async findByName(name: string) {
    return this.items.find(i => i.name === name) ?? null;
  }
}

// ─── Response lifecycle ──────────────────────────────────────────────────────

@Suite('E2E — Response lifecycle')
class ResponseLifecycleTests {
  private app!: VeloApplication;

  @BeforeEach
  async setup() {
    this.app = TestUtils.createTestApp();
    this.app.register(ItemController);
  }

  @Test('GET returns 200 with JSON array')
  async getList() {
    const { status, body } = await TestUtils.makeRequest(this.app, { method: 'GET', path: '/items' });
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
  }

  @Test('GET with param returns matching item')
  async getById() {
    const { status, body } = await TestUtils.makeRequest(this.app, { method: 'GET', path: '/items/1' });
    expect(status).toBe(200);
    expect(body.name).toBe('sword');
  }

  @Test('POST with auth returns 201-shaped body')
  async createWithAuth() {
    const { status, body } = await TestUtils.makeRequest(this.app, {
      method:  'POST',
      path:    '/items',
      body:    { name: 'potion' },
      headers: { authorization: 'Bearer token' },
    });
    expect(status).toBe(200); // handler returns value → 200 (not 201 unless explicitly set)
    expect(body.name).toBe('potion');
  }

  @Test('POST without auth returns 401')
  async createNoAuth() {
    const { status, body } = await TestUtils.makeRequest(this.app, {
      method: 'POST',
      path:   '/items',
      body:   { name: 'potion' },
    });
    expect(status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  }

  @Test('handler returning undefined → 204')
  async deleteReturns204() {
    const { status } = await TestUtils.makeRequest(this.app, { method: 'DELETE', path: '/items/1' });
    expect(status).toBe(204);
  }

  @Test('PUT with body updates item')
  async putBody() {
    const { status, body } = await TestUtils.makeRequest(this.app, {
      method: 'PUT',
      path:   '/items/1',
      body:   { name: 'upgraded sword' },
    });
    expect(status).toBe(200);
    expect(body.name).toBe('upgraded sword');
    expect(body.id).toBe(1);
  }

  @Test('unknown route returns 404')
  async notFound() {
    const { status, body } = await TestUtils.makeRequest(this.app, { method: 'GET', path: '/missing' });
    expect(status).toBe(404);
    expect(body.error).toBeDefined();
  }

  @Test('handler throwing returns 500 with message')
  async handlerError() {
    const { status, body } = await TestUtils.makeRequest(this.app, { method: 'GET', path: '/items/999' });
    expect(status).toBe(500);
    expect(body.error).toBe('Internal Server Error');
    expect(body.message).toBe('Item not found');
  }
}

// ─── Interceptors ────────────────────────────────────────────────────────────

@Suite('E2E — Interceptors')
class InterceptorTests {
  private app!: VeloApplication;

  @BeforeEach
  async setup() {
    this.app = TestUtils.createTestApp();
  }

  @Test('interceptor wraps response data')
  async wrapData() {
    const wrap = (data: any) => ({ data, meta: { ok: true } });

    @Controller('/wrapped')
    class WrappedCtrl {
      @Get('/')
      @Interceptors(wrap)
      handle() { return [1, 2, 3]; }
    }

    this.app.register(WrappedCtrl);
    const { status, body } = await TestUtils.makeRequest(this.app, { method: 'GET', path: '/wrapped' });
    expect(status).toBe(200);
    expect(body.data).toEqual([1, 2, 3]);
    expect(body.meta.ok).toBe(true);
  }

  @Test('multiple interceptors chain in declaration order')
  async chainInterceptors() {
    const double = (data: unknown) => (data as number) * 2;
    const addOne = (data: unknown) => (data as number) + 1;

    @Controller('/chained')
    class ChainedCtrl {
      @Get('/')
      @Interceptors(double, addOne)
      handle() { return 5; }
    }

    this.app.register(ChainedCtrl);
    const { body } = await TestUtils.makeRequest(this.app, { method: 'GET', path: '/chained' });
    // 5 → double → 10 → addOne → 11
    expect(body).toBe(11);
  }
}

// ─── @Fn HTTP functions ───────────────────────────────────────────────────────

@Suite('E2E — @Fn HTTP functions')
class FnTests {
  private app!: VeloApplication;

  @BeforeEach
  async setup() {
    this.app = TestUtils.createTestApp();
    this.app.register(ItemController);
  }

  @Test('callable at /.functionName(args)')
  async callFn() {
    const { status, body } = await TestUtils.makeRequest(this.app, {
      method: 'GET',
      path:   '/.findByName("sword")',
    });
    expect(status).toBe(200);
    expect(body?.name).toBe('sword');
  }

  @Test('unknown function returns 404')
  async unknownFn() {
    const { status } = await TestUtils.makeRequest(this.app, { method: 'GET', path: '/.unknown()' });
    expect(status).toBe(404);
  }

  @Test('function returning null returns JSON null')
  async fnReturnsNull() {
    const { body } = await TestUtils.makeRequest(this.app, {
      method: 'GET',
      path:   '/.findByName("ghost")',
    });
    expect(body).toBeNull();
  }
}

// ─── Config-based CORS ────────────────────────────────────────────────────────

describe('E2E — config-based CORS', () => {
  test('CORS headers set when cors config present', async () => {
    @Controller('/cors-test')
    class CorsCtrl { @Get('/') ping() { return 'pong'; } }

    const app = TestUtils.createTestApp({ cors: { origin: 'https://example.com', credentials: false } });
    app.register(CorsCtrl);

    const { headers } = await TestUtils.makeRequest(app, { method: 'GET', path: '/cors-test' });
    bunExpect(headers['access-control-allow-origin']).toBe('https://example.com');
  });

  test('OPTIONS preflight returns 204 with no body', async () => {
    @Controller('/preflight')
    class PreflightCtrl { @Get('/') ping() { return 'pong'; } }

    const app = TestUtils.createTestApp({ cors: { origin: '*', credentials: false } });
    app.register(PreflightCtrl);

    const { status, body } = await TestUtils.makeRequest(app, { method: 'OPTIONS', path: '/preflight' });
    bunExpect(status).toBe(204);
    bunExpect(body).toBeNull();
  });
});

// ─── Graceful shutdown helper ─────────────────────────────────────────────────

describe('E2E — prepareForTesting() idempotent', () => {
  test('calling makeRequest twice on same app does not double-register', async () => {
    @Controller('/idempotent')
    class IdCtrl { @Get('/') ping() { return 'pong'; } }

    const app = TestUtils.createTestApp();
    app.register(IdCtrl);

    const r1 = await TestUtils.makeRequest(app, { method: 'GET', path: '/idempotent' });
    const r2 = await TestUtils.makeRequest(app, { method: 'GET', path: '/idempotent' });

    bunExpect(r1.status).toBe(200);
    bunExpect(r2.status).toBe(200);
    bunExpect(r1.body).toBe(r2.body);
  });
});
