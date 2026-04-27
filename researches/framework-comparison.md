# Velocity Framework vs Major Backend Frameworks

> Comparison date: 2026-04-27 (updated — @Fn HTTP functions, @Channel param injection, segment-trie router, graceful shutdown, reflect-metadata removed, test framework)
> Velocity version: 0.1.0

## At a Glance

| | **Velocity** | **NestJS** | **Fastify** | **Hono** | **Elysia** | **Express** |
|---|---|---|---|---|---|---|
| Runtime | Node.js / **Bun** | Node.js | Node.js | Any (Node/Bun/Edge) | Bun only | Node.js |
| Source size | ~3.4K lines | ~90K lines | ~15K lines | ~20K lines | ~12K lines | ~3K lines |
| Prod deps | **3** (joi + pg + mysql2) | 6 (core) + ~90 transitive | 15 + 41 transitive | **0** | 4 + 16 transitive | 28 + 65 transitive |
| TypeScript | Native, decorators | Native, decorators | Native, no decorators | Native, no decorators | Native, no decorators | @types bolt-on |
| DI Container | Built-in (hierarchical) | Built-in (module-scoped) | No | No | No (derive/decorate) | No |
| Built-in ORM | Yes (Prisma-like) | No (recommends TypeORM/Prisma) | No | No | No | No |
| Built-in Validation | Yes (Joi) | Yes (class-validator/pipes) | Yes (JSON Schema) | No | Yes (TypeBox) | No |
| Decorators | Yes | Yes (heavy) | No | No | No (method chaining) | No |
| Scoped Registration | Yes (controller-level) | Yes (module-level) | N/A | N/A | N/A | N/A |

## Performance (relative)

Absolute numbers are environment-dependent. What matters is **framework overhead vs the raw `http.createServer` on the same runtime**:

| Framework | Overhead vs raw `http.createServer` | Why |
|---|---|---|
| **Velocity (Bun.serve())** | ~13% at c=200 | Adapter layer + response wrapping (15,522 vs 17,818 req/sec; trie router now in place) |
| **Velocity (node:http / Node.js)** | ~15% | Same overhead, slower absolute (5,070 vs 5,990 req/sec) |
| **Fastify** | ~10-15% | Highly optimized find-my-way router, schema compilation |
| **Express** | ~40-50% | Regex-based routing, middleware chain per request |
| **NestJS (Express)** | ~60-80% | Express overhead + DI resolution + guards/pipes/interceptors |
| **NestJS (Fastify)** | ~25-35% | Fastify overhead + DI resolution |
| **Hono (Node)** | ~10-20% | Trie router, minimal abstraction |
| **Elysia (Bun)** | Different runtime — not directly comparable; Bun's `serve()` is fundamentally faster than Node's `http` |

## Memory

> **Important:** Bun uses JavaScriptCore (JSC); Node.js uses V8. These engines have different
> baseline footprints — JSC starts at ~40–46 MB before any framework code runs, while V8 starts
> at ~20–25 MB. **Cross-engine comparisons are misleading** — a Node.js framework at 45 MB can
> look "lighter" than an empty Bun process, not because it uses less memory, but because V8 is
> a smaller engine at startup. Compare within the same engine.

### Bun (JavaScriptCore)

| | Idle RSS | Notes |
|---|---|---|
| Raw `Bun.serve()` (no deps) | ~40–46 MB | JSC baseline — engine + JIT + GC infrastructure |
| **Velocity (Bun, no DB)** | ~75 MB | Measured: framework + joi (internal Reflect polyfill; reflect-metadata removed T-09) |
| **Velocity (Bun, SQLite)** | ~79 MB | Same + bun:sqlite (Bun built-in, no extra driver load) |
| Elysia (Bun) | ~55–70 MB | Reported figures vary widely by measurement method |

### Node.js (V8)

| | Idle RSS | Notes |
|---|---|---|
| Raw `http.createServer` (no deps) | ~20–25 MB | V8 baseline |
| Fastify | ~45 MB | V8 (~22 MB) + Fastify + find-my-way + dependencies |
| Express | ~62 MB | V8 + Express + 28 production deps |
| Hono (Node) | ~50 MB | V8 + Hono |
| NestJS | ~89 MB | V8 + NestJS + TypeScript DI + reflect-metadata + transitive |

Database drivers (pg, mysql2, bun:sqlite) are **lazily loaded** via dynamic `import()` inside `connect()` — they are never imported unless the configured driver type is actually used. This means:

- A process that never calls `connect()` (e.g. a test suite, a script, a microservice with no DB) pays zero driver overhead.
- `bun:sqlite` is a Bun built-in (no disk I/O, resolves from internal registry).
- `pg` and `mysql2` incur a one-time parse+cache cost on the first `connect()` call, then hit the module cache. Since `connect()` is called once at startup, there is no per-request overhead.

**Framework overhead (within each engine):**
- Velocity on Bun adds ~26–30 MB over the raw `Bun.serve()` baseline — joi + framework code. `reflect-metadata` removed (T-09); Winston removed (T-02) — both were the main contributors to the previous ~29–33 MB figure.
- Fastify on Node adds ~20–25 MB over the raw `http.createServer` baseline.
- NestJS on Node adds ~64–69 MB over the raw baseline — DI system, reflect-metadata, module graph.

The throughput advantage of Bun is in req/sec (15,522 vs ~5,070 req/sec), not in memory — JSC trades higher idle RSS for faster JIT-compiled execution.

## What Velocity Has That Others Don't

- **Built-in ORM with Prisma-like API** — No external ORM needed. `db.User.findAll()` works out of the box. NestJS requires TypeORM/Prisma/Sequelize as separate packages. DB drivers are lazily loaded — only the configured driver is ever imported, so unused drivers cost nothing at runtime.
- **Envelocity** — Typed, read-only, nested `.env` wrapper with `OrThrow` getters. No equivalent in any listed framework without external packages.
- **Velogen** — Generates typed DB interfaces from entity decorators. Similar concept to `prisma generate` but framework-native.
- **Controller-on-controller scoping** — Mount controllers under other controllers' paths with inherited middleware. NestJS has module-level scoping but not path-level controller nesting.
- **Single `register()` API** — Controllers, services, scoped or global, all through one variadic call. NestJS requires module declarations; others don't have DI.

## What Others Have That Velocity Doesn't (Yet)

| Feature | Who has it | Velocity gap |
|---|---|---|
| WebSocket support | All except Express | Not implemented |
| Multi-runtime | Hono (10+ runtimes) | Node.js + Bun; not CF Workers / Deno / Edge |
| OpenAPI/Swagger gen | NestJS, Fastify, Elysia | Not implemented |
| Guards/Pipes | NestJS | Middleware + interceptors cover most cases |
| Cookie/session | Express, NestJS, Fastify | Not implemented |

## Where Velocity Wins

- **Minimal footprint**: ~32 source files, ~3.4K lines. Entire framework is readable in an afternoon.
- **Batteries-included ORM**: No need to install, configure, and wire up Prisma/TypeORM separately.
- **DI without module boilerplate**: NestJS requires `@Module({ imports, controllers, providers })` for every feature. Velocity: just `velo.register(X)`.
- **Type-safe env config**: Envelocity generates types from `.env` — zero runtime cost for type safety, OrThrow without function calls.
- **Built-in API tester**: `npm run apitester` generates an interactive testing UI from decorators — no Postman, no Swagger setup, no external tools. No other framework does this.
- **Built-in test decorator framework**: `@Suite/@Test/@BeforeEach/@AfterEach/@BeforeAll/@AfterAll/@Mock` — class-based tests with automatic mock refresh and lifecycle hooks. Built on `bun:test`; zero external test runners or libraries needed.
- **`@Go()` background goroutines with `@Channel` injection**: Service methods decorated with `@Go()` launch in a real **Bun Worker thread** when the server starts — true OS-level parallelism, not event-loop concurrency. `VelocityChannel<T>` (backed by `BroadcastChannel`) provides typed cross-thread message passing. Channels are injected into worker methods via `@Channel('name')` parameter decorators — no manual instantiation needed. No other framework has this.
- **HTTP Function Calls (`@Fn`)**: Mark any controller method with `@Fn()` and it becomes callable at `GET /.functionName(arg1,arg2,...)`. Arguments are parsed directly from the URL — numbers, booleans, `null`, quoted strings — with no req/res boilerplate. Great for simple RPC-style queries and internal tooling. No equivalent in any listed framework.
- **Static file serving**: `velo.serve()` and `velo.static()` — single files or directories, with MIME detection and path traversal protection.
- **Config-based CORS**: Set `cors: { origin: '*' }` in config — automatic `Access-Control-*` headers and OPTIONS handling. No middleware to install.
- **Graceful shutdown with in-flight draining**: `shutdown: { timeout: 5000, auto: true }` config option. When enabled, SIGTERM/SIGINT handlers are registered automatically after `listen()`. `close()` stops accepting new connections, waits up to `timeout` ms for in-flight requests to complete (polling every 50 ms), then resolves — warn-and-continue if the deadline is exceeded. Works on both Node.js (`res.on('finish')` tracking) and Bun (`bunFetchHandler` try/finally). NestJS requires a separate `app.enableShutdownHooks()` call; Express/Fastify require manual signal handler wiring.

## Where Velocity Loses

- **Raw throughput**: Fastify and Hono have heavily optimized routers (character-level radix, compiled schemas). Velocity now uses a segment-trie (O(k) lookup) but the Bun adapter req/res shim still adds overhead vs truly zero-cost native routing.
- **Ecosystem**: Express has 60K+ middleware packages. NestJS has 500+ official/community modules. Velocity has what's in `src/`.
- **Production hardening**: The listed frameworks have years of production battle-testing, CVE patches, and edge-case handling. Velocity is new.
- **Multi-runtime**: Hono runs on Cloudflare Workers, Deno, Bun, Lambda, Vercel Edge. Velocity runs on Node.js and Bun, but not edge/serverless runtimes.

## Bottom Line

Velocity is closest in philosophy to **Fastify** (performance-focused, Node-native) but with the DX of **NestJS** (decorators, DI, structure) — without NestJS's module ceremony or dependency weight. Since the Bun migration, it runs natively on Bun with zero code changes: `bun run main.ts` works out of the box, `bun:sqlite` replaces the `better-sqlite3` native addon, and `bun test` replaces Node's test runner. On Bun it delivers **~15,522 req/sec** (~13% overhead over raw `Bun.serve()`) — more than **3× faster** than the Node.js compiled baseline (5,070 req/sec). The tradeoff is a smaller ecosystem and less production hardening.

## Benchmark Environment

### Node.js (original)
- Node.js v24.4.1
- Linux 6.12.20-amd64
- Tool: Apache Bench (`ab`)
- Velocity measured: ~4,700 req/sec (via ts-node), ~5,070 req/sec (compiled)
- Raw Node.js http baseline: ~5,990 req/sec (same environment)

### Bun (current baseline — Bun.serve() native)
- Bun v1.3.13
- Linux 6.12.20-amd64
- Tool: Apache Bench (`ab -n 20000 -c 200 -l`)
- Velocity measured: **~15,522 req/sec** (`bun run main.ts`, `Bun.serve()` active)
- Raw `Bun.serve()` baseline: **~17,818 req/sec**
- Framework overhead: **~13%** (at c=200; rises to ~33% at c=100 due to adapter layer cost)
- Idle RSS: **~75 MB no-DB / ~79 MB with SQLite** (winston removed; pg and mysql2 never imported)
- Main remaining overhead sources: Bun adapter req/res shim, double URL parse (trie router now in place — route count no longer a factor)
