/**
 * E2E tests for the demo project.
 *
 * These test the ACTUAL demo controllers and endpoints — not inline test fixtures.
 * The velo app instance and all controllers are imported via their real modules.
 *
 * DB-dependent endpoints (users CRUD, posts, jobs) are tested for guard/validation
 * behavior only — actual DB operations require a running database and are skipped.
 *
 * Run with: bun test
 */
import { expect } from 'bun:test';
import { Suite, Test, BeforeAll, TestUtils } from '@velocity/framework';
import type { VeloApplication } from '@velocity/framework';

// Import the actual velo instance — this creates the real app with real config
import { velo } from '../velo';

// Import controllers — they self-register on velo when imported
import '../src/controllers/health.controller';
import '../src/controllers/auth.controller';
import '../src/controllers/user.controller';

// ─── Health endpoint ─────────────────────────────────────────────────────────

@Suite('E2E — Health endpoint')
class HealthTests {
  private app: VeloApplication = velo;

  @BeforeAll
  async setup() { await this.app.prepareForTesting(); }

  @Test('GET /api/health returns ok')
  async healthCheck() {
    const { status, body } = await TestUtils.makeRequest(this.app, {
      method: 'GET', path: '/api/health',
    });
    expect(status).toBe(200);
    expect(body.data.status).toBe('ok'); // wrapped in global ResponseFrame → .data
    expect(typeof body.data.uptime).toBe('number');
  }
}

// ─── Auth endpoints (no DB needed — uses hardcoded demo users) ───────────────

@Suite('E2E — Auth flow (actual auth controller)')
class AuthE2ETests {
  private app: VeloApplication = velo;

  @BeforeAll
  async setup() { await this.app.prepareForTesting(); }

  @Test('POST /api/auth/login with valid credentials succeeds')
  async loginSuccess() {
    const { status, body } = await TestUtils.makeRequest(this.app, {
      method: 'POST', path: '/api/auth/login',
      body: { username: 'admin', password: 'admin123' },
    });
    // Global ResponseFrame wraps response → { status, data, error }
    expect(status).toBe(200);
    expect(body.data.message).toBe('Logged in');
    expect(body.data.user).toBe('admin');
    expect(body.data.role).toBe('admin');
  }

  @Test('POST /api/auth/login with wrong password returns 401')
  async loginWrongPassword() {
    const { status, body } = await TestUtils.makeRequest(this.app, {
      method: 'POST', path: '/api/auth/login',
      body: { username: 'admin', password: 'wrong' },
    });
    expect(status).toBe(401);
    expect(body.error).toBeDefined();
  }

  @Test('POST /api/auth/login with invalid body returns 400')
  async loginValidation() {
    const { status } = await TestUtils.makeRequest(this.app, {
      method: 'POST', path: '/api/auth/login',
      body: { username: 'admin' }, // missing password
    });
    expect(status).toBe(400);
  }

  @Test('GET /api/auth/me without cookie returns 403')
  async meWithoutCookie() {
    const { status } = await TestUtils.makeRequest(this.app, {
      method: 'GET', path: '/api/auth/me',
    });
    expect(status).toBe(403);
  }

  @Test('full login → me → logout flow with encrypted session')
  async fullAuthFlow() {
    // 1. Login — server sets encrypted session cookie (velocity.sid)
    const loginRes = await TestUtils.makeRequest(this.app, {
      method: 'POST', path: '/api/auth/login',
      body: { username: 'user', password: 'user1234' },
    });
    expect(loginRes.status).toBe(200);

    const setCookie = loginRes.headers['set-cookie'] as string;
    expect(setCookie).toContain('velocity.sid=');
    expect(setCookie).toContain('HttpOnly');

    // Extract session cookie to pass in subsequent requests
    const match = setCookie.match(/velocity\.sid=([^;]+)/);
    const sessionCookie = `velocity.sid=${match![1]}`;

    // 2. GET /me with encrypted cookie — should return current user
    const meRes = await TestUtils.makeRequest(this.app, {
      method: 'GET', path: '/api/auth/me',
      headers: { cookie: sessionCookie },
    });
    expect(meRes.status).toBe(200);
    expect(meRes.body.data.user).toBe('user');
    expect(meRes.body.data.role).toBe('user');

    // 3. Logout — clears cookie
    const logoutRes = await TestUtils.makeRequest(this.app, {
      method: 'POST', path: '/api/auth/logout',
      headers: { cookie: sessionCookie },
    });
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.headers['set-cookie']).toContain('Max-Age=0');
  }

  @Test('tampered session cookie is rejected')
  async tamperedCookie() {
    const { status } = await TestUtils.makeRequest(this.app, {
      method: 'GET', path: '/api/auth/me',
      headers: { cookie: 'velocity.sid=tampered-garbage.fake' },
    });
    expect(status).toBe(403);
  }
}

// ─── User endpoints — guard/validation checks (no DB needed) ─────────────────

@Suite('E2E — User controller guards & validation')
class UserGuardTests {
  private app: VeloApplication = velo;

  @BeforeAll
  async setup() { await this.app.prepareForTesting(); }

  @Test('POST /api/users without auth returns 403')
  async createNoAuth() {
    const { status } = await TestUtils.makeRequest(this.app, {
      method: 'POST', path: '/api/users',
      body: { name: 'Test', email: 'test@test.com' },
    });
    expect(status).toBe(403);
  }

  @Test('POST /api/users with auth but invalid body returns 400')
  async createInvalidBody() {
    // Login first to get an encrypted session cookie
    const loginRes = await TestUtils.makeRequest(this.app, {
      method: 'POST', path: '/api/auth/login',
      body: { username: 'admin', password: 'admin123' },
    });
    const match = (loginRes.headers['set-cookie'] as string).match(/velocity\.sid=([^;]+)/);
    const cookie = `velocity.sid=${match![1]}`;

    const { status } = await TestUtils.makeRequest(this.app, {
      method: 'POST', path: '/api/users',
      body: { name: 'Test' }, // missing required email
      headers: { cookie },
    });
    expect(status).toBe(400);
  }

  @Test('DELETE /api/users/1 without auth returns 403')
  async deleteNoAuth() {
    const { status } = await TestUtils.makeRequest(this.app, {
      method: 'DELETE', path: '/api/users/1',
    });
    expect(status).toBe(403);
  }

  @Test('@Fn greet bypasses ResponseFrame')
  async fnGreet() {
    const { status, body } = await TestUtils.makeRequest(this.app, {
      method: 'GET', path: '/.greet("Alice",true)',
    });
    expect(status).toBe(200);
    // @Fn bypasses ResponseFrame — raw return value
    expect(body.message).toBe('Good day, Alice.');
    expect(body.status).toBeUndefined(); // no frame wrapping
  }
}
