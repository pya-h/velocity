# Velocity Framework

A minimal, fast, type-safe TypeScript framework for Node.js with decorators, built-in ORM, and zero bloat.

## Features

- **Decorator-based** routing (`@Get`, `@Post`, `@Put`, `@Delete`, `@Patch`)
- **Self-registration** — controllers, services, entities register themselves
- **Variadic register** — `velo.register(A, B, C, options?)` with scoping
- **Scoped DI** — services can be scoped to specific controllers
- **Controller nesting** — mount controllers under other controllers as sub-routes
- **Global prefix** — prefix all endpoints (e.g. `/api`) with exclusions
- **Built-in ORM** — Prisma-like `db.User.findAll()` with SQLite, PostgreSQL, MySQL
- **Static file serving** — `velo.serve()` and `velo.static()` for files and directories
- **Type generation** — `velogen` generates types for DB instances, no `any` casts
- **Envelocity** — typed, read-only `.env` wrapper with `OrThrow` getters
- **API Tester** — auto-generated testing UI from controller metadata
- **Dependency injection** — constructor-based DI with singleton support and child containers
- **Validation** — Joi schemas with `@Validate` decorator
- **Middleware & interceptors** — function or class-based, per-route or per-registration
- **CORS** — built-in CORS with config-based origin, methods, credentials
- **Logging** — structured Winston-based logging
- **Zero bloat** — uses Node's `http` module directly, no express

## Scripts & Tools

| Command | Description |
|---|---|
| `npm run build` | Compile framework (`src/` → `dist/`) |
| `npm run sync` | Symlink `dist/` into `node_modules/@velocity/framework` |
| `npm run dev` | Build + sync in one step |
| `npm run demo` | Run the full-demo example |
| `npm run velogen -- <dir>` | Generate typed DB interfaces from entity files |
| `npm run envgen -- <dir>` | Generate typed env config from `.env` file |
| `npm run apitester -- <dir>` | Generate interactive API testing UI from controllers |

### Development Workflow

```bash
npm install
npm run dev                            # Build + symlink

# Code generation (run after adding entities, env vars, or controllers)
npm run velogen -- examples/full-demo  # DB types
npm run envgen -- examples/full-demo   # Env config types
npm run apitester -- examples/full-demo # API tester UI

# Run the demo
npm run demo                           # → http://localhost:5000
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
});
```

### 2. Database (`db.ts`)

```typescript
import { DB } from '@velocity/framework';
import type { TypedDb } from './velo/velocity-types';

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
import { Controller, Get, Post as HttpPost, UseMiddleware, Validate, Validator,
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
  @UseMiddleware(auth)
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

### velogen — DB Type Generator

Scans `*.entity.ts` files and generates `velo/velocity-types.d.ts` with typed interfaces.

```bash
npm run velogen -- examples/full-demo
```

### envgen — Envelocity Config Generator

Reads `.env`, generates typed read-only config with `OrThrow` getters.

```bash
npm run envgen -- examples/full-demo
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

### apitester — API Testing UI Generator

Scans controllers, extracts routes/validation/auth, generates an interactive HTML tester.

```bash
npm run apitester -- examples/full-demo
```

Features:
- All endpoints auto-discovered from `@Controller`/`@Get`/`@Post` decorators
- Sample request bodies pre-filled from Joi validation schemas
- Auth token management (persistent, auto-enabled for protected endpoints)
- Response time, status, body size per request
- Performance log with min/max/avg stats
- Light/dark theme (persistent)
- Keyboard shortcut: `Ctrl+Enter` to send

## Static File Serving

```typescript
// Serve a single file at a URL
velo.serve('/docs', path.join(__dirname, 'public/docs.html'));

// Serve a directory under a prefix
velo.static('/assets/', path.join(__dirname, 'public/assets'));
```

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
  middleware?: MiddlewareFunction[];  // Additional middleware
}
```

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

## Supported Databases

| Database | Driver | Config `type` |
|---|---|---|
| SQLite | `better-sqlite3` | `'sqlite'` |
| PostgreSQL | `pg` | `'postgresql'` |
| MySQL | `mysql2` | `'mysql'` |

## Project Structure

```
src/
  core/application.ts    — HTTP server, registration, static serving, request pipeline
  core/container.ts      — DI container (parent/child, singleton, cycle detection)
  config/envelocity.ts   — Envelocity runtime (env tree builder, Proxy, OrThrow)
  decorators/            — @Controller, @Get/@Post, @Service, @UseMiddleware, @UseInterceptor
  orm/                   — Database, EntityAccessor, QueryBuilder, Connection, decorators
  middleware/            — CORS, rate limiting, security headers
  validation/            — Joi-based validation + @Validate
  logging/               — Winston-based structured logging
scripts/
  sync.js                — Symlinks dist/ to node_modules/@velocity/framework
  velogen.js             — DB type generator
  envgen.js              — Envelocity config generator
  apitester.js           — API tester UI generator
examples/
  full-demo/             — Complete example with all features
    velo.ts, db.ts, main.ts
    src/controllers/, src/entities/, src/services/
    velo/                — Generated files (types, envelocity, apitester)
    public/              — Static HTML
```
