# Velocity Framework

A minimal, fast, type-safe TypeScript framework for Node.js/Bun with decorators, built-in ORM, and zero bloat.

## Features

- **Decorator-based routing** — `@Get`, `@Post`, `@Put`, `@Delete`, `@Patch`
- **Self-registration** — controllers, services, entities register themselves; `main.ts` stays clean
- **Variadic register** — `velo.register(A, B, C, options?)` with scoping and middleware
- **Scoped DI** — services can be scoped to specific controllers via child containers
- **Controller nesting** — mount controllers under other controllers as sub-routes
- **Global prefix** — prefix all endpoints (e.g. `/api`) with per-path exclusions
- **Segment-trie router** — O(k) lookup regardless of route count; literal routes always beat param routes
- **Built-in ORM** — Prisma-like `db.User.findAll()` with SQLite, PostgreSQL, MySQL; connection pooling
- **Static file serving** — `velo.serve()` and `velo.static()` for files and directories
- **Graceful shutdown** — in-flight request draining; auto SIGTERM/SIGINT via `shutdown: { auto: true }`
- **`@Go` background workers** — real Bun Worker threads launched at startup; `@Channel` injection for typed cross-thread messaging
- **`@Fn` HTTP functions** — call any controller method at `GET /.name(arg1,arg2,...)`; no req/res boilerplate
- **Guards** — `@Guards(fn)` decorator for boolean-return auth checks; runs before middleware
- **Lifecycle hooks** — `velo.onRequest()`, `velo.onResponse()`, `velo.onError()` global hooks
- **Cookies** — lazy `req.cookies` parsing, `res.setCookie(name, value, options)` with full options
- **File uploads** — `@Upload({ maxSize, maxFiles })` with Bun-native multipart; files on `req.files`
- **WebSocket** — `@WebSocket('/path')` class decorator for Bun-native WebSocket gateways
- **Response compression** — config-based gzip via `Bun.gzipSync()` for JSON/text responses
- **Type generation** — unified `velogen` CLI: DB types, OpenAPI spec, typed client, env config, API tester
- **Envelocity** — typed, read-only `.env` wrapper with `OrThrow` getters and nested key grouping
- **API Tester** — auto-generated interactive testing UI from controller metadata
- **Dependency injection** — constructor-based DI with singleton/transient support and child containers
- **Validation** — Joi schemas with `@Validate` decorator
- **Middleware & interceptors** — function or class-based, per-route or per-registration
- **CORS** — built-in config-based CORS with origin whitelist, credentials, OPTIONS handling
- **Rate limiting** — built-in in-memory rate limiter with custom key generators
- **Security headers** — built-in Helmet-style security headers
- **Logging** — custom zero-dep structured logger (JSON/simple/combined, console/file)
- **Test framework** — `@Suite/@Test/@BeforeEach/@AfterEach/@BeforeAll/@AfterAll/@Mock` decorators built on `bun:test`
- **Zero bloat** — no express, no reflect-metadata, no Winston; 3 prod deps (joi + pg + mysql2)

## Scripts & Tools

| Command | Description |
|---|---|
| `npm run build` | Compile framework (`src/` → `dist/`) |
| `npm run sync` | Symlink `dist/` into `node_modules/@velocity/framework` |
| `npm run dev` | Build + sync in one step |
| `npm run demo` | Run the full-demo example |
| `bun test` | Run test suite (112 tests, ~200 ms) |

### `velogen` — Unified Code Generator

All code generation tools are accessed via the `velogen` CLI with subcommands:

| Command | Short | Description |
|---|---|---|
| `velogen types <dir>` | `velogen t` | Generate typed DB interfaces from `@Entity` files |
| `velogen env <dir>` | `velogen e` | Generate typed `.env` config (Envelocity) |
| `velogen openapi <dir>` | `velogen oa` | Generate OpenAPI 3.1 spec from `@Controller` routes |
| `velogen client <dir>` | `velogen c` | Generate typed fetch client from `@Controller` routes |
| `velogen api <dir>` | `velogen a` | Generate interactive API testing UI |
| `velogen all <dir>` | — | Run all generators at once |

### Development Workflow

```bash
npm install
npm run dev                                       # Build + symlink

# Code generation (run after adding entities, env vars, or controllers)
npm run velogen -- t examples/full-demo           # DB types
npm run velogen -- e examples/full-demo           # Env config
npm run velogen -- oa examples/full-demo          # OpenAPI spec
npm run velogen -- c examples/full-demo           # Typed client
npm run velogen -- a examples/full-demo           # API tester UI
npm run velogen -- all examples/full-demo         # All of the above

# Tests
bun test

# Run the demo
npm run demo                                      # → http://localhost:5000
                                                  # → http://localhost:5000/apitester
```

After modifying framework source, re-run `npm run dev` to rebuild and sync.

## Quick Start

### 1. Velocity instance (`velo.ts`)

```typescript
import { VelocityApplication } from '@velocity/framework';

export const velo = new VelocityApplication({
  port: 5000,
  globalPrefix: '/api',
  cors: { origin: '*', credentials: false },
  shutdown: { timeout: 10_000, auto: true }, // graceful SIGTERM/SIGINT
});
```

### 2. Database (`db.ts`)

```typescript
import { DB } from '@velocity/framework';
import type { TypedDb } from './velo/velotypes';

export const db = DB({
  type: 'sqlite',
  database: ':memory:',
  filename: ':memory:'
}) as TypedDb;
```

### 3. Entity (`src/entities/user.entity.ts`)

```typescript
import { Entity, Column, PrimaryKey } from '@velocity/framework';
import { db } from '../../db';

@Entity('users')
export class User {
  @PrimaryKey() id: number;
  @Column() name: string;
  @Column({ unique: true }) email: string;
  @Column({ nullable: true }) age?: number;
  constructor() { this.id = 0; this.name = ''; this.email = ''; }
}

db.register(User);
```

### 4. Controller (`src/controllers/user.controller.ts`)

```typescript
import { Controller, Get, Post as HttpPost, Middlewares, Validate, Validator,
         VelocityRequest, VelocityResponse, MiddlewareFunction } from '@velocity/framework';
import { db } from '../../db';
import { velo } from '../../velo';
import * as Joi from 'joi';

const auth: MiddlewareFunction = (req, res, next) => {
  if (!req.headers['authorization']) { res.status(401).json({ error: 'Unauthorized' }); return; }
  next();
};

@Controller('/users')
class UserController {
  @Get('/')
  async list() { return { users: await db.User.findAll() }; }

  @HttpPost('/')
  @Middlewares(auth)
  @Validate(Validator.createSchema({ name: Joi.string().required(), email: Joi.string().email().required() }))
  async create(req: VelocityRequest, res: VelocityResponse) {
    return res.status(201).json({ user: await db.User.create(req.body) });
  }
}

velo.register(UserController);
```

### 5. Entry point (`main.ts`)

```typescript
import * as path from 'path';
import { velo } from './velo';
import './src/entities/user.entity';
import './src/controllers/user.controller';

velo.serve('/apitester', path.join(__dirname, 'velo/apitester.html'));

async function main() { await velo.listen(); }
main().catch(console.error);
```

## Tools

### `velogen t` — DB Type Generator

Scans `*.entity.ts` files and generates `velo/velotypes.d.ts` with typed interfaces.

```bash
npm run velogen -- t examples/full-demo
```

### `velogen e` — Envelocity Config Generator

Reads `.env`, generates typed read-only config with `OrThrow` getters.

```bash
npm run velogen -- e examples/full-demo
```

```typescript
import { envelocity } from './velo/envelocity';

envelocity.db.type              // "sqlite" | undefined
envelocity.db.typeOrThrow       // "sqlite" (throws if missing)
envelocity.auth.jwtSecret       // string | undefined
envelocity.server.port = '3000' // Error: read-only
```

Naming rules:
- `_` → camelCase: `DB_HOST` → `dbHost`
- `__` → nesting: `DB__HOST` → `db.host`
- `___` → preserved underscore: `DB___HOST` → `db._host`

### `velogen oa` — OpenAPI Spec Generator

Scans `@Controller` + route decorators and generates `velo/openapi.json` (OpenAPI 3.1).
Detects `@Validate` (400 responses), `@Guards` (403 + bearerAuth), `@Upload` (multipart),
and path parameters automatically.

```bash
npm run velogen -- oa examples/full-demo
```

### `velogen c` — Typed Client Generator

Generates `velo/velient.ts` — a typed fetch wrapper grouped by controller namespace.
Each route becomes a function with the correct path params, body arg, and request options.

```bash
npm run velogen -- c examples/full-demo
npm run velogen -- c examples/full-demo --base-url=http://api.example.com
```

```typescript
import { user } from './velo/velient';

const users = await user.list();
const u = await user.getById('123');
```

### `velogen a` — API Testing UI Generator

Scans controllers, extracts routes/validation/auth, generates an interactive HTML tester.

```bash
npm run velogen -- a examples/full-demo
```

Features:
- All endpoints auto-discovered from `@Controller`/`@Get`/`@Post` decorators
- Sample request bodies pre-filled from Joi validation schemas
- Auth token management (persistent, auto-enabled for protected endpoints)
- Response time, status, body size per request
- Performance log with min/max/avg stats
- Light/dark theme (persistent)
- Keyboard shortcut: `Ctrl+Enter` to send

## Registration API

### Variadic registration

```typescript
velo.register(UserController, PostController);
velo.register(AuthService, UserService);
```

### Scoped services

```typescript
velo.register(AuthService, { scope: [UserController] });
```

### Controller nesting

```typescript
velo.register(ProfileController, { scope: [UserController] });
// ProfileController routes at /api/users/profile/...
```

### Options

```typescript
interface RegisterOptions {
  scope?: any[];              // Controllers to scope to
  singleton?: boolean;        // Singleton (default) or transient
  prefix?: string;            // Override controller path
  middleware?: MiddlewareFunction[];  // Additional middleware applied to all routes
}
```

## Graceful Shutdown

```typescript
const velo = new VelocityApplication({
  port: 5000,
  shutdown: { timeout: 10_000, auto: true },
});
await velo.listen();
// SIGTERM/SIGINT registered automatically
// or: process.on('SIGTERM', () => velo.close())
```

`close()` sequence: stop accepting → drain in-flight requests → close DB connections → log "Server closed".

## Background Workers (`@Go` + `@Channel`)

```typescript
@Service()
class JobWorkerService {
  @Go()
  async run(
    @Channel('velocity:jobs')    jobs: VelocityChannel<Job>,
    @Channel('velocity:results') out:  VelocityChannel<JobResult>,
  ) {
    for await (const job of jobs) {
      out.send({ jobId: job.id, output: 'processed' });
    }
  }
}
velo.register(JobWorkerService);
```

`@Go` spawns a real Bun Worker thread when the server starts. `@Channel` injects `VelocityChannel<T>` (backed by `BroadcastChannel`) for typed cross-thread messaging. Falls back to event-loop concurrency on Node.js.

## HTTP Function Calls (`@Fn`)

```typescript
@Controller('/users')
class UserController {
  // GET /.findUser(1)
  @Fn()
  async findUser(id: number) {
    return db.User.findById(id);
  }

  // GET /.greet("Alice",true)
  @Fn()
  async greet(name: string, formal: boolean) {
    return { message: formal ? `Good day, ${name}.` : `Hey ${name}!` };
  }
}
```

All HTTP methods reach `/.` routes. Return value is JSON; `undefined` → 204. No `eval` — safe state-machine arg parser handles numbers, booleans, `null`, quoted strings, unquoted strings.

## Guards

```typescript
import { Guards, VelocityRequest } from '@velocity/framework';

const authGuard = (req: VelocityRequest) => !!req.headers['authorization'];

@Get('/protected')
@Guards(authGuard)
async protectedRoute(req: any, res: any) {
  return { secret: 'data' };
}
```

Guards return `boolean` — `false` → 403 Forbidden. Guards run **before** middleware.

## Lifecycle Hooks

```typescript
velo.onRequest((req) => { (req as any).startTime = performance.now(); });
velo.onResponse((req, res) => {
  console.log(`${req.method} ${req.url} — ${performance.now() - (req as any).startTime}ms`);
});
velo.onError((error, req, res) => {
  res.status(500).json({ error: error.message, code: 'INTERNAL' });
});
```

- `onRequest` — runs before routing; use for timing, logging, request enrichment
- `onResponse` — runs after handler completes; use for logging, metrics
- `onError` — replaces the default 500 handler; use for custom error formatting

## Cookies

```typescript
// Read cookies (lazy-parsed from Cookie header)
const token = req.cookies?.session;

// Set cookies with full options
res.setCookie('session', 'abc123', {
  httpOnly: true,
  secure: true,
  sameSite: 'Strict',
  maxAge: 86400,
  path: '/',
});
```

## File Uploads

```typescript
import { Upload, UploadedFile } from '@velocity/framework';

@Post('/avatar')
@Upload({ maxSize: 5 * 1024 * 1024, maxFiles: 1 })
async uploadAvatar(req: any) {
  const file = req.files.avatar as UploadedFile;
  // file.fieldname, file.originalname, file.mimetype, file.size, file.buffer
  return { uploaded: file.originalname, size: file.size };
}
```

Bun-native multipart parsing via `formData()`. Text fields in `req.body`, files in `req.files`.

## WebSocket

```typescript
import { WebSocket } from '@velocity/framework';

@WebSocket('/chat')
class ChatGateway {
  onOpen(ws: any)    { console.log('connected'); }
  onMessage(ws: any, message: string) { ws.send(`echo: ${message}`); }
  onClose(ws: any)   { console.log('disconnected'); }
}

velo.registerWebSocket(ChatGateway);
```

Bun-native WebSocket via `Bun.serve({ websocket })`. Path-based gateway dispatch.

## Response Compression

```typescript
const velo = new VelocityApplication({
  port: 5000,
  compression: { enabled: true, threshold: 1024 }, // gzip responses > 1 KB
});
```

Uses `Bun.gzipSync()` — zero deps. Compresses JSON, text, JS, and XML responses. Checks `Accept-Encoding` header.

## ORM — Entity Accessor API

```typescript
await db.User.findAll();
await db.User.findById(1);
await db.User.findOne({ email: 'alice@example.com' });
await db.User.create({ name: 'Alice', email: 'alice@example.com' });
await db.User.update(1, { name: 'Bob' });
await db.User.delete(1);
await db.User.count({ age: 25 });
await db.User.query().select('name').where('age > ?', 18).orderBy('name').execute();
```

## Static File Serving

```typescript
velo.serve('/docs', path.join(__dirname, 'public/docs.html'));
velo.static('/assets/', path.join(__dirname, 'public/assets'));
```

## Testing

### Decorator-based tests (`@Suite` / `@Test`)

```typescript
import { Suite, Test, BeforeEach, AfterEach, Mock, expect, mock } from '@velocity/framework';
import { TestUtils } from '@velocity/framework';

@Suite('User service')
class UserServiceTests {
  private app!: VelocityApplication;

  // Factory re-called before each @Test — fresh mock, no accumulated call history
  @Mock(() => mock(() => [{ id: 1, name: 'Alice' }]))
  private queryFn: any;

  @BeforeEach
  async setup() {
    this.app = TestUtils.createTestApp();
    this.app.register(UserController);
  }

  @Test('returns all users')
  async allUsers() {
    const { status, body } = await TestUtils.makeRequest(this.app, {
      method: 'GET',
      path: '/users',
    });
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  }
}
```

### TestUtils helpers

```typescript
// Create a silent test app (logging suppressed)
const app = TestUtils.createTestApp({ cors: { origin: '*', credentials: false } });
app.register(MyController);

// Drive handleRequest() directly — no network
const { status, headers, body } = await TestUtils.makeRequest(app, {
  method:  'POST',
  path:    '/items',
  body:    { name: 'sword' },
  headers: { authorization: 'Bearer token' },
});
```

`makeRequest` calls `prepareForTesting()` automatically (initializes routes without starting a server).

### Traditional `describe/test` style

Test files can also use `bun:test` directly — both styles work:

```typescript
import { describe, test, expect } from 'bun:test';
import { TestUtils } from '@velocity/framework';
```

> **Note:** Decorated controller methods in test fixtures must use `any` for request parameters (not `VelocityRequest`). TypeScript interfaces are erased at runtime, but `emitDecoratorMetadata` tries to capture them as values — causing a Bun error.

## Supported Databases

| Database | Driver | Config `type` |
|---|---|---|
| SQLite | `bun:sqlite` (Bun) / `better-sqlite3` (Node) | `'sqlite'` |
| PostgreSQL | `pg` (Pool) | `'postgresql'` |
| MySQL | `mysql2` (Pool) | `'mysql'` |

Optional pool config:

```typescript
export const db = DB({ type: 'postgresql', database: 'mydb', pool: { min: 5, max: 20 } });
```

## Project Structure

```
src/
  core/application.ts      — HTTP server, registration, trie router, request pipeline
  core/container.ts        — DI container (parent/child, singleton, cycle detection)
  core/metadata.ts         — Internal Reflect polyfill (replaces reflect-metadata)
  config/envelocity.ts     — Envelocity runtime (env tree, Proxy, OrThrow)
  decorators/              — @Controller, @Get/@Post, @Service, @Middlewares, @Interceptors
                             @Go, @Channel, @Fn, @Guards, @Upload, @WebSocket
  channel/                 — VelocityChannel<T> (BroadcastChannel wrapper)
  workers/                 — go-runner.ts (Bun Worker entry point for @Go)
  orm/                     — Database, EntityAccessor, QueryBuilder, Connection, decorators
  middleware/              — CORS, rate limiting, security headers
  interceptors/            — TransformInterceptor
  validation/              — Joi-based validation + @Validate
  logging/                 — Custom zero-dep structured logger
  testing/                 — TestUtils, @Suite/@Test decorator framework
scripts/
  sync.js                  — Symlinks dist/ to node_modules/@velocity/framework
  velogen.js               — Unified code generator CLI (dispatcher)
  velogen-types.js         — DB type generator (velogen t)
  velogen-env.js           — Envelocity config generator (velogen e)
  velogen-openapi.js       — OpenAPI 3.1 spec generator (velogen oa)
  velogen-client.js        — Typed fetch client generator (velogen c)
  velogen-api.js           — Interactive API tester UI (velogen a)
tests/
  fn.test.ts, container.test.ts, router.test.ts,
  middleware.test.ts, validator.test.ts,
  query-builder.test.ts, e2e.test.ts
examples/
  full-demo/               — Complete example with all features
    velo.ts, db.ts, main.ts
    src/controllers/, src/entities/, src/services/
    velo/                  — Generated files (types, envelocity, apitester)
    public/                — Static HTML
```
