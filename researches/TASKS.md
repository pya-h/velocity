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

### T-11: Eliminate double URL parse on Bun path — DONE
**Area:** Throughput (hot path)
`bunFetchHandler()` was parsing `new URL(request.url)`, then `handleRequest()` parsed it again.
**Fix:** `createBunReqRes` now attaches `__parsedUrl` to the fake request object. `handleRequest`
reuses it via `(req as any).__parsedUrl || new URL(...)` — Node path unchanged (no `__parsedUrl`,
falls back to `new URL()`). One URL parse eliminated per Bun request.
**Expected impact:** ~5-10% overhead reduction on Bun.

---

### T-12: Pre-compute static CORS headers at startup — DONE
**Area:** Throughput (hot path)
CORS headers were re-read from config and re-computed on every request.
**Fix:** `buildCorsPrecomputed()` runs once at `listen()` / `prepareForTesting()`. Pre-builds:
- `fixedHeaders: [string, string][]` — iterated in `handleRequest` (no config lookup per request)
- `fixedHeadersObj: Record<string, string>` — `Object.assign`ed in `tryServeStaticBun`
- `originSet: Set<string>` — O(1) origin matching instead of `Array.includes()`
Eliminated per-request: `config.get('cors')`, `Array.isArray()`, `credentials` check, 3-4 constant
`setHeader` calls replaced by pre-built tuple iteration.
**Expected impact:** ~1-2% per request; larger on CORS-heavy apps.

---

### T-13: Shared response methods instead of per-request closures — DONE
**Area:** GC pressure / throughput
`enhanceResponse()` created 3 new closures per request. Now `_resJson`, `_resStatus`, `_resSend`
are module-level `function` declarations (allocated once, use `this` binding). Node path: assigned
by reference in `enhanceResponse`. Bun path: added directly to the `rawRes` object literal —
`enhanceResponse` call eliminated entirely on Bun.
**Result:** Zero per-request function allocations; consistent object shape for V8/JSC optimization.

---

### T-14: Avoid array allocation in body-parse method check — DONE
**Area:** Throughput (micro)
`['POST', 'PUT', 'PATCH'].includes(method)` replaced with direct comparison:
`if (method === 'POST' || method === 'PUT' || method === 'PATCH')`.
Zero allocation, branch-predicted by the CPU.

---

### T-15: Lazy query parameter parsing — DONE
**Area:** Throughput / GC
`velocityReq.query = Object.fromEntries(url.searchParams)` ran on every request even when unused.
**Fix:** `Object.defineProperty` lazy getter — parses on first access, then replaces itself with
the computed value (self-memoizing). Routes that never touch `req.query` skip the allocation.
**Result:** Zero-cost for param-only routes; identical behavior for routes that read `req.query`.

---

### T-16: Per-route compiled handler functions (Elysia-style JIT) — DONE
**Area:** Throughput (hot path branching)
`handleRequest()` had a chain of runtime `if` checks on every request: body parse? middleware
array? interceptors? Each check added branches and prevented V8/JSC from inlining.
**Fix:** `compileRouteHandler()` runs once per route at `buildTrie()` time. It generates a
specialized `CompiledRouteHandler` closure that includes **only** the logic that route needs:
- GET routes → no body parsing in the closure
- Routes with no middleware → no middleware loop
- Routes with no interceptors → no interceptor loop
Each compiled handler also includes its own try/catch, so `handleRequest` just calls
`match.compiled(req, res)` after routing — zero per-request conditional branching.
`findRoute()` now returns `{ compiled, params } | null` instead of raw metadata.
Body parsing moved from pre-routing into the compiled handler (404s no longer waste time parsing).
**Result:** All optimization tasks T-11 through T-16 complete. Combined expected overhead
reduction: ~13% → ~5-8% (not yet re-benchmarked).

---

### T-17: Avoid param object copy in `walkTrie` for the common case — DONE
**Area:** Throughput (router hot path)
`walkTrie()` was copying `{ ...params }` at every literal child node.
**Fix:** Only copy when both a literal child AND a `paramChild` exist at the same depth (the only
case where rollback is needed). When only a literal child exists, descend directly without copying.
**Result:** For typical APIs (no ambiguous literal/param overlaps), zero object spreads during
route resolution.

---

### T-18: Lazy header access in Bun adapter (avoid full copy) — DONE
**Area:** GC / throughput
`createBunReqRes()` eagerly copied all request headers via `request.headers.forEach(...)`.
**Fix:** Replaced with a `Proxy` over the native `Headers` object. Headers are fetched via
`nativeHeaders.get(key)` on first access and cached in a plain object. Supports `get`, `has`,
`ownKeys`, and `getOwnPropertyDescriptor` traps for full compatibility.
**Result:** Browser requests (~10-15 headers) that only access 1-3 skip ~7-12 unnecessary string
allocations per request.

---

### T-19: Conditional `node:http` import on Bun — DONE
**Area:** Memory (startup)
`import { createServer } from 'http'` loaded the full http module on Bun where it's never used.
**Fix:** `import type { IncomingMessage, ServerResponse } from 'http'` (compile-time only, zero
runtime cost). `createServer` is now loaded via `require('http').createServer` only on the Node
path — gated by `IS_BUN` in the constructor.
**Expected impact:** ~1-3 MB RSS reduction on Bun.

---

## Support Expanding

### T-SE-07: File upload support — DONE
**Area:** DX / multipart handling
Bun-native multipart parsing via `request.formData()`. Per-route size/file-count limits via
`@Upload({ maxSize, maxFiles })`. Files exposed on `req.files: Record<string, UploadedFile | UploadedFile[]>`.
Text fields from multipart become `req.body`.
```typescript
@Post('/avatar')
@Upload({ maxSize: 5 * 1024 * 1024 })
async uploadAvatar(req: VelocityRequest) {
  const file = req.files!.avatar as UploadedFile;
  return { name: file.originalname, size: file.size };
}
```
**Implementation:** `src/decorators/upload.ts` (`@Upload`), multipart parsing in
`application.ts:parseMultipartBun()`, wired into `parseBody()` via `uploadOpts` in compiled handler.

---

### T-SE-01: WebSocket support — DONE
**Area:** Real-time / bidirectional
Bun-native WebSocket via `Bun.serve({ websocket })`. `@WebSocket(path)` class decorator +
`velo.registerWebSocket(GatewayClass)`. Gateway classes implement `onOpen(ws)`, `onMessage(ws, data)`,
`onClose(ws, code, reason)`. Path-based dispatch via `ws.data.__wsPath`.
```typescript
@WebSocket('/chat')
class ChatGateway {
  onOpen(ws: any)    { console.log('connected'); }
  onMessage(ws: any, msg: string) { ws.send(`echo: ${msg}`); }
  onClose(ws: any)   { console.log('disconnected'); }
}
velo.registerWebSocket(ChatGateway);
```
**Implementation:** `src/decorators/websocket.ts`, `VelocityApplication.registerWebSocket()`,
`bunFetchHandler` upgrade check, `listen()` websocket config wiring.

---

### T-SE-02: OpenAPI / Swagger generation — DONE
**Area:** DX / documentation
Static analysis code generator (`scripts/velogen-openapi.js`) scans `@Controller` + route
decorators, emits OpenAPI 3.1 `openapi.json`. Detects `@Validate` (400 responses),
`@Guards` (403 + bearerAuth security scheme), `@Upload` (multipart request body),
path parameters. Accessible via `velogen oa <dir>` or `velogen openapi <dir>`.

---

### T-SE-03: Guards — DONE
**Area:** Auth / access control
`@Guards(fn)` decorator — guard functions return `boolean`; `false` → 403 Forbidden.
Guards run **before** middleware in the compiled handler. Follows the same pending-merge
pattern as `@Middlewares` (works regardless of decorator order).
```typescript
const authGuard = (req: VelocityRequest) => !!req.headers['authorization'];

@Get('/protected')
@Guards(authGuard)
async protected(req: any, res: any) { ... }
```
**Implementation:** `src/decorators/guard.ts`, merged via `route.ts` pending guards,
executed in `compileRouteHandler()`.

---

### T-SE-04: Cookie and session support — DONE
**Area:** DX / auth
Lazy cookie parsing via `Object.defineProperty` getter on `req.cookies` — zero allocation
for routes that don't read cookies. `res.setCookie(name, value, options)` builds a
`Set-Cookie` header with full options (maxAge, expires, path, domain, secure, httpOnly, sameSite).
Appends to existing `Set-Cookie` headers (multiple cookies per response).
**Implementation:** `_parseCookies()` and `_resCookie()` shared helpers in `application.ts`.

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

---

### T-SE-08: Eden-like typed client generation (Elysia-inspired) — DONE
**Area:** DX / frontend integration
Static analysis code generator (`scripts/velogen-client.js`) scans `@Controller` + route
decorators, emits `velocity-client.ts` — a typed fetch wrapper grouped by controller namespace.
Each route becomes a function with the correct path params, body arg, and options.
Accessible via `velogen c <dir>` or `velogen client <dir>`. Supports `--base-url=` flag.
```typescript
// Generated: velocity-client.ts
export const user = {
  list:    (opts?) => _fetch('GET', '/users/', undefined, opts),
  getById: (id: string, opts?) => _fetch('GET', `/users/${id}`, undefined, opts),
  create:  (body: any, opts?) => _fetch('POST', '/users/', body, opts),
};
```

---

### T-SE-09: Lifecycle hooks (`onRequest`, `onResponse`, `onError`) — DONE
**Area:** DX / observability
```typescript
velo.onRequest((req) => { (req as any).startTime = performance.now(); });
velo.onResponse((req, res) => { console.log(`${req.method} ${req.url} — ${performance.now() - (req as any).startTime}ms`); });
velo.onError((error, req, res) => { res.status(500).json({ error: error.message }); });
```
`onRequest` runs before routing. `onResponse` runs after the compiled handler completes.
`onError` replaces the default 500 handler — if any `onError` hooks are registered, the
default logger + 500 response is skipped entirely.
**Implementation:** `_onRequest`, `_onResponse`, `_onError` arrays + public methods in
`application.ts`; iterated in `handleRequest()`.

---

### T-SE-10: Response compression (gzip) — DONE
**Area:** Performance / payload size
`compression: { enabled: true, threshold: 1024 }` in `ApplicationConfig`. On Bun, uses
`Bun.gzipSync()` — zero deps. Compresses text-based responses (JSON, text, JS, XML) above
the threshold. Sets `Content-Encoding: gzip` and `Vary: Accept-Encoding`. Checks
`Accept-Encoding` header for `gzip` support. Skips binary/already-compressed types.
**Implementation:** Compression in `createBunReqRes:getResponse()`. Config initialized in
`listen()` and `prepareForTesting()`.
