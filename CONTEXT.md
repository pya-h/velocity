# Velocity Framework — Project Context

## Philosophy

Velocity is a **minimal, fast, type-safe TypeScript framework** for Node.js. Every design decision optimizes for:

1. **Minimal** — Zero bloat. No express, no heavy ORM, no unused abstractions. The framework uses Node's built-in `http` module directly.
2. **Fast** — Minimal overhead in the request pipeline. No unnecessary middleware chains, no framework-level parsing beyond what's needed.
3. **Memory-efficient** — No global registries beyond what's required. Lazy initialization (DB connections created only at `app.listen()`).
4. **Type-safe** — First-class TypeScript. `velogen` generates types for DB instances so entity access is fully typed. We stay away from `any` as much as possible.

## Architecture — Core Design Patterns

### No Modules

There is no Module/grouping concept. Controllers, services, and interceptors register directly on the app. Developers organize their code however they want — the framework doesn't enforce directory structure or module boundaries.

### Self-Registration

Every component registers itself at the bottom of its own file:

```typescript
// user.controller.ts
@Controller('/api/users')
class UserController { ... }
app.register(UserController);
```

The main entry point (`main.ts`) only imports these files — it doesn't manually register anything. Each file is self-contained.

**Why**: Reduces boilerplate in the entry point. Adding a new controller means creating one file, not editing two.

**Circular dependency avoidance**: The app instance lives in a separate `app.ts` file, not in `main.ts`. Controllers import from `app.ts`, and `main.ts` imports controllers. No cycles.

### Prisma-like ORM (no Repository pattern)

Database access uses a direct entity accessor pattern:

```typescript
const users = await db.User.findAll();
const post = await db.Post.create({ title: 'Hello', ... });
```

There is **no Repository layer**. The `EntityAccessor` class provides `findAll`, `findById`, `findOne`, `findMany`, `create`, `update`, `delete`, `deleteWhere`, `count`, and `query()`.

Entities self-register on a DB instance:

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

`DB()` auto-registers on the current `VelocityApplication`. Multi-DB is supported:

```typescript
export const mainDb = DB({ type: 'postgresql', ... });
export const cacheDb = DB('cache', { type: 'sqlite', ... });
```

### Type Generation (velogen)

`velogen` generates TypeScript types for DB instances based on registered entities:

```bash
npm run velogen -- examples/full-demo
```

This scans `*.entity.ts` files, finds `db.register(Entity)` calls, and generates a `generated/velocity-types.d.ts` with typed interfaces. The DB export uses this type:

```typescript
import type { TypedDb } from './generated/velocity-types';
export const db = DB({ ... }) as TypedDb;
```

After velogen, `db.User` and `db.Post` are fully typed — no `as any` needed.

**Re-run velogen** whenever you add/remove entities.

## Framework Structure

```
src/
  index.ts              — Public API exports
  core/
    application.ts      — VelocityApplication (HTTP server, registration, request pipeline)
    container.ts        — DI container (singleton, constructor injection, cycle detection)
  decorators/
    controller.ts       — @Controller(path)
    route.ts            — @Get, @Post, @Put, @Delete, @Patch
    service.ts          — @Service(name?)
    middleware.ts        — @Middleware, @UseMiddleware
    interceptor.ts      — @Interceptor, @UseInterceptor
  orm/
    database.ts         — Database class + DB() factory
    entity-accessor.ts  — EntityAccessor (Prisma-like CRUD)
    connection.ts       — DatabaseConnection (SQLite, PostgreSQL, MySQL)
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
    logger.ts           — Winston-based structured logging
  config/
    config.ts           — Application configuration
  testing/
    test-utils.ts       — Test app creation, mock request/response
  types/
    index.ts            — All TypeScript interfaces
```

## Development Workflow

```bash
# Build framework
npm run build

# Sync to node_modules/@velocity/framework (for examples)
npm run sync

# Build + sync in one step
npm run dev

# Generate DB types for an example
npm run velogen -- examples/full-demo

# Run example
npx ts-node examples/full-demo/main.ts
```

The `npm run sync` script creates a symlink from `node_modules/@velocity/framework` to `dist/`. Once published to npm, the sync script is no longer needed.

## Request Pipeline

1. Parse body (JSON or text) for POST/PUT/PATCH
2. Match route by URL pattern + HTTP method
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
| DB() factory, not config | Databases are first-class objects, not app config |
| No Repository pattern | Direct `db.Entity.action()` is cleaner than repository classes |
| velogen for types | Generates types at dev time, zero runtime cost |
| Built-in CORS/rate-limit/helmet | No npm packages needed — implemented natively |
| Lazy DB init | Connections created at `app.listen()`, not at import time |

## Supported Databases

- **SQLite** (via `better-sqlite3`) — synchronous, in-memory or file
- **PostgreSQL** (via `pg`) — with `RETURNING` support
- **MySQL** (via `mysql2`) — promise-based

The `DatabaseConnection` class normalizes differences (parameter placeholders, insert IDs, type mappings).

## Entry Point Convention

The entry file is always named `main.ts`. The app instance lives in a separate `app.ts` to avoid circular imports:

```
main.ts   — imports everything, calls app.listen(), seeds data
app.ts    — creates and exports VelocityApplication instance
db.ts     — creates and exports DB instance(s)
```
