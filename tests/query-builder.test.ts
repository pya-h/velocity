import '../src/core/metadata';
import { describe, test, expect, beforeEach } from 'bun:test';
import { QueryBuilder } from '../src/orm/query-builder';
import { DatabaseConnection } from '../src/orm/connection';

// ─── Minimal fake connection — captures the last SQL/params executed ─────────

function makeFakeConn(type: 'postgresql' | 'mysql' | 'sqlite' = 'postgresql') {
  let lastSql    = '';
  let lastParams: any[] = [];

  const conn = {
    query:   async (sql: string, params: any[] = []) => { lastSql = sql; lastParams = params; return []; },
    execute: async (sql: string, params: any[] = []) => { lastSql = sql; lastParams = params; return { id: 1 }; },
    getType: () => type,
    close:   async () => {},
    getSql:    () => lastSql,
    getParams: () => lastParams,
  };

  return conn as unknown as DatabaseConnection & { getSql(): string; getParams(): any[] };
}

// ─── SELECT ──────────────────────────────────────────────────────────────────

describe('QueryBuilder — SELECT', () => {
  let conn: ReturnType<typeof makeFakeConn>;

  beforeEach(() => { conn = makeFakeConn(); });

  test('select * from table', async () => {
    await new QueryBuilder(conn).from('users').execute();
    expect(conn.getSql()).toBe('SELECT * FROM "users"');
  });

  test('select specific fields', async () => {
    await new QueryBuilder(conn).select(['name', 'email']).from('users').execute();
    expect(conn.getSql()).toBe('SELECT "name", "email" FROM "users"');
  });

  test('select single field as string', async () => {
    await new QueryBuilder(conn).select('name').from('users').execute();
    expect(conn.getSql()).toBe('SELECT "name" FROM "users"');
  });

  test('select * wildcard is not quoted', async () => {
    await new QueryBuilder(conn).select('*').from('users').execute();
    expect(conn.getSql()).toBe('SELECT * FROM "users"');
  });

  test('WHERE clause appends condition', async () => {
    await new QueryBuilder(conn).from('users').where('age > ?', 18).execute();
    expect(conn.getSql()).toContain('WHERE age > ?');
    expect(conn.getParams()).toEqual([18]);
  });

  test('multiple WHERE clauses joined with AND', async () => {
    await new QueryBuilder(conn).from('users')
      .where('age > ?', 18)
      .where('active = ?', true)
      .execute();
    expect(conn.getSql()).toContain('WHERE age > ? AND active = ?');
    expect(conn.getParams()).toEqual([18, true]);
  });

  test('ORDER BY single field ASC', async () => {
    await new QueryBuilder(conn).from('users').orderBy('name').execute();
    expect(conn.getSql()).toContain('ORDER BY "name" ASC');
  });

  test('ORDER BY DESC', async () => {
    await new QueryBuilder(conn).from('users').orderBy('created_at', 'DESC').execute();
    expect(conn.getSql()).toContain('ORDER BY "created_at" DESC');
  });

  test('LIMIT appended', async () => {
    await new QueryBuilder(conn).from('users').limit(10).execute();
    expect(conn.getSql()).toContain('LIMIT 10');
  });

  test('OFFSET appended', async () => {
    await new QueryBuilder(conn).from('users').offset(5).execute();
    expect(conn.getSql()).toContain('OFFSET 5');
  });

  test('first() adds LIMIT 1 and returns first result', async () => {
    const qb = new QueryBuilder(conn).from('users');
    // Override query to return a known row
    (conn as any).query = async (sql: string) => {
      (conn as any)._sql = sql;
      return [{ id: 1, name: 'Alice' }];
    };
    const row = await new QueryBuilder(conn as any).from('users').first();
    expect(row).toEqual({ id: 1, name: 'Alice' });
  });

  test('LEFT JOIN clause', async () => {
    await new QueryBuilder(conn).from('users').leftJoin('posts', 'users.id = posts.user_id').execute();
    expect(conn.getSql()).toContain('LEFT JOIN "posts" ON users.id = posts.user_id');
  });

  test('INNER JOIN clause', async () => {
    await new QueryBuilder(conn).from('users').join('orders', 'users.id = orders.user_id').execute();
    expect(conn.getSql()).toContain('JOIN "orders" ON users.id = orders.user_id');
  });
});

// ─── INSERT ──────────────────────────────────────────────────────────────────

describe('QueryBuilder — INSERT', () => {
  let conn: ReturnType<typeof makeFakeConn>;

  beforeEach(() => { conn = makeFakeConn(); });

  test('basic insert', async () => {
    await QueryBuilder.insert(conn).into('users').values({ name: 'Alice', age: 30 }).execute();
    expect(conn.getSql()).toContain('INSERT INTO "users"');
    expect(conn.getSql()).toContain('"name"');
    expect(conn.getSql()).toContain('"age"');
    expect(conn.getParams()).toEqual(['Alice', 30]);
  });

  test('RETURNING clause on postgresql', async () => {
    await QueryBuilder.insert(conn).into('users').values({ name: 'Bob' }).returning('id').execute();
    expect(conn.getSql()).toContain('RETURNING "id"');
  });

  test('no RETURNING clause on mysql', async () => {
    const mysqlConn = makeFakeConn('mysql');
    await QueryBuilder.insert(mysqlConn).into('users').values({ name: 'Carol' }).returning('id').execute();
    expect(mysqlConn.getSql()).not.toContain('RETURNING');
  });
});

// ─── UPDATE ──────────────────────────────────────────────────────────────────

describe('QueryBuilder — UPDATE', () => {
  let conn: ReturnType<typeof makeFakeConn>;

  beforeEach(() => { conn = makeFakeConn(); });

  test('basic update with WHERE', async () => {
    await QueryBuilder.update(conn).setTable('users').set({ name: 'Dave' }).where('id = ?', 1).execute();
    expect(conn.getSql()).toContain('UPDATE "users" SET "name" = ?');
    expect(conn.getSql()).toContain('WHERE id = ?');
    expect(conn.getParams()).toEqual(['Dave', 1]);
  });
});

// ─── DELETE ──────────────────────────────────────────────────────────────────

describe('QueryBuilder — DELETE', () => {
  let conn: ReturnType<typeof makeFakeConn>;

  beforeEach(() => { conn = makeFakeConn(); });

  test('delete with WHERE', async () => {
    await QueryBuilder.delete(conn).from('users').where('id = ?', 5).execute();
    expect(conn.getSql()).toContain('DELETE FROM "users"');
    expect(conn.getSql()).toContain('WHERE id = ?');
    expect(conn.getParams()).toEqual([5]);
  });

  test('delete without WHERE (truncate-style)', async () => {
    await QueryBuilder.delete(conn).from('sessions').execute();
    expect(conn.getSql()).toBe('DELETE FROM "sessions"');
  });
});

// ─── Identifier validation ───────────────────────────────────────────────────

describe('QueryBuilder — SQL identifier safety', () => {
  test('invalid table name throws', () => {
    const conn = makeFakeConn();
    expect(() => new QueryBuilder(conn).from('users; DROP TABLE users--').execute()).toThrow(/Invalid SQL identifier/);
  });

  test('invalid field name throws', () => {
    const conn = makeFakeConn();
    expect(() => new QueryBuilder(conn).select(["name'; DROP TABLE users--"]).from('users').execute()).toThrow(/Invalid SQL identifier/);
  });
});
