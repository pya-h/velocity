# Velocity Framework vs Major Backend Frameworks

> Comparison date: 2026-04-27 (updated — Bun refactor)
> Velocity version: 0.1.0

## At a Glance

| | **Velocity** | **NestJS** | **Fastify** | **Hono** | **Elysia** | **Express** |
|---|---|---|---|---|---|---|
| Runtime | Node.js / **Bun** | Node.js | Node.js | Any (Node/Bun/Edge) | Bun only | Node.js |
| Source size | 2K lines | ~90K lines | ~15K lines | ~20K lines | ~12K lines | ~3K lines |
| Prod deps | 4 | 6 (core) + ~90 transitive | 15 + 41 transitive | **0** | 4 + 16 transitive | 28 + 65 transitive |
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
| **Velocity (Bun.serve())** | ~13% at c=200 | Adapter layer + route scan + response wrapping (15,522 vs 17,818 req/sec) |
| **Velocity (node:http / Node.js)** | ~15% | Same overhead, slower absolute (5,070 vs 5,990 req/sec) |
| **Fastify** | ~10-15% | Highly optimized find-my-way router, schema compilation |
| **Express** | ~40-50% | Regex-based routing, middleware chain per request |
| **NestJS (Express)** | ~60-80% | Express overhead + DI resolution + guards/pipes/interceptors |
| **NestJS (Fastify)** | ~25-35% | Fastify overhead + DI resolution |
| **Hono (Node)** | ~10-20% | Trie router, minimal abstraction |
| **Elysia (Bun)** | Different runtime — not directly comparable; Bun's `serve()` is fundamentally faster than Node's `http` |

## Memory

| Framework | Idle RSS (small app) |
|---|---|
| **Velocity (Bun, no DB)** | ~75 MB (measured: Bun + winston + joi + reflect-metadata only) |
| **Velocity (Bun, SQLite)** | ~79 MB (measured: same + bun:sqlite built-in; pg/mysql2 never loaded) |
| **Raw Bun `node:http`** | ~46 MB (baseline — no framework, no deps) |
| **Express** | ~62 MB (Node.js) |
| **Fastify** | ~45 MB (Node.js) |
| **NestJS** | ~89 MB (Node.js) |
| **Hono (Node)** | ~50 MB (Node.js) |
| **Elysia (Bun)** | ~15 MB (Bun.serve() native, minimal deps) |

Database drivers (pg, mysql2, bun:sqlite) are **lazily loaded** via dynamic `import()` inside `connect()` — they are never imported unless the configured driver type is actually used. This means:

- A process that never calls `connect()` (e.g. a test suite, a script, a microservice with no DB) pays zero driver overhead.
- `bun:sqlite` is a Bun built-in (no disk I/O, resolves from internal registry).
- `pg` and `mysql2` incur a one-time parse+cache cost on the first `connect()` call, then hit the module cache. Since `connect()` is called once at startup, there is no per-request overhead.

**Fair comparison note:** other frameworks in this table ship with no DB driver and no logger. Velocity's ~75 MB no-DB figure (vs raw Bun ~46 MB) reflects joi + reflect-metadata + the custom logger — the always-on framework dependencies. `pg` and `mysql2` are **never loaded** unless the configured type is `postgresql` or `mysql`, so they contribute nothing to RSS in a SQLite-only app.

Bun's JavaScriptCore baseline (~46 MB for a raw HTTP server) is higher than Node's V8 at similar scale — this is why Velocity on Bun (~75 MB no-DB) doesn't look dramatically better than Express on Node (~62 MB). The throughput advantage is where Bun shows up (14,142 vs ~5,000 req/sec).

## What Velocity Has That Others Don't

- **Built-in ORM with Prisma-like API** — No external ORM needed. `db.User.findAll()` works out of the box. NestJS requires TypeORM/Prisma/Sequelize as separate packages. DB drivers are lazily loaded — only the configured driver is ever imported, so unused drivers cost nothing at runtime.
- **Envelocity** — Typed, read-only, nested `.env` wrapper with `OrThrow` getters. No equivalent in any listed framework without external packages.
- **Velogen** — Generates typed DB interfaces from entity decorators. Similar concept to `prisma generate` but framework-native.
- **Controller-on-controller scoping** — Mount controllers under other controllers' paths with inherited middleware. NestJS has module-level scoping but not path-level controller nesting.
- **Single `register()` API** — Controllers, services, scoped or global, all through one variadic call. NestJS requires module declarations; others don't have DI.

## What Others Have That Velocity Doesn't (Yet)

| Feature | Who has it | Velocity gap |
|---|---|---|
| Trie/radix router | Fastify, Hono, Elysia | Velocity uses linear scan — fine for <50 routes, slower after |
| WebSocket support | All except Express | Not implemented |
| Multi-runtime | Hono (10+ runtimes) | Node.js + Bun; not CF Workers / Deno / Edge |
| OpenAPI/Swagger gen | NestJS, Fastify, Elysia | Not implemented |
| Guards/Pipes | NestJS | Middleware + interceptors cover most cases |
| Cookie/session | Express, NestJS, Fastify | Not implemented |

## Where Velocity Wins

- **Minimal footprint**: 24 source files, 2K lines. Entire framework is readable in an afternoon.
- **Batteries-included ORM**: No need to install, configure, and wire up Prisma/TypeORM separately.
- **DI without module boilerplate**: NestJS requires `@Module({ imports, controllers, providers })` for every feature. Velocity: just `velo.register(X)`.
- **Type-safe env config**: Envelocity generates types from `.env` — zero runtime cost for type safety, OrThrow without function calls.
- **Built-in API tester**: `npm run apitester` generates an interactive testing UI from decorators — no Postman, no Swagger setup, no external tools. No other framework does this.
- **`@Go()` background goroutines**: Service methods decorated with `@Go()` launch in a real **Bun Worker thread** when the server starts — true OS-level parallelism, not event-loop concurrency. Accepts `{ data }` for passing initial config to the worker. No other framework has this.
- **Static file serving**: `velo.serve()` and `velo.static()` — single files or directories, with MIME detection and path traversal protection.
- **Config-based CORS**: Set `cors: { origin: '*' }` in config — automatic `Access-Control-*` headers and OPTIONS handling. No middleware to install.

## Where Velocity Loses

- **Raw throughput**: Fastify and Hono have heavily optimized routers (trie-based, compiled). Velocity's linear route scan is simpler but slower at scale.
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
- Main remaining overhead sources: Bun adapter req/res shim, double URL parse, linear route scan (T-04/T-05)
