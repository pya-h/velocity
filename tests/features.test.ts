/**
 * Tests for features added in the latest batch:
 *   - @Guards decorator
 *   - Lifecycle hooks (onRequest, onResponse, onError)
 *   - Cookie parsing + res.setCookie
 *   - @Status decorator + StatusCode
 *   - Param-name injection (body, param, query, req, res)
 *   - ResponseFrame (global + controller-level)
 *   - @Validate (metadata-based, not function-wrapping)
 *   - @Fn bypasses ResponseFrame
 */
import '../src/core/metadata';
import { Suite, Test, BeforeEach, expect } from '../src/testing/decorators';
import { describe, test, expect as bunExpect } from 'bun:test';
import { VelocityApplication } from '../src/core/application';
import { Controller } from '../src/decorators/controller';
import { Get, Post } from '../src/decorators/route';
import { Guards } from '../src/decorators/guard';
import { Status } from '../src/decorators/status';
import { Validate, Validator } from '../src/validation/validator';
import { ResponseFrame } from '../src/decorators/response-frame';
import { Frame } from '../src/core/frame';
import { Fn } from '../src/decorators/fn';
import { TestUtils } from '../src/testing/test-utils';
import * as Joi from 'joi';
import type { VelocityRequest, VelocityResponse, GuardFunction } from '../src/types';

// ─── Guards ─────────────────────────────────────────────────────────────────

@Suite('Guards')
class GuardTests {
  private app!: VelocityApplication;

  @BeforeEach
  setup() { this.app = TestUtils.createTestApp(); }

  @Test('guard returning true allows request')
  async allows() {
    const allow: GuardFunction = () => true;

    @Controller('/g1')
    class C { @Get('/') @Guards(allow) get() { return 'ok'; } }

    this.app.register(C);
    const { status, body } = await TestUtils.makeRequest(this.app, { method: 'GET', path: '/g1' });
    expect(status).toBe(200);
    expect(body).toBe('ok');
  }

  @Test('guard returning false returns 403')
  async blocks() {
    const deny: GuardFunction = () => false;

    @Controller('/g2')
    class C { @Get('/') @Guards(deny) get() { return 'secret'; } }

    this.app.register(C);
    const { status, body } = await TestUtils.makeRequest(this.app, { method: 'GET', path: '/g2' });
    expect(status).toBe(403);
    expect(body.error).toBe('Forbidden');
  }

  @Test('guard checks header')
  async headerCheck() {
    const authGuard: GuardFunction = (req) => !!req.headers['authorization'];

    @Controller('/g3')
    class C { @Get('/') @Guards(authGuard) get() { return 'protected'; } }

    this.app.register(C);

    const r1 = await TestUtils.makeRequest(this.app, { method: 'GET', path: '/g3' });
    expect(r1.status).toBe(403);

    const r2 = await TestUtils.makeRequest(this.app, {
      method: 'GET', path: '/g3', headers: { authorization: 'Bearer x' },
    });
    expect(r2.status).toBe(200);
    expect(r2.body).toBe('protected');
  }
}

// ─── Lifecycle hooks ────────────────────────────────────────────────────────

@Suite('Lifecycle hooks')
class HookTests {
  @Test('onRequest runs before handler')
  async onRequest() {
    const app = TestUtils.createTestApp();
    let hookRan = false;

    app.onRequest(() => { hookRan = true; });

    @Controller('/hook1')
    class C { @Get('/') get() { return 'ok'; } }

    app.register(C);
    await TestUtils.makeRequest(app, { method: 'GET', path: '/hook1' });
    expect(hookRan).toBe(true);
  }

  @Test('onResponse runs after handler')
  async onResponse() {
    const app = TestUtils.createTestApp();
    let capturedStatus = 0;

    app.onResponse((_req, res) => { capturedStatus = res.statusCode; });

    @Controller('/hook2')
    class C { @Get('/') get() { return 'ok'; } }

    app.register(C);
    await TestUtils.makeRequest(app, { method: 'GET', path: '/hook2' });
    expect(capturedStatus).toBe(200);
  }

  @Test('onError replaces default 500 handler')
  async onError() {
    const app = TestUtils.createTestApp();

    app.onError((error, _req, res) => {
      res.status(500).json({ custom: true, msg: error.message });
    });

    @Controller('/hook3')
    class C { @Get('/') get() { throw new Error('boom'); } }

    app.register(C);
    const { status, body } = await TestUtils.makeRequest(app, { method: 'GET', path: '/hook3' });
    expect(status).toBe(500);
    expect(body.custom).toBe(true);
    expect(body.msg).toBe('boom');
  }
}

// ─── Cookies ────────────────────────────────────────────────────────────────

@Suite('Cookies')
class CookieTests {
  @Test('req.cookies parses Cookie header')
  async parseCookies() {
    const app = TestUtils.createTestApp();
    let parsed: Record<string, string> | undefined;

    @Controller('/ck1')
    class C {
      @Get('/')
      get(req: VelocityRequest) { parsed = req.cookies; return 'ok'; }
    }

    app.register(C);
    await TestUtils.makeRequest(app, {
      method: 'GET', path: '/ck1',
      headers: { cookie: 'session=abc123; theme=dark' },
    });
    expect(parsed?.session).toBe('abc123');
    expect(parsed?.theme).toBe('dark');
  }

  @Test('res.setCookie sets Set-Cookie header')
  async setCookie() {
    const app = TestUtils.createTestApp();

    @Controller('/ck2')
    class C {
      @Get('/')
      get(_req: VelocityRequest, res: VelocityResponse) {
        res.setCookie('token', 'xyz', { httpOnly: true, path: '/' });
        return 'ok';
      }
    }

    app.register(C);
    const { headers } = await TestUtils.makeRequest(app, { method: 'GET', path: '/ck2' });
    const setCookie = headers['set-cookie'];
    expect(setCookie).toContain('token=xyz');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Path=/');
  }

  @Test('signed cookie — value is signed with HMAC')
  async signedCookie() {
    const app = TestUtils.createTestApp({ cookieSecret: 'test-secret-key' });

    @Controller('/ck3')
    class C {
      @Get('/')
      get(_req: VelocityRequest, res: VelocityResponse) {
        res.setCookie('session', 'user123', { signed: true, httpOnly: true });
        return 'ok';
      }
    }

    app.register(C);
    const { headers } = await TestUtils.makeRequest(app, { method: 'GET', path: '/ck3' });
    const setCookie = headers['set-cookie'] as string;
    // Signed value contains a dot separator with the HMAC signature
    expect(setCookie).toContain('session=');
    expect(setCookie).toContain('HttpOnly');
    // Value should be URL-encoded "user123.<signature>"
    const match = setCookie.match(/session=([^;]+)/);
    const decoded = decodeURIComponent(match![1]);
    expect(decoded).toContain('user123.');
    expect(decoded.split('.').length).toBe(2);
  }

  @Test('req.signedCookies verifies valid signature')
  async verifySignedCookie() {
    const app = TestUtils.createTestApp({ cookieSecret: 'my-secret' });
    let verified: Record<string, string | false> | undefined;

    @Controller('/ck4')
    class C {
      @Get('/')
      get(req: VelocityRequest) { verified = req.signedCookies; return 'ok'; }
    }

    app.register(C);

    // First, get a signed cookie value
    const { createHmac } = await import('crypto');
    const sig = createHmac('sha256', 'my-secret').update('session-data').digest('base64url');
    const signedValue = `session-data.${sig}`;

    await TestUtils.makeRequest(app, {
      method: 'GET', path: '/ck4',
      headers: { cookie: `token=${encodeURIComponent(signedValue)}` },
    });

    expect(verified?.token).toBe('session-data');
  }

  @Test('req.signedCookies returns false for tampered cookie')
  async tamperedCookie() {
    const app = TestUtils.createTestApp({ cookieSecret: 'my-secret' });
    let verified: Record<string, string | false> | undefined;

    @Controller('/ck5')
    class C {
      @Get('/')
      get(req: VelocityRequest) { verified = req.signedCookies; return 'ok'; }
    }

    app.register(C);

    await TestUtils.makeRequest(app, {
      method: 'GET', path: '/ck5',
      headers: { cookie: 'token=tampered-value.invalid-signature' },
    });

    expect(verified?.token).toBe(false);
  }

  @Test('res.clearCookie sets Max-Age=0')
  async clearCookie() {
    const app = TestUtils.createTestApp();

    @Controller('/ck6')
    class C {
      @Get('/')
      get(_req: VelocityRequest, res: VelocityResponse) {
        res.clearCookie('session', { path: '/' });
        return 'ok';
      }
    }

    app.register(C);
    const { headers } = await TestUtils.makeRequest(app, { method: 'GET', path: '/ck6' });
    const setCookie = headers['set-cookie'] as string;
    expect(setCookie).toContain('session=');
    expect(setCookie).toContain('Max-Age=0');
  }
}

// ─── @Status decorator ──────────────────────────────────────────────────────

@Suite('@Status decorator')
class StatusTests {
  @Test('@Status(201) sets response status code')
  async customStatus() {
    const app = TestUtils.createTestApp();

    @Controller('/st1')
    class C {
      @Post('/')
      @Status(201)
      create(body: unknown) { return { created: true, body }; }
    }

    app.register(C);
    const { status, body } = await TestUtils.makeRequest(app, {
      method: 'POST', path: '/st1', body: { name: 'test' },
    });
    expect(status).toBe(201);
    expect(body.created).toBe(true);
  }

  @Test('@Status(202) on GET route')
  async acceptedStatus() {
    const app = TestUtils.createTestApp();

    @Controller('/st2')
    class C {
      @Get('/')
      @Status(202)
      get() { return { accepted: true }; }
    }

    app.register(C);
    const { status } = await TestUtils.makeRequest(app, { method: 'GET', path: '/st2' });
    expect(status).toBe(202);
  }
}

// ─── Param-name injection ───────────────────────────────────────────────────

@Suite('Param-name injection')
class InjectionTests {
  private app!: VelocityApplication;

  @BeforeEach
  setup() { this.app = TestUtils.createTestApp(); }

  @Test('body injection — POST handler receives req.body')
  async bodyInjection() {
    @Controller('/inj1')
    class C {
      @Post('/')
      create(body: unknown) { return { received: body }; }
    }

    this.app.register(C);
    const { body } = await TestUtils.makeRequest(this.app, {
      method: 'POST', path: '/inj1', body: { x: 1 },
    });
    expect(body.received.x).toBe(1);
  }

  @Test('param injection — GET /:id receives params')
  async paramInjection() {
    @Controller('/inj2')
    class C {
      @Get('/:id')
      get(param: Record<string, string>) { return { id: param.id }; }
    }

    this.app.register(C);
    const { body } = await TestUtils.makeRequest(this.app, { method: 'GET', path: '/inj2/42' });
    expect(body.id).toBe('42');
  }

  @Test('no params — handler called with no args')
  async noParams() {
    @Controller('/inj3')
    class C {
      @Get('/')
      get() { return 'clean'; }
    }

    this.app.register(C);
    const { body } = await TestUtils.makeRequest(this.app, { method: 'GET', path: '/inj3' });
    expect(body).toBe('clean');
  }

  @Test('req + res injection — backward compat')
  async legacyInjection() {
    @Controller('/inj4')
    class C {
      @Get('/')
      get(req: VelocityRequest, res: VelocityResponse) {
        return res.status(200).json({ url: req.url });
      }
    }

    this.app.register(C);
    const { status } = await TestUtils.makeRequest(this.app, { method: 'GET', path: '/inj4' });
    expect(status).toBe(200);
  }

  @Test('body skipped for GET even if handler has body param')
  async noBodyOnGet() {
    // body param on GET should be undefined (no body parsing)
    @Controller('/inj5')
    class C {
      @Get('/')
      get(body: unknown) { return { body: body ?? null }; }
    }

    this.app.register(C);
    const { body } = await TestUtils.makeRequest(this.app, { method: 'GET', path: '/inj5' });
    expect(body.body).toBeNull();
  }
}

// ─── ResponseFrame ──────────────────────────────────────────────────────────

@Suite('ResponseFrame')
class FrameTests {
  @Test('global frame wraps all responses')
  async globalFrame() {
    const app = TestUtils.createTestApp();
    app.responseFrame({
      status: Frame.Status,
      data: Frame.Data,
      error: Frame.Error,
    });

    @Controller('/fr1')
    class C { @Get('/') get() { return { items: [1, 2] }; } }

    app.register(C);
    const { status, body } = await TestUtils.makeRequest(app, { method: 'GET', path: '/fr1' });
    expect(status).toBe(200);
    expect(body.status).toBe(200);
    expect(body.data.items).toEqual([1, 2]);
    expect(body.error).toBeNull();
  }

  @Test('frame wraps errors')
  async frameError() {
    const app = TestUtils.createTestApp();
    app.responseFrame({
      status: Frame.Status,
      data: Frame.Data,
      error: Frame.Error,
    });

    @Controller('/fr2')
    class C { @Get('/') get() { throw new Error('fail'); } }

    app.register(C);
    const { status, body } = await TestUtils.makeRequest(app, { method: 'GET', path: '/fr2' });
    expect(status).toBe(500);
    expect(body.status).toBe(500);
    expect(body.data).toBeNull();
    expect(body.error).toBe('fail');
  }

  @Test('controller-level @ResponseFrame overrides global')
  async controllerFrame() {
    const app = TestUtils.createTestApp();
    app.responseFrame({
      status: Frame.Status,
      data: Frame.Data,
      error: Frame.Error,
    });

    @ResponseFrame({ code: Frame.Status, result: Frame.Data, err: Frame.Error })
    @Controller('/fr3')
    class C { @Get('/') get() { return 'hello'; } }

    app.register(C);
    const { body } = await TestUtils.makeRequest(app, { method: 'GET', path: '/fr3' });
    // Uses controller frame (code/result/err), not global (status/data/error)
    expect(body.code).toBe(200);
    expect(body.result).toBe('hello');
    expect(body.err).toBeNull();
  }

  @Test('Frame.Extract pulls field from data')
  async frameExtract() {
    const app = TestUtils.createTestApp();
    app.responseFrame({
      status: Frame.Status,
      data: Frame.Data,
      error: Frame.Error,
      msg: Frame.Extract('message', true),
    });

    @Controller('/fr4')
    class C { @Get('/') get() { return { items: [1], message: 'hello' }; } }

    app.register(C);
    const { body } = await TestUtils.makeRequest(app, { method: 'GET', path: '/fr4' });
    expect(body.msg).toBe('hello');
    expect(body.data.message).toBeUndefined(); // extracted from data
    expect(body.data.items).toEqual([1]);
  }

  @Test('@Fn bypasses ResponseFrame')
  async fnBypassesFrame() {
    const app = TestUtils.createTestApp();
    app.responseFrame({
      status: Frame.Status,
      data: Frame.Data,
      error: Frame.Error,
    });

    @Controller('/fr5')
    class C {
      @Get('/') get() { return 'framed'; }
      @Fn() myFn() { return 42; }
    }

    app.register(C);

    // Regular route — framed
    const r1 = await TestUtils.makeRequest(app, { method: 'GET', path: '/fr5' });
    expect(r1.body.data).toBe('framed');

    // @Fn — raw, no frame
    const r2 = await TestUtils.makeRequest(app, { method: 'GET', path: '/.myFn()' });
    expect(r2.body).toBe(42);
  }
}

// ─── @Validate (metadata-based) ─────────────────────────────────────────────

describe('E2E — @Validate with guards + injection', () => {
  test('@Validate + @Guards + body injection work together', async () => {
    const guard: GuardFunction = (req) => !!req.headers['authorization'];

    @Controller('/combo')
    class C {
      @Post('/')
      @Guards(guard)
      @Validate(Validator.createSchema({ name: Joi.string().required() }))
      @Status(201)
      create(body: unknown) { return { name: (body as { name: string }).name }; }
    }

    const app = TestUtils.createTestApp();
    app.register(C);

    // No auth → 403
    const r1 = await TestUtils.makeRequest(app, {
      method: 'POST', path: '/combo', body: { name: 'Alice' },
    });
    bunExpect(r1.status).toBe(403);

    // Auth + invalid body → 400
    const r2 = await TestUtils.makeRequest(app, {
      method: 'POST', path: '/combo', body: { wrong: 'field' },
      headers: { authorization: 'Bearer x' },
    });
    bunExpect(r2.status).toBe(400);

    // Auth + valid body → 201
    const r3 = await TestUtils.makeRequest(app, {
      method: 'POST', path: '/combo', body: { name: 'Alice' },
      headers: { authorization: 'Bearer x' },
    });
    bunExpect(r3.status).toBe(201);
    bunExpect(r3.body.name).toBe('Alice');
  });
});

// ─── VelocitySession (encrypted cookie session) ─────────────────────────────

import { VelocitySession } from '../src/core/session';

@Suite('VelocitySession')
class SessionTests {
  @Test('session.set() encrypts data and sets cookie')
  async setSession() {
    const app = TestUtils.createTestApp({ session: { secret: 'test-secret' } });

    @Controller('/ses1')
    class C {
      @Post('/')
      login(session: VelocitySession) {
        session.set({ userId: 42, role: 'admin' });
        return { ok: true };
      }
    }

    app.register(C);
    const { status, headers } = await TestUtils.makeRequest(app, {
      method: 'POST', path: '/ses1', body: {},
    });
    expect(status).toBe(200);
    const cookie = headers['set-cookie'] as string;
    expect(cookie).toContain('velocity.sid=');
    expect(cookie).toContain('HttpOnly');
    // The value should be encrypted — NOT contain plaintext 'userId' or '42'
    expect(cookie).not.toContain('userId');
  }

  @Test('session.data decrypts stored session')
  async readSession() {
    const app = TestUtils.createTestApp({ session: { secret: 'read-test' } });

    @Controller('/ses2')
    class C {
      @Post('/login')
      login(session: VelocitySession) {
        session.set({ name: 'Alice', role: 'user' });
        return { ok: true };
      }
      @Get('/me')
      me(session: VelocitySession) {
        if (!session.valid) return { error: 'no session' };
        return session.data;
      }
    }

    app.register(C);

    // Login — get encrypted cookie
    const loginRes = await TestUtils.makeRequest(app, {
      method: 'POST', path: '/ses2/login', body: {},
    });
    const match = (loginRes.headers['set-cookie'] as string).match(/velocity\.sid=([^;]+)/);
    const cookie = `velocity.sid=${match![1]}`;

    // Read session — decrypt and return data
    const meRes = await TestUtils.makeRequest(app, {
      method: 'GET', path: '/ses2/me',
      headers: { cookie },
    });
    expect(meRes.status).toBe(200);
    expect(meRes.body.name).toBe('Alice');
    expect(meRes.body.role).toBe('user');
  }

  @Test('session.destroy() clears cookie')
  async destroySession() {
    const app = TestUtils.createTestApp({ session: { secret: 'destroy-test' } });

    @Controller('/ses3')
    class C {
      @Post('/logout')
      logout(session: VelocitySession) {
        session.destroy();
        return { ok: true };
      }
    }

    app.register(C);
    const { headers } = await TestUtils.makeRequest(app, {
      method: 'POST', path: '/ses3/logout', body: {},
    });
    const cookie = headers['set-cookie'] as string;
    expect(cookie).toContain('velocity.sid=');
    expect(cookie).toContain('Max-Age=0');
  }

  @Test('tampered session cookie is rejected')
  async tamperedSession() {
    const app = TestUtils.createTestApp({ session: { secret: 'tamper-test' } });

    @Controller('/ses4')
    class C {
      @Get('/')
      check(session: VelocitySession) {
        return { valid: session.valid, data: session.data };
      }
    }

    app.register(C);
    const { body } = await TestUtils.makeRequest(app, {
      method: 'GET', path: '/ses4',
      headers: { cookie: 'velocity.sid=tampered-garbage.fake-sig' },
    });
    expect(body.valid).toBe(false);
    expect(body.data).toBeNull();
  }

  @Test('no session config — req.session is undefined')
  async noConfig() {
    const app = TestUtils.createTestApp(); // no session config

    @Controller('/ses5')
    class C {
      @Get('/')
      check(session: unknown) { return { session: session ?? null }; }
    }

    app.register(C);
    const { body } = await TestUtils.makeRequest(app, {
      method: 'GET', path: '/ses5',
    });
    expect(body.session).toBeNull();
  }

  @Test('custom cookie name works')
  async customName() {
    const app = TestUtils.createTestApp({
      session: { secret: 'custom-name', cookieName: 'my.app.session' },
    });

    @Controller('/ses6')
    class C {
      @Post('/')
      login(session: VelocitySession) {
        session.set({ ok: true });
        return { ok: true };
      }
    }

    app.register(C);
    const { headers } = await TestUtils.makeRequest(app, {
      method: 'POST', path: '/ses6', body: {},
    });
    expect(headers['set-cookie']).toContain('my.app.session=');
  }
}
