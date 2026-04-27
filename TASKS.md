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

### T-04: Pre-compile route patterns at registration time
**Area:** Performance (hot path)
Route patterns like `/:id` are currently parsed per-request in `matchPath()`. Compile each
pattern to a `RegExp` with named capture groups once during `register()`. Store the compiled
regex alongside the handler. On each request, run the pre-compiled regex instead of re-parsing
the pattern string.
**Impact:** Removes repeated string splitting from the hot path. Most visible under high concurrency
with parameter routes. Prerequisite for reducing the adapter overhead measured in T-01.

---

### T-05: Trie/radix router
**Area:** Performance at scale
The current router is a linear scan: O(n) per request over all registered routes.
Replace with a radix tree. Options: minimal internal implementation (~150 lines) or
`find-my-way` (Fastify's router, zero transitive deps) as a peer dep.
**Impact:** Negligible for small apps (<20 routes); significant for large route tables (50+).
Reduces overhead vs raw `Bun.serve()` when route count grows.

---

### T-06: DB connection pooling for `pg` and `mysql2`
**Area:** Throughput (PostgreSQL / MySQL apps)
`DatabaseConnection` creates a single `Client`/`Connection`. Under concurrent load, queries
queue. Switch `pg.Client` → `pg.Pool` and `mysql2.createConnection` → `mysql2.createPool`.
Add optional `pool: { min, max }` to `DatabaseConfig` (additive, backward-compatible).
`bun:sqlite` unaffected (single-writer by design).

---

### T-07: Request body size limit — DONE (built-in)
A hard 1 MB cap (`MAX_BODY_SIZE`) already exists in `parseBody()` for both the Node path
(streaming byte counter) and the Bun path (Content-Length header check). No action needed.

---

### T-08: Graceful shutdown (`velo.close()`) — partial
`close()` already closes DB connections and stops the server. Remaining gaps:
- No `SIGTERM`/`SIGINT` handlers registered automatically
- No in-flight request draining (waits for `server.close()` but Node/Bun stop accepting
  new connections immediately without a drain timeout)
Add optional `shutdown: { timeout: number }` config and auto-register signal handlers when
`shutdown.auto` is `true`.

---

### T-09: Remove `reflect-metadata` dependency
**Area:** Memory / TC39 compatibility
`reflect-metadata` (~2-3 MB) is a polyfill for `emitDecoratorMetadata`. Replacing it requires
auditing all `Reflect.getMetadata('design:type', ...)` calls in the ORM/DI layers and replacing
them with explicit `type` options in `@Column({ type: 'text' })` (already partially supported).
**Risk:** High — touches the ORM decorator system. Requires thorough testing.

---

### T-10: `bun test` suite
**Area:** Correctness / enables safe refactoring
No automated tests exist. This makes T-04, T-05, T-09 risky to land.
Write unit tests for: router matching, middleware chain, interceptors, ORM query builder,
`Validator`, `Envelocity`. Write integration tests for: full request lifecycle, CORS, rate
limiting, error handling.

---

## Support Expanding

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

### T-SE-05: `@Go` background goroutines — DONE
**Area:** DX / background jobs / real parallelism
Go-style background workers for service methods. When the server starts, each `@Go`-decorated
method is launched in a **real Bun Worker thread** — a separate OS thread with its own JS
context. True CPU + I/O parallelism; the worker never blocks the main request-handling thread.
```typescript
@Service()
class SyncService {
  @Go({ data: { interval: 30_000 } })
  async syncFromRemote(data: { interval: number }) {
    while (true) {
      await Bun.sleep(data.interval);
      // runs in its own thread — never blocks the server
    }
  }
}
velo.register(SyncService);
```
`@Go(options?)` accepts `{ data?: any }` — the data is `postMessage`d to the worker and
forwarded as the first argument to the method. The worker imports the service file, instantiates
the class (no DI container — the worker is isolated), and calls the method.
Source file auto-detection: `@Go` captures the call stack at decoration time to find the
service file path; no manual annotation needed.
Fallback: if not on Bun, or if file detection fails, falls back to event-loop concurrency
with a warning logged.
**Implementation:** `src/decorators/go.ts`, `src/workers/go-runner.ts`,
`VelocityApplication.startGoMethods()` (spawns `new Worker(goRunnerPath)`).
