import '../src/core/metadata';
import { describe, test, expect, beforeEach } from 'bun:test';
import { VelocityApplication } from '../src/core/application';
import { Controller } from '../src/decorators/controller';
import { Get, Post, Delete } from '../src/decorators/route';
import { TestUtils } from '../src/testing/test-utils';

// ─── Fixture controllers (defined once; each test gets a fresh app instance) ─
// Note: parameter types use `any` — VelocityRequest is an interface (erased at runtime)
// and emitDecoratorMetadata would try to capture it as a value, causing a Bun runtime error.

@Controller('/users')
class UserController {
  @Get('/')         list()             { return []; }
  @Get('/settings') settings()         { return 'settings'; }
  @Get('/:id')      findById(req: any) { return { id: req.params.id }; }
  @Post('/')        create()           { return 'created'; }
  @Get('/:id/posts')         userPosts(req: any)   { return { userId: req.params.id }; }
  // Note: must use :id here too — the trie shares one param name per segment level
  @Get('/:id/posts/:postId') postDetail(req: any) {
    return { userId: req.params.id, postId: req.params.postId };
  }
}

@Controller('/')
class RootController {
  @Get('/') root() { return 'root'; }
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Trie Router — literal routes', () => {
  let app: VelocityApplication;

  beforeEach(() => {
    app = TestUtils.createTestApp();
    app.register(UserController);
  });

  test('GET /users returns 200', async () => {
    const { status } = await TestUtils.makeRequest(app, { method: 'GET', path: '/users' });
    expect(status).toBe(200);
  });

  test('root controller GET /', async () => {
    const rootApp = TestUtils.createTestApp();
    rootApp.register(RootController);
    const { status, body } = await TestUtils.makeRequest(rootApp, { method: 'GET', path: '/' });
    expect(status).toBe(200);
    expect(body).toBe('root');
  });

  test('unknown path returns 404', async () => {
    const { status } = await TestUtils.makeRequest(app, { method: 'GET', path: '/nonexistent' });
    expect(status).toBe(404);
  });

  test('wrong HTTP method returns 404', async () => {
    const { status } = await TestUtils.makeRequest(app, { method: 'DELETE', path: '/users' });
    expect(status).toBe(404);
  });
});

describe('Trie Router — parameterised routes', () => {
  let app: VelocityApplication;

  beforeEach(() => {
    app = TestUtils.createTestApp();
    app.register(UserController);
  });

  test('extracts single :id param', async () => {
    const { status, body } = await TestUtils.makeRequest(app, { method: 'GET', path: '/users/42' });
    expect(status).toBe(200);
    expect(body.id).toBe('42');
  });

  test('literal segment wins over :param at same depth (/users/settings)', async () => {
    const { status, body } = await TestUtils.makeRequest(app, { method: 'GET', path: '/users/settings' });
    expect(status).toBe(200);
    expect(body).toBe('settings');
  });

  test('two-level param route /:id/posts', async () => {
    const { status, body } = await TestUtils.makeRequest(app, { method: 'GET', path: '/users/5/posts' });
    expect(status).toBe(200);
    expect(body.userId).toBe('5');
  });

  test('two distinct params /:userId/posts/:postId', async () => {
    const { status, body } = await TestUtils.makeRequest(app, { method: 'GET', path: '/users/7/posts/99' });
    expect(status).toBe(200);
    expect(body.userId).toBe('7');
    expect(body.postId).toBe('99');
  });
});

describe('Trie Router — HTTP method separation', () => {
  let app: VelocityApplication;

  beforeEach(() => {
    app = TestUtils.createTestApp();
    app.register(UserController);
  });

  test('GET /users and POST /users are independent', async () => {
    const get  = await TestUtils.makeRequest(app, { method: 'GET',  path: '/users' });
    const post = await TestUtils.makeRequest(app, { method: 'POST', path: '/users' });
    expect(get.status).toBe(200);
    expect(post.status).toBe(200);
  });

  test('DELETE /users → 404 (not registered)', async () => {
    const { status } = await TestUtils.makeRequest(app, { method: 'DELETE', path: '/users' });
    expect(status).toBe(404);
  });
});

describe('Trie Router — global prefix', () => {
  test('all routes are prefixed with /api', async () => {
    const app = TestUtils.createTestApp({ globalPrefix: '/api' });
    app.register(UserController);

    const prefixed = await TestUtils.makeRequest(app, { method: 'GET', path: '/api/users' });
    const raw      = await TestUtils.makeRequest(app, { method: 'GET', path: '/users' });

    expect(prefixed.status).toBe(200);
    expect(raw.status).toBe(404);
  });

  test('globalPrefixExclusions bypass the prefix', async () => {
    @Controller('/health')
    class HealthController {
      @Get('/') ping() { return 'ok'; }
    }

    const app = TestUtils.createTestApp({
      globalPrefix: '/api',
      globalPrefixExclusions: ['/health'],
    });
    app.register(HealthController);

    const excluded = await TestUtils.makeRequest(app, { method: 'GET', path: '/health' });
    const prefixed = await TestUtils.makeRequest(app, { method: 'GET', path: '/api/health' });

    expect(excluded.status).toBe(200);
    expect(prefixed.status).toBe(404);
  });
});
