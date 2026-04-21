# Velocity Framework

A minimal, fast, type-safe TypeScript framework for Node.js with decorators, built-in ORM, and zero bloat.

## Features

- **Decorator-based** routing (`@Get`, `@Post`, `@Put`, `@Delete`, `@Patch`)
- **Self-registration** — controllers, services, entities register themselves
- **Built-in ORM** — Prisma-like `db.User.findAll()` with SQLite, PostgreSQL, MySQL
- **Type generation** — `velogen` generates types for DB instances, no `any` casts
- **Dependency injection** — constructor-based DI with singleton support
- **Validation** — Joi schemas with `@Validate` decorator
- **Middleware & interceptors** — function or class-based, per-route
- **Security** — built-in CORS, rate limiting, security headers (no npm packages)
- **Logging** — structured Winston-based logging
- **Zero bloat** — uses Node's `http` module directly, no express

## Scripts & Tools

| Command | Description |
|---|---|
| `npm run build` | Compile framework (`src/` → `dist/`) |
| `npm run sync` | Symlink `dist/` into `node_modules/@velocity/framework` |
| `npm run dev` | Build + sync in one step |
| `npm run velogen -- <dir>` | Generate typed DB interfaces for a project directory |
| `npx ts-node <file>` | Run a TypeScript file directly |

### Development workflow

```bash
# Install dependencies
npm install

# Build the framework and make it available as @velocity/framework
npm run dev

# Generate DB types for the example
npm run velogen -- examples/full-demo

# Run the example
npx ts-node examples/full-demo/main.ts
```

After modifying framework source, re-run `npm run dev` to rebuild and sync.

### velogen — Type Generator

`velogen` scans `*.entity.ts` files, finds `db.register(Entity)` calls, and generates a `generated/velocity-types.d.ts` with typed interfaces for each DB instance.

```bash
npm run velogen -- examples/full-demo
```

Then in your `db.ts`:

```typescript
import { DB } from '@velocity/framework';
import type { TypedDb } from './generated/velocity-types';

export const db = DB({ type: 'sqlite', database: ':memory:', filename: ':memory:' }) as TypedDb;
```

Now `db.User` and `db.Post` are fully typed. Re-run velogen whenever you add or remove entities.

## Quick Start

### 1. App instance (`app.ts`)

```typescript
import { VelocityApplication } from '@velocity/framework';

export const app = new VelocityApplication({
  port: 5000,
  logger: { level: 'info', format: 'combined', outputs: ['console'] },
  cors: { origin: '*', credentials: false },
  rateLimit: { windowMs: 15 * 60 * 1000, max: 100 }
});
```

### 2. Database (`db.ts`)

```typescript
import { DB } from '@velocity/framework';
import type { TypedDb } from './generated/velocity-types';

export const db = DB({
  type: 'sqlite',
  database: ':memory:',
  filename: ':memory:'
}) as TypedDb;
```

Multi-database support:

```typescript
export const mainDb = DB({ type: 'postgresql', host: 'localhost', database: 'app', username: 'user', password: 'pass' });
export const cacheDb = DB('cache', { type: 'sqlite', database: ':memory:', filename: ':memory:' });
```

### 3. Entity (`entities/user.entity.ts`)

```typescript
import { Entity, Column, PrimaryKey } from '@velocity/framework';
import { db } from '../db';

@Entity('users')
export class User {
  @PrimaryKey() id: number;
  @Column() name: string;
  @Column({ unique: true }) email: string;
  @Column({ nullable: true }) age?: number;
  @Column() createdAt: string;

  constructor() {
    this.id = 0;
    this.name = '';
    this.email = '';
    this.createdAt = new Date().toISOString();
  }
}

db.register(User);
```

### 4. Controller (`controllers/user.controller.ts`)

```typescript
import {
  Controller, Get, Post as HttpPost, Delete,
  UseMiddleware, Validate, Validator,
  VelocityRequest, VelocityResponse, MiddlewareFunction,
} from '@velocity/framework';
import { db } from '../db';
import { app } from '../app';
import * as Joi from 'joi';

const authMiddleware: MiddlewareFunction = (req, res, next) => {
  if (!req.headers['authorization']) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
};

const createUserSchema = Validator.createSchema({
  name: Joi.string().required(),
  email: Joi.string().email().required(),
  age: Joi.number().integer().min(1).max(120).optional()
});

@Controller('/api/users')
class UserController {
  @Get('/')
  async list(_req: VelocityRequest, _res: VelocityResponse) {
    return { users: await db.User.findAll() };
  }

  @HttpPost('/')
  @UseMiddleware(authMiddleware)
  @Validate(createUserSchema)
  async create(req: VelocityRequest, res: VelocityResponse) {
    const user = await db.User.create({ ...req.body, createdAt: new Date().toISOString() });
    return res.status(201).json({ user });
  }

  @Delete('/:id')
  @UseMiddleware(authMiddleware)
  async remove(req: VelocityRequest, res: VelocityResponse) {
    await db.User.delete(parseInt(req.params!.id));
    return res.status(204).send('');
  }
}

app.register(UserController);
```

### 5. Entry point (`main.ts`)

```typescript
import { app } from './app';
import './entities/user.entity';
import './controllers/user.controller';

async function main() {
  await app.listen();
}

main().catch(console.error);
```

## ORM — Entity Accessor API

After `db.register(Entity)` and `app.listen()`, each entity is accessible as `db.EntityName`:

```typescript
// Read
await db.User.findAll();
await db.User.findById(1);
await db.User.findOne({ email: 'alice@example.com' });
await db.User.findMany({ age: 25 });
await db.User.count({ age: 25 });

// Write
await db.User.create({ name: 'Alice', email: 'alice@example.com' });
await db.User.update(1, { name: 'Bob' });
await db.User.delete(1);
await db.User.deleteWhere({ age: 0 });

// Raw query builder
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
  index.ts              — Public API exports
  core/
    application.ts      — HTTP server, registration, request pipeline
    container.ts        — DI container
  decorators/           — @Controller, @Get/@Post/..., @Service, @UseMiddleware, @UseInterceptor
  orm/
    database.ts         — Database class + DB() factory
    entity-accessor.ts  — Prisma-like CRUD (findAll, create, update, delete, ...)
    connection.ts       — Multi-DB connection (SQLite, PostgreSQL, MySQL)
    query-builder.ts    — SQL query builder
    decorators.ts       — @Entity, @Column, @PrimaryKey
  middleware/            — Built-in CORS, rate limiting, security headers
  interceptors/         — TransformInterceptor (response wrapping)
  validation/           — Joi-based validation + @Validate decorator
  logging/              — Winston-based structured logging
  config/               — Application configuration
  testing/              — Test utilities
scripts/
  sync.js               — Symlinks dist/ to node_modules/@velocity/framework
  velogen.js            — Type generator for DB instances
examples/
  full-demo/            — Complete example with all features
```
