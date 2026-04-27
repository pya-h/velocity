# Velocity Framework — Improvement Tasks

> Scope: performance, memory, DX, and feature expansion — without breaking minimalism, the
> decorator API, self-registration, Prisma-like ORM, or the single `register()` philosophy.
> All optimization tasks are internal changes; no new public API surface unless noted.

---

## Optimization

### T-01: Native `Bun.serve()` adapter — DONE
**Area:** Throughput
Velocity previously used `node:http` even on Bun. A thin adapter was added in `src/core/application.ts`:
when `typeof Bun !== 'undefined'`, `listen()` calls `Bun.serve()` instead of `http.createServer()`.
Incoming `Request` objects are normalized into fake Node-compatible `VelocityRequest`/`VelocityResponse`
objects via `createBunReqRes()`; static files use `Bun.file()` directly.
**Result (measured):** ~15,500 req/sec at c=200 (vs ~14,142 with `node:http`). Raw `Bun.serve()`
baseline is ~17,800 at same concurrency — ~13% overhead. Main remaining cost: adapter layer +
double URL parse + linear route scan (see T-04, T-05).

---

### T-02: Replace Winston with custom logger — DONE
**Area:** Memory / Deps
Winston (~10-15 MB, 15+ transitive deps) replaced with a zero-dep custom `Logger` class in
`src/logging/logger.ts` (~65 lines). Supports the same `level`, `format` (json/simple/combined),
and `outputs` (console/file) config. Console output colorizes only when stdout is a TTY.
Public API (`debug`, `info`, `warn`, `error`, `log`) is unchanged.
**Result:** One fewer dependency; idle RSS will drop ~10-15 MB on next measurement.

---

### T-03: Lazy-load `joi` — DROPPED
**Area:** Memory
Attempted: replace static `import * as Joi from 'joi'` with dynamic `await import('joi')` inside
`createSchema()`. Reverted because `createSchema()` is called at module top-level in controllers
(before class decoration), requiring top-level `await` — which conflicts with `"module": commonjs`
in tsconfig and causes issues in non-Bun contexts. The memory saving (~5-8 MB) was also deemed
not worth the API complexity. Joi remains a static import.

---

### T-04: Pre-compile route patterns at registration time — DONE
**Area:** Performance (hot path)
Route patterns like `/:id` were previously parsed per-request in `matchPath()` (split by `/`,
filter empty parts, iterate). Each request triggered repeated string splitting and character-by-character
pattern scanning for every registered route.

Patterns are now compiled once in `compileRoutes()` (called at `listen()` time, after all
controllers are registered). Each `basePath + route.path` combination is converted to a `RegExp`
with named capture groups via `compilePattern()`:
- `/users/:id` → `/^\/users\/(?<id>[^\/]+)$/` with `paramNames = ['id']`
- `/api/posts` → `/^\/api\/posts$/` with `paramNames = []`

The compiled entries are stored in a flat `compiledRoutes: CompiledRoute[]` array. `findRoute()`
now does a single `regex.exec(pathname)` per entry — no string splitting, no per-segment loops.
`matchPath()` was removed (dead code).
**Result:** Eliminates per-request string allocation and iterative segment scanning from the hot
path. Most visible under high concurrency with parameterized routes (T-01 follow-up).

---

### T-05: Trie/radix router — DONE
**Area:** Performance at scale
Replaced the O(n) linear route scan (T-04's `compiledRoutes` array) with a segment-trie
(`TrieNode`) built once at `listen()` time. Zero external dependencies — ~50 lines internal.

**Trie structure:**
```typescript
interface TrieNode {
  children: Map<string, TrieNode>;               // literal segment → child
  paramChild: { name: string; node: TrieNode } | null;  // :param child
  handlers: Map<string, { route, controller }>;  // HTTP method → handler
}
```

**Route lookup** (`findRoute` → `walkTrie`):
- Split pathname by `/` once → O(k) segments
- At each level: try literal `Map.get()` first (O(1)), fall back to `paramChild`
- Literal routes always take priority over param routes at the same depth
  (e.g. `GET /users/settings` matches before `GET /users/:id`)
- Total per-request cost: O(k) trie node lookups, k = path segment count
  — independent of total route count

**Route registration** (`buildTrie` + `insertRoute`):
- Called once at `listen()` time, O(n×k) total build cost
- `compilePattern`, `compileRoutes`, `compiledRoutes` removed (dead code after T-04→T-05)

**Impact:** Negligible difference for small apps; O(n) → O(k) means route-count no longer
affects request latency — large route tables (50+) no longer degrade throughput.

---

### T-06: DB connection pooling for `pg` and `mysql2` — DONE
**Area:** Throughput (PostgreSQL / MySQL apps)
`DatabaseConnection` previously created a single `pg.Client` / `mysql2.Connection`. Under
concurrent load all queries serialised behind that one connection.

**Changes:**
- `pg.Client` → `pg.Pool` with `min` (default 2) and `max` (default 10) connections
- `mysql2.createConnection` → `mysql2.createPool` with `connectionLimit` (default 10) and `waitForConnections: true`
- Removed the manual `await this.connection.connect()` for pg (Pool manages connections lazily)
- Added `pool?: { min?: number; max?: number }` to `DatabaseConfig` — purely additive, fully backward-compatible
- `query`, `execute`, and `close` methods unchanged — `Pool` exposes the same `.query()`/`.execute()`/`.end()` API as the single connection objects
- SQLite unaffected (single-writer by design; Bun's WAL mode handles concurrent reads)

```typescript
// zero migration cost — existing configs work without change
export const db = DB({ type: 'postgresql', database: 'mydb', ... });

// optional pool tuning
export const db = DB({ type: 'postgresql', database: 'mydb', pool: { min: 5, max: 20 } });
```

---

### T-07: Request body size limit — DONE (built-in)
A hard 1 MB cap (`MAX_BODY_SIZE`) already exists in `parseBody()` for both the Node path
(streaming byte counter) and the Bun path (Content-Length header check). No action needed.

---

### T-08: Graceful shutdown (`velo.close()`) — DONE
Added `shutdown?: { timeout?: number; auto?: boolean }` to `ApplicationConfig`.

**In-flight request draining:**
- `activeRequests` counter incremented/decremented per request on both runtimes:
  - **Node:** tracked in `handleRequest()` via `res.on('finish')` / `res.on('close')`
  - **Bun:** tracked in `bunFetchHandler()` via try/finally
- `waitForDrain(timeout)` polls every 50 ms until `activeRequests === 0` or deadline; logs a
  warning and resolves anyway if requests remain after timeout.

**`close()` sequence:**
1. Log "Shutting down gracefully..."
2. Close all DB connections
3. Stop accepting new connections (`server.stop(false)` on Bun, `server.close()` on Node)
4. `await waitForDrain(timeout)` — default 5 000 ms
5. Log "Server closed"

**Signal handlers (`shutdown.auto: true`):**
`process.once('SIGTERM', handler)` and `process.once('SIGINT', handler)` registered after
`listen()` resolves. Handler calls `close()` then `process.exit(0/1)`.

```typescript
export const velo = new VelocityApplication({
  port: 5000,
  shutdown: { timeout: 10_000, auto: true }, // register SIGTERM/SIGINT automatically
});
await velo.listen();
// or manually: process.on('SIGTERM', () => velo.close());
```

---

### T-09: Remove `reflect-metadata` dependency — DONE
**Area:** Memory / TC39 compatibility

Replaced the `reflect-metadata` npm package (~2-3 MB) with a zero-dep internal polyfill
(`src/core/metadata.ts`, ~55 lines). Zero breaking changes — `design:paramtypes` (DI) and
`design:type` (ORM column inference) continue to work identically.

**How it works:** TypeScript's compiler (with `emitDecoratorMetadata: true`) doesn't care which
implementation backs `Reflect` — it only checks `typeof Reflect.metadata === "function"` before
emitting calls. The polyfill patches the global `Reflect` object with `defineMetadata`,
`getMetadata`, and `metadata` before any decorator code runs. TypeScript-emitted `design:*`
calls go through the same storage as custom framework metadata keys.

**Changes:**
- `src/core/metadata.ts` — WeakMap-based store with prototype chain walk; patches global `Reflect`
- `src/types/reflect.d.ts` — type augmentation for the three added `Reflect` methods
- `src/index.ts` — `import 'reflect-metadata'` → `import './core/metadata'`
- `package.json` — `reflect-metadata` removed from dependencies

---

### T-10: `bun test` suite — DONE
**Area:** Correctness / enables safe refactoring

112 tests across 7 files, 0 failures. `bun test` runs in ~200 ms.

**Test decorator framework** (`src/testing/decorators.ts`):
- `@Suite(name)` — class decorator; registers a `describe()` block with all `@Test` methods
- `@Test(name?)` — marks a method as a test case (name defaults to method name)
- `@Mock(factory)` — property decorator; factory re-called before each test (fresh mock, no accumulated history)
- `@BeforeEach` / `@AfterEach` — run before/after each `@Test` in the suite
- `@BeforeAll` / `@AfterAll` — run once before/after all tests in the suite
- Re-exports `expect` and `mock` from `bun:test` so test files only need one import

**TestUtils improvements** (`src/testing/test-utils.ts`):
- `createMockRequest` always sets `__bunNativeRequest` (prevents `parseBody` hanging on stream events for POST/PUT/PATCH without bodies)
- `createMockRequest` pre-sets `req.body` for direct controller method calls (bypasses `handleRequest`)
- `createMockResponse` includes no-op `on/once/emit/removeListener` stubs (required for graceful-shutdown request tracking)
- `makeRequest` catches JSON parse errors and returns raw string body as fallback

**`VelocityApplication.prepareForTesting()`** (new public method):
Initializes registrations and builds the route trie without starting a server. Idempotent (`ready` flag). Called automatically by `TestUtils.makeRequest()`.

**Test files** (`tests/`):
| File | Style | What it covers |
|---|---|---|
| `fn.test.ts` | plain `describe/test` | `parseFunctionCall`, `parseFnArgs` — 20 cases |
| `container.test.ts` | `@Suite` | Singleton, transient, factory, constructor injection, circular deps, child containers |
| `router.test.ts` | plain `describe/test` | Literal routes, param extraction, literal>param priority, multi-param, method separation, global prefix + exclusions |
| `middleware.test.ts` | `@Suite` + plain | Middleware order, blocking, multi-level; CORS headers/preflight/credentials; rate-limit enforcement/headers/key generator |
| `validator.test.ts` | `@Suite` | Valid/invalid schemas, multi-error messages, preset types, `@Validate` decorator pass/fail |
| `query-builder.test.ts` | plain `describe/test` | SELECT/WHERE/JOIN/ORDER/LIMIT/OFFSET, INSERT/RETURNING, UPDATE, DELETE, identifier safety |
| `e2e.test.ts` | `@Suite` + plain | Full pipeline: GET/POST/PUT/DELETE, auth middleware, 204 on undefined return, 500 on throw, interceptors, `@Fn` dispatch, config-based CORS, preflight, idempotent `prepareForTesting()` |

**Usage note:** controller method parameters in test fixtures must use `any` (not `VelocityRequest`) because `emitDecoratorMetadata` captures parameter types as runtime values and TypeScript interfaces don't exist at runtime.

---

## Support Expanding

### T-SE-07: File upload support
**Who has it:** All major frameworks (Express via `multer`, Fastify via `@fastify/multipart`, NestJS via `@UploadedFile()`, Elysia natively).
**Current state:** `parseBody()` treats `multipart/form-data` as raw text. The 1 MB `MAX_BODY_SIZE` cap also blocks any realistic file upload before parsing begins.

**Approach:**
- **Bun path:** `bunReq.formData()` parses multipart natively — zero new deps. Extract `File` entries into structured `UploadedFile` objects.
- **Node path:** Use `busboy` (peer dep, ~40 KB, what `multer` uses internally) to stream-parse the multipart boundary.
- Expose files on `req.files: Record<string, UploadedFile | UploadedFile[]>` (field name → file).
- Add `@UploadedFile(field?)` parameter decorator — injects a single file from `req.files`.
- Add `@UploadedFiles(field?)` parameter decorator — injects an array (multi-file fields).
- Per-route upload size limit via `@Upload({ maxSize: number, maxFiles?: number })` — overrides the global 1 MB cap for that route only. Without this decorator, `multipart/form-data` requests still hit the 1 MB cap.
- Buffer mode (default) — full file in memory as `Buffer`. Stream mode opt-in (`@Upload({ stream: true })`) — passes a readable stream; useful for large files piped directly to object storage.

```typescript
@Post('/avatar')
@Upload({ maxSize: 5 * 1024 * 1024 }) // 5 MB for this route
async uploadAvatar(
  @UploadedFile('avatar') file: UploadedFile,
  req: VelocityRequest,
) {
  // file.buffer, file.originalname, file.mimetype, file.size
  await storage.save(file.buffer, file.originalname);
  return { url: `/uploads/${file.originalname}` };
}

@Post('/gallery')
@Upload({ maxSize: 20 * 1024 * 1024, maxFiles: 10 })
async uploadGallery(
  @UploadedFiles('photos') photos: UploadedFile[],
) {
  return { count: photos.length };
}
```

**UploadedFile shape:**
```typescript
interface UploadedFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;      // buffer mode
  stream?: Readable;   // stream mode only
}
```

**Implementation:** `src/decorators/upload.ts` (`@Upload`, `@UploadedFile`, `@UploadedFiles`),
`src/core/multipart.ts` (Bun-native + busboy Node fallback), wired into `parseBody()` / `handleRequest()`.

---

### T-SE-01: WebSocket support
**Who has it:** All major frameworks except Express.
**Approach:** On Bun, `Bun.serve()` has built-in WebSocket support via the `websocket` option —
zero extra deps. Add a `@WebSocket(path)` decorator and `velo.ws(path, handlers)` API.
On Node, fall back to the `ws` package (peer dep).
```typescript
@WebSocket('/chat')
class ChatGateway {
  onMessage(ws: VelocitySocket, data: string) { ws.send(`echo: ${data}`); }
  onClose(ws: VelocitySocket) { ... }
}
velo.register(ChatGateway);
```

---

### T-SE-02: OpenAPI / Swagger generation
**Who has it:** NestJS, Fastify (via plugins), Elysia.
**Approach:** Extend Velogen to emit an OpenAPI 3.1 spec from decorator metadata (`@Controller`,
`@Get`/`@Post`/etc., `@Validate` schema). Output `openapi.json` alongside the generated types.
Optionally serve it at `/api-docs` via `velo.serve('/api-docs', ...)`.
No new runtime dep — pure code generation from existing metadata.

---

### T-SE-03: Guards
**Who has it:** NestJS.
**Approach:** `@UseGuard(fn)` decorator — like middleware but returns `boolean` instead of
calling `next()`. Guards run before route middleware. Cleaner than middleware for auth checks
that need to block a request unconditionally.
```typescript
const authGuard = (req: VelocityRequest) => !!req.headers['authorization'];

@Get('/protected')
@UseGuard(authGuard)
async protected(req, res) { ... }
```
Simple to implement — one extra decorator + a guard-run loop before the middleware chain.

---

### T-SE-04: Cookie and session support
**Who has it:** Express, NestJS, Fastify.
**Approach:**
- Parse `Cookie` header into `req.cookies: Record<string, string>` in the request pipeline.
- Add `res.setCookie(name, value, options)` helper.
- Session: provide a `SessionMiddleware` that stores session data in memory (or pluggable store).
No mandatory dep — cookie parsing is a small string operation; session store defaults to
in-memory `Map`.

---

### T-SE-05: `@Go` background goroutines + `@Channel` injection — DONE
**Area:** DX / background jobs / real parallelism
Go-style background workers for service methods. When the server starts, each `@Go`-decorated
method is launched in a **real Bun Worker thread** — a separate OS thread with its own JS
context. True CPU + I/O parallelism; the worker never blocks the main request-handling thread.

Channels are injected directly into worker method parameters via the `@Channel(name)` parameter
decorator. No manual `new VelocityChannel(...)` instantiation needed inside the method body.
`VelocityChannel<T>` is backed by `BroadcastChannel` — fully cross-thread typed message passing.
```typescript
@Service()
class JobWorkerService {
  @Go()
  async run(
    @Channel('velocity:jobs') jobs: VelocityChannel<Job>,
    @Channel('velocity:results') out: VelocityChannel<JobResult>,
  ) {
    for await (const job of jobs) {
      out.send({ jobId: job.id, output: `processed` });
    }
  }
}
velo.register(JobWorkerService);
```
`@Go(options?)` accepts `{ data?: any }` — the data is `postMessage`d to the worker. If any
parameter is decorated with `@Channel`, channels are resolved and injected at those positions;
the `data` payload is ignored (it only applies when no `@Channel` decorators are present).
Source file auto-detection: `@Go` captures the call stack at decoration time to find the
service file path; no manual annotation needed.
Fallback: if not on Bun, or if file detection fails, falls back to event-loop concurrency
with a warning logged.
**Implementation:** `src/decorators/go.ts`, `src/decorators/channel.ts`,
`src/workers/go-runner.ts`, `VelocityApplication.startGoMethods()` (spawns `new Worker(goRunnerPath)`).

---

### T-SE-06: HTTP Function Calls (`@Fn`) — DONE
**Area:** DX / RPC-style endpoints
Mark any controller method with `@Fn()` to make it callable at `GET /.methodName(arg1,arg2,...)`.
Arguments are parsed directly from the URL path — numbers, booleans, `null`, quoted strings,
unquoted strings — with no `req`/`res` parameters or routing boilerplate.
```typescript
@Controller('/users')
class UserController {
  // GET /.findUser(1)
  @Fn()
  async findUser(id: number) {
    return db.User.findById(id);
  }

  // GET /.greet("Alice",true)  or  GET /.greet(Bob,false)
  @Fn()
  async greet(name: string, formal: boolean) {
    return { message: formal ? `Good day, ${name}.` : `Hey ${name}!` };
  }
}
```
All HTTP methods reach `/.` routes. The return value is sent as JSON; `undefined` → 204.
Errors thrown from the function are caught and returned as `{ error: message }` with 500.
Argument parsing is safe — no `eval`; state-machine parser with a 2000-char decoded arg limit.
`@Fn(name?)` accepts an optional alias: `@Fn('getUser')` registers as `/.getUser(...)`.
**Implementation:** `src/decorators/fn.ts` (`@Fn`, `parseFunctionCall`, `parseFnArgs`),
`VelocityApplication.functionRegistry` (Map populated during `registerController`),
`VelocityApplication.dispatchFunction()` (intercepts `pathname.startsWith('/.')` in `handleRequest`).
