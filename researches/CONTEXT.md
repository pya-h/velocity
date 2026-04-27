# Velocity Framework — Project Context

## Philosophy

Velocity is a **minimal, fast, type-safe TypeScript framework** for Node.js/Bun. Every design decision optimizes for:

1. **Minimal** — Zero bloat. No express, no heavy ORM, no unused abstractions. Uses Node's built-in `http` module directly (plus `Bun.serve()` when on Bun).
2. **Fast** — Minimal overhead in the request pipeline. Segment-trie router (O(k) lookup, k = path depth). On Bun: ~15,522 req/sec, ~13% overhead over raw `Bun.serve()`.
3. **Memory-efficient** — No global registries beyond what's required. Lazy DB init. Zero-dep logger and metadata polyfill.
4. **Type-safe** — First-class TypeScript. `velogen` generates DB types, `envgen` generates env types — zero runtime cost for type safety.

## Architecture — Core Design Patterns

### No Modules

There is no Module/grouping concept. Controllers, services, and interceptors register directly on the velo instance. Developers organize their code however they want — the framework doesn't enforce directory structure or module boundaries.

### Self-Registration

Every component registers itself at the bottom of its own file:

```typescript
// user.controller.ts
@Controller('/users')
class UserController { ... }
velo.register(UserController);
```

The main entry point (`main.ts`) only imports these files — it doesn't manually register anything. Each file is self-contained.

**Why**: Reduces boilerplate in the entry point. Adding a new controller means creating one file, not editing two.

**Circular dependency avoidance**: The velo instance lives in a separate `velo.ts` file, not in `main.ts`. Controllers import from `velo.ts`, and `main.ts` imports controllers. No cycles.

### Variadic Registration with Options

`velo.register()` accepts any mix of controllers and services, with an optional trailing options object:

```typescript
velo.register(UserController);
velo.register(AuthService, UserService);
velo.register(AuthService, { scope: [UserController] });
velo.register(ProfileController, { scope: [UserController], middleware: [logMiddleware] });
```

Registration is **deferred** — `register()` queues targets and processes them at `velo.listen()` time.

### Scoped Services

Services can be scoped to specific controllers using child DI containers. Services without `scope` are registered globally.

### Controller Nesting

Controllers can be mounted as sub-routes of other controllers:

```typescript
velo.register(ProfileController, { scope: [UserController] });
// UserController at /users, ProfileController at /profile
// → ProfileController routes available at /users/profile/...
```

### Global Prefix

All controller endpoints can be prefixed globally, with exclusions:

```typescript
const velo = new VelocityApplication({
  globalPrefix: '/api',
  globalPrefixExclusions: ['/health']
});
```

### Prisma-like ORM (no Repository pattern)

Database access uses a direct entity accessor pattern:

```typescript
const users = await db.User.findAll();
const post = await db.Post.create({ title: 'Hello', ... });
```

There is **no Repository layer**. `EntityAccessor` provides `findAll`, `findById`, `findOne`, `findMany`, `create`, `update`, `delete`, `deleteWhere`, `count`, and `query()`.

Entities self-register on a DB instance (supports multi-entity):

```typescript
@Entity('users')
class User { ... }
db.register(User);
```

After registration, `db.User` is available as an `EntityAccessor<User>`.

### DB() Factory

Databases are created with the `DB()` factory function, not via app config:

```typescript
export const db = DB({ type: 'sqlite', database: ':memory:' });
```

`DB()` auto-registers on the current `VelocityApplication`. Multi-DB is supported.

### Type Generation (velogen / envgen)

- `velogen` generates TypeScript types for DB instances based on registered entities.
- `envgen` reads `.env`, generates typed read-only `Envelocity` config with `OrThrow` getters.

## Framework Structure

```
src/
  index.ts              — Public API exports
  core/
    application.ts      — VelocityApplication (HTTP server, registration, request pipeline)
    container.ts        — DI container (parent/child, singleton, constructor injection, cycle detection)
    metadata.ts         — Internal Reflect metadata polyfill (~55 lines, replaces reflect-metadata)
  decorators/
    controller.ts       — @Controller(path)
    route.ts            — @Get, @Post, @Put, @Delete, @Patch
    service.ts          — @Service(name?)
    middleware.ts       — @Middleware, @UseMiddleware
    interceptor.ts      — @Interceptor, @UseInterceptor
    go.ts               — @Go (background Bun Worker threads)
    channel.ts          — @Channel (inject VelocityChannel into @Go methods)
    fn.ts               — @Fn (HTTP function calls at /.name(args))
  channel/
    channel.ts          — VelocityChannel<T> (BroadcastChannel wrapper)
  workers/
    go-runner.ts        — Worker entry point for @Go methods
  orm/
    database.ts         — Database class + DB() factory
    entity-accessor.ts  — EntityAccessor (Prisma-like CRUD)
    connection.ts       — DatabaseConnection (SQLite, PostgreSQL, MySQL) with pooling
    query-builder.ts    — QueryBuilder + InsertBuilder + UpdateBuilder + DeleteBuilder
    decorators.ts       — @Entity, @Column, @PrimaryKey
  middleware/
    cors.ts             — Built-in CORS (no npm cors package)
    rate-limit.ts       — Built-in rate limiting (in-memory, no npm package)
    helmet.ts           — Built-in security headers (no npm helmet package)
  interceptors/
    transform.ts        — TransformInterceptor (wraps response in {data, meta})
  validation/
    validator.ts        — Joi-based validation + @Validate decorator
  logging/
    logger.ts           — Custom zero-dep logger (~65 lines, replaces Winston)
  config/
    config.ts           — Application configuration
    envelocity.ts       — Envelocity runtime (env tree builder, Proxy, OrThrow)
  testing/
    test-utils.ts       — TestUtils: createTestApp, createMockRequest/Response, makeRequest
    decorators.ts       — Test decorator framework: @Suite, @Test, @BeforeEach/All, @AfterEach/All, @Mock
  types/
    index.ts            — All TypeScript interfaces (RegisterOptions, ApplicationConfig, etc.)
    reflect.d.ts        — Type augmentations for internal Reflect polyfill
tests/
  fn.test.ts            — parseFunctionCall + parseFnArgs unit tests (20 cases)
  container.test.ts     — DI container: singleton, transient, injection, circular deps, child containers
  router.test.ts        — Trie router: literals, params, priority, multi-level, method separation, prefix
  middleware.test.ts    — Middleware chain, CORS, RateLimit
  validator.test.ts     — Validator.validate(), preset schemas, @Validate decorator
  query-builder.test.ts — SELECT/WHERE/JOIN/ORDER/LIMIT, INSERT/UPDATE/DELETE, identifier safety
  e2e.test.ts           — Full request lifecycle, auth, interceptors, @Fn, CORS headers, 204/500
```

## Development Workflow

```bash
# Build framework
npm run build

# Sync to node_modules/@velocity/framework (for examples)
npm run sync

# Build + sync in one step
npm run dev

# Run tests
bun test

# Generate DB types for an example
npm run velogen -- examples/full-demo

# Generate env config types
npm run envgen -- examples/full-demo

# Generate API tester UI
npm run apitester -- examples/full-demo

# Run example
npm run demo
```

## Request Pipeline

1. Parse body (JSON or text) for POST/PUT/PATCH — hard 1 MB cap
2. Match route by URL pattern + HTTP method via segment-trie (O(k), k = path depth)
3. Extract URL parameters (`:id` → `params.id`)
4. Execute middlewares in order (abort if `next()` not called)
5. Execute route handler
6. Execute interceptors in order (transform response data)
7. Send response (JSON by default, 204 if no return value)

## Key Design Decisions

| Decision | Rationale |
|---|---|
| No express | Raw `http` module is faster and has zero dependency overhead |
| No Module concept | Unnecessary grouping/scoping for a minimal framework |
| Self-registration | Each file is self-contained; main.ts stays clean |
| Deferred registration | `register()` queues, `listen()` processes — no import-order issues |
| Scoped DI | Child containers for per-controller services, inherits global container |
| Controller nesting | Mount sub-controllers without coupling; path composition at registration |
| Global prefix | Eliminates `/api` repetition; exclusions for health/metrics endpoints |
| DB() factory, not config | Databases are first-class objects, not app config |
| No Repository pattern | Direct `db.Entity.action()` is cleaner than repository classes |
| velogen / envgen | Generates types at dev time, zero runtime cost |
| Built-in CORS/rate-limit/helmet | No npm packages needed — implemented natively |
| Lazy DB init | Connections created at `velo.listen()`, not at import time |
| Bun.serve() adapter | ~3× throughput vs Node path; Bun.file() for static files |
| Segment-trie router | O(k) lookup regardless of route count; literal > param priority |
| Connection pooling | pg.Pool / mysql2 createPool — concurrent query support |
| Custom logger | Replaces Winston (~15 MB) with ~65-line zero-dep implementation |
| Internal Reflect polyfill | Replaces reflect-metadata (~3 MB) with ~55-line WeakMap implementation |
| Graceful shutdown | `close()` drains in-flight requests; SIGTERM/SIGINT auto-registration |
| `@Go` Bun Workers | True OS-level parallelism for background jobs; fallback to setImmediate on Node |
| `@Fn` HTTP functions | RPC-style endpoints at `/.name(args)` — no req/res boilerplate |
| `@Suite/@Test` decorators | Class-based test organization with lifecycle hooks; built on `bun:test` |

## Supported Databases

- **SQLite** (via `bun:sqlite` on Bun, `better-sqlite3` on Node) — in-memory or file
- **PostgreSQL** (via `pg.Pool`) — with `RETURNING` support, connection pooling
- **MySQL** (via `mysql2.createPool`) — promise-based, connection pooling

## Key Implementation Notes

### reflect-metadata polyfill (T-09)
`src/core/metadata.ts` is a 55-line WeakMap-based implementation that patches the global `Reflect` object. TypeScript's compiler (with `emitDecoratorMetadata: true`) only checks `typeof Reflect.metadata === "function"` before emitting `design:paramtypes` and `design:type` calls. The polyfill handles all three methods: `defineMetadata`, `getMetadata`, `metadata`.

**⚠️ Warning for test controllers**: Decorated controller methods should use `any` for request parameter types (not `VelocityRequest`). `VelocityRequest` is a TypeScript interface (erased at runtime), but `emitDecoratorMetadata` tries to capture parameter types as runtime values. Using `any` avoids a Bun runtime error.

### Bun runtime detection
`const IS_BUN = typeof Bun !== 'undefined'` — used to branch between `Bun.serve()` and `http.createServer()` paths.

### Trie router
Built at `listen()` time. Each segment is a `TrieNode` with a `children: Map<string, TrieNode>` (literals) and a single `paramChild: { name, node }` (`:param`). Literal matches always beat param matches at the same depth. A single param name is reused per segment level — if two routes have different param names at the same depth, the first registered wins with a warning.

### Test infrastructure
`VelocityApplication.prepareForTesting()` initializes registrations and builds the trie without starting a server. `TestUtils.makeRequest()` calls it automatically. `createMockRequest` always sets `__bunNativeRequest` to force the Bun `parseBody` code path — without it, POST requests would hang waiting for stream events that mock objects never emit.

## Entry Point Convention

```
main.ts   — imports everything, calls velo.listen()
velo.ts   — creates and exports VelocityApplication instance
db.ts     — creates and exports DB instance(s)
```
