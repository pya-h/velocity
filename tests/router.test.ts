import '../src/core/metadata';
import { Suite, Test, BeforeEach, expect } from '../src/testing/decorators';
import { VelocityApplication } from '../src/core/application';
import { Controller } from '../src/decorators/controller';
import { Get, Post } from '../src/decorators/route';
import { TestUtils } from '../src/testing/test-utils';

// ─── Fixture controllers (defined once; each test gets a fresh app instance) ─

@Controller('/users')
class UserController {
  @Get('/')         list()              { return []; }
  @Get('/settings') settings()          { return 'settings'; }
  @Get('/:id')      findById(req: any)  { return { id: req.params.id }; }
  @Post('/')        create()            { return 'created'; }
  @Get('/:id/posts')         userPosts(req: any)    { return { userId: req.params.id }; }
  @Get('/:id/posts/:postId') postDetail(req: any)   {
    return { userId: req.params.id, postId: req.params.postId };
  }
}

@Controller('/')
class RootController {
  @Get('/') root() { return 'root'; }
}

// ─── Literal routes ──────────────────────────────────────────────────────────

@Suite('Trie Router — literal routes')
class LiteralRouteTests {
  private app!: VelocityApplication;

  @BeforeEach
  setup() { this.app = TestUtils.createTestApp(); this.app.register(UserController); }

  @Test('GET /users returns 200')
  async getUsers() {
    const { status } = await TestUtils.makeRequest(this.app, { method: 'GET', path: '/users' });
    expect(status).toBe(200);
  }

  @Test('root controller GET /')
  async rootRoute() {
    const rootApp = TestUtils.createTestApp();
    rootApp.register(RootController);
    const { status, body } = await TestUtils.makeRequest(rootApp, { method: 'GET', path: '/' });
    expect(status).toBe(200);
    expect(body).toBe('root');
  }

  @Test('unknown path returns 404')
  async unknownPath() {
    const { status } = await TestUtils.makeRequest(this.app, { method: 'GET', path: '/nonexistent' });
    expect(status).toBe(404);
  }

  @Test('wrong HTTP method returns 404')
  async wrongMethod() {
    const { status } = await TestUtils.makeRequest(this.app, { method: 'DELETE', path: '/users' });
    expect(status).toBe(404);
  }
}

// ─── Parameterised routes ────────────────────────────────────────────────────

@Suite('Trie Router — parameterised routes')
class ParamRouteTests {
  private app!: VelocityApplication;

  @BeforeEach
  setup() { this.app = TestUtils.createTestApp(); this.app.register(UserController); }

  @Test('extracts single :id param')
  async singleParam() {
    const { status, body } = await TestUtils.makeRequest(this.app, { method: 'GET', path: '/users/42' });
    expect(status).toBe(200);
    expect(body.id).toBe('42');
  }

  @Test('literal segment wins over :param at same depth (/users/settings)')
  async literalWins() {
    const { status, body } = await TestUtils.makeRequest(this.app, { method: 'GET', path: '/users/settings' });
    expect(status).toBe(200);
    expect(body).toBe('settings');
  }

  @Test('two-level param route /:id/posts')
  async nestedParam() {
    const { status, body } = await TestUtils.makeRequest(this.app, { method: 'GET', path: '/users/5/posts' });
    expect(status).toBe(200);
    expect(body.userId).toBe('5');
  }

  @Test('two distinct params /:id/posts/:postId')
  async twoParams() {
    const { status, body } = await TestUtils.makeRequest(this.app, { method: 'GET', path: '/users/7/posts/99' });
    expect(status).toBe(200);
    expect(body.userId).toBe('7');
    expect(body.postId).toBe('99');
  }
}

// ─── HTTP method separation ──────────────────────────────────────────────────

@Suite('Trie Router — HTTP method separation')
class MethodSeparationTests {
  private app!: VelocityApplication;

  @BeforeEach
  setup() { this.app = TestUtils.createTestApp(); this.app.register(UserController); }

  @Test('GET /users and POST /users are independent')
  async getAndPost() {
    const get  = await TestUtils.makeRequest(this.app, { method: 'GET',  path: '/users' });
    const post = await TestUtils.makeRequest(this.app, { method: 'POST', path: '/users' });
    expect(get.status).toBe(200);
    expect(post.status).toBe(200);
  }

  @Test('DELETE /users → 404 (not registered)')
  async noDelete() {
    const { status } = await TestUtils.makeRequest(this.app, { method: 'DELETE', path: '/users' });
    expect(status).toBe(404);
  }
}

// ─── Global prefix ──────────────────────────────────────────────────────────

@Suite('Trie Router — global prefix')
class GlobalPrefixTests {
  @Test('all routes are prefixed with /api')
  async prefixed() {
    const app = TestUtils.createTestApp({ globalPrefix: '/api' });
    app.register(UserController);

    const prefixed = await TestUtils.makeRequest(app, { method: 'GET', path: '/api/users' });
    const raw      = await TestUtils.makeRequest(app, { method: 'GET', path: '/users' });

    expect(prefixed.status).toBe(200);
    expect(raw.status).toBe(404);
  }

  @Test('globalPrefixExclusions bypass the prefix')
  async exclusions() {
    @Controller('/health')
    class HealthController { @Get('/') ping() { return 'ok'; } }

    const app = TestUtils.createTestApp({
      globalPrefix: '/api',
      globalPrefixExclusions: ['/health'],
    });
    app.register(HealthController);

    const excluded = await TestUtils.makeRequest(app, { method: 'GET', path: '/health' });
    const prefixed = await TestUtils.makeRequest(app, { method: 'GET', path: '/api/health' });

    expect(excluded.status).toBe(200);
    expect(prefixed.status).toBe(404);
  }
}
