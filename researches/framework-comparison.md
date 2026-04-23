# Velocity Framework vs Major Backend Frameworks

> Comparison date: 2026-04-22
> Velocity version: 0.1.0

## At a Glance

| | **Velocity** | **NestJS** | **Fastify** | **Hono** | **Elysia** | **Express** |
|---|---|---|---|---|---|---|
| Runtime | Node.js | Node.js | Node.js | Any (Node/Bun/Edge) | Bun only | Node.js |
| Source size | 2K lines | ~90K lines | ~15K lines | ~20K lines | ~12K lines | ~3K lines |
| Prod deps | 6 | 6 (core) + ~90 transitive | 15 + 41 transitive | **0** | 4 + 16 transitive | 28 + 65 transitive |
| TypeScript | Native, decorators | Native, decorators | Native, no decorators | Native, no decorators | Native, no decorators | @types bolt-on |
| DI Container | Built-in (hierarchical) | Built-in (module-scoped) | No | No | No (derive/decorate) | No |
| Built-in ORM | Yes (Prisma-like) | No (recommends TypeORM/Prisma) | No | No | No | No |
| Built-in Validation | Yes (Joi) | Yes (class-validator/pipes) | Yes (JSON Schema) | No | Yes (TypeBox) | No |
| Decorators | Yes | Yes (heavy) | No | No | No (method chaining) | No |
| Scoped Registration | Yes (controller-level) | Yes (module-level) | N/A | N/A | N/A | N/A |

## Performance (relative)

Absolute numbers are environment-dependent. What matters is **framework overhead vs raw Node.js http**:

| Framework | Overhead vs raw `http.createServer` | Why |
|---|---|---|
| **Velocity** | ~15% | URL parse + route match + response wrapping |
| **Fastify** | ~10-15% | Highly optimized find-my-way router, schema compilation |
| **Express** | ~40-50% | Regex-based routing, middleware chain per request |
| **NestJS (Express)** | ~60-80% | Express overhead + DI resolution + guards/pipes/interceptors |
| **NestJS (Fastify)** | ~25-35% | Fastify overhead + DI resolution |
| **Hono (Node)** | ~10-20% | Trie router, minimal abstraction |
| **Elysia (Bun)** | Different runtime — not directly comparable; Bun's `serve()` is fundamentally faster than Node's `http` |

## Memory

| Framework | Idle RSS (small app) |
|---|---|
| **Velocity** | ~78 MB |
| **Express** | ~62 MB |
| **Fastify** | ~45 MB |
| **NestJS** | ~89 MB |
| **Hono (Node)** | ~50 MB |
| **Elysia (Bun)** | ~15 MB (Bun runtime) |

Velocity's higher idle memory vs Express/Fastify comes from loading 3 database drivers (better-sqlite3, pg, mysql2) + winston + joi at import time. If these were lazy-loaded or peer deps, idle memory would drop significantly.

## What Velocity Has That Others Don't

- **Built-in ORM with Prisma-like API** — No external ORM needed. `db.User.findAll()` works out of the box. NestJS requires TypeORM/Prisma/Sequelize as separate packages.
- **Envelocity** — Typed, read-only, nested `.env` wrapper with `OrThrow` getters. No equivalent in any listed framework without external packages.
- **Velogen** — Generates typed DB interfaces from entity decorators. Similar concept to `prisma generate` but framework-native.
- **Controller-on-controller scoping** — Mount controllers under other controllers' paths with inherited middleware. NestJS has module-level scoping but not path-level controller nesting.
- **Single `register()` API** — Controllers, services, scoped or global, all through one variadic call. NestJS requires module declarations; others don't have DI.

## What Others Have That Velocity Doesn't (Yet)

| Feature | Who has it | Velocity gap |
|---|---|---|
| Trie/radix router | Fastify, Hono, Elysia | Velocity uses linear scan — fine for <50 routes, slower after |
| WebSocket support | All except Express | Not implemented |
| Multi-runtime | Hono (10+ runtimes) | Node.js only |
| OpenAPI/Swagger gen | NestJS, Fastify, Elysia | Not implemented |
| Guards/Pipes | NestJS | Middleware + interceptors cover most cases |
| Static file serving | Express, Fastify, Hono | Not implemented |
| Cookie/session | Express, NestJS, Fastify | Not implemented |
| CORS/Helmet (real) | Express, Fastify | Velocity has the classes but they're lightweight stubs |

## Where Velocity Wins

- **Minimal footprint**: 24 source files, 2K lines. Entire framework is readable in an afternoon.
- **Batteries-included ORM**: No need to install, configure, and wire up Prisma/TypeORM separately.
- **DI without module boilerplate**: NestJS requires `@Module({ imports, controllers, providers })` for every feature. Velocity: just `velo.register(X)`.
- **Type-safe env config**: Envelocity generates types from `.env` — zero runtime cost for type safety, OrThrow without function calls.

## Where Velocity Loses

- **Raw throughput**: Fastify and Hono have heavily optimized routers (trie-based, compiled). Velocity's linear route scan is simpler but slower at scale.
- **Ecosystem**: Express has 60K+ middleware packages. NestJS has 500+ official/community modules. Velocity has what's in `src/`.
- **Production hardening**: The listed frameworks have years of production battle-testing, CVE patches, and edge-case handling. Velocity is new.
- **Multi-runtime**: Hono runs on Cloudflare Workers, Deno, Bun, Lambda, Vercel Edge. Velocity is Node-only.

## Bottom Line

Velocity is closest in philosophy to **Fastify** (performance-focused, Node-native) but with the DX of **NestJS** (decorators, DI, structure) — without NestJS's module ceremony or dependency weight. The tradeoff is a smaller ecosystem and less production hardening. The ~15% overhead over raw http is competitive for a framework that includes DI, ORM, validation, and middleware.

## Benchmark Environment

- Node.js v24.4.1
- Linux 6.12.20-amd64
- Tool: Apache Bench (`ab`)
- Velocity measured: ~4,700 req/sec (via ts-node), ~5,070 req/sec (compiled)
- Raw Node.js http baseline: ~5,990 req/sec (same environment)
