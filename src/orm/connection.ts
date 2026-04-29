import { DatabaseConfig } from '../types';

/**
 * Interface for custom database drivers.
 * Implement this to add support for databases beyond SQLite/PostgreSQL/MySQL.
 *
 * Each method receives the raw connection created by `connect()`:
 *   - query: SELECT — must return an array of row objects
 *   - execute: INSERT/UPDATE/DELETE — return value is driver-specific
 *   - close: cleanup the connection
 */
export interface DatabaseDriver {
  connect(config: DatabaseConfig): Promise<unknown>;
  query(connection: unknown, sql: string, params: unknown[]): Promise<unknown[]>;
  execute(connection: unknown, sql: string, params: unknown[]): Promise<unknown>;
  close(connection: unknown): Promise<void>;
}

// ─── Driver registry ─────────────────────────────────────────────────────────

const drivers = new Map<string, DatabaseDriver>();

/**
 * Register a custom database driver.
 *
 * @example
 * ```typescript
 * import { registerDriver } from '@velocity/framework';
 *
 * registerDriver('cockroachdb', {
 *   async connect(config) { ... },
 *   async query(conn, sql, params) { ... },
 *   async execute(conn, sql, params) { ... },
 *   async close(conn) { ... },
 * });
 *
 * const db = DB({ type: 'cockroachdb', host: '...', database: '...' });
 * ```
 */
export function registerDriver(name: string, driver: DatabaseDriver): void {
  drivers.set(name, driver);
}

// ─── Built-in drivers (registered lazily — import only when used) ────────────

function toPgParams(sql: string): string {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

const sqliteDriver: DatabaseDriver = {
  async connect(config) {
    const { Database } = await import('bun:sqlite');
    return new Database(config.filename || ':memory:');
  },
  async query(conn: any, sql, params) {
    return conn.prepare(sql).all(...params);
  },
  async execute(conn: any, sql, params) {
    return conn.prepare(sql).run(...params);
  },
  async close(conn: any) {
    conn.close();
  },
};

const pgDriver: DatabaseDriver = {
  async connect(config) {
    const { Pool: PgPool } = await import('pg');
    return new PgPool({
      host: config.host || process.env.PGHOST || 'localhost',
      port: config.port || parseInt(process.env.PGPORT || '5432'),
      database: config.database || process.env.PGDATABASE || 'postgres',
      user: config.username || process.env.PGUSER || 'postgres',
      password: config.password || process.env.PGPASSWORD || '',
      min: config.pool?.min ?? 2,
      max: config.pool?.max ?? 10,
    });
  },
  async query(conn: any, sql, params) {
    const result = await conn.query(toPgParams(sql), params);
    return result.rows;
  },
  async execute(conn: any, sql, params) {
    return await conn.query(toPgParams(sql), params);
  },
  async close(conn: any) {
    await conn.end();
  },
};

const mysqlDriver: DatabaseDriver = {
  async connect(config) {
    const mysql = await import('mysql2/promise');
    return mysql.createPool({
      host: config.host || 'localhost',
      port: config.port || 3306,
      database: config.database,
      user: config.username || 'root',
      password: config.password || '',
      connectionLimit: config.pool?.max ?? 10,
      waitForConnections: true,
    });
  },
  async query(conn: any, sql, params) {
    const [rows] = await conn.execute(sql, params);
    return rows as unknown[];
  },
  async execute(conn: any, sql, params) {
    return await conn.execute(sql, params);
  },
  async close(conn: any) {
    await conn.end();
  },
};

// Register built-in drivers
drivers.set('sqlite', sqliteDriver);
drivers.set('postgresql', pgDriver);
drivers.set('mysql', mysqlDriver);

// ─── DatabaseConnection ──────────────────────────────────────────────────────

export class DatabaseConnection {
  private connection: unknown;
  private driver: DatabaseDriver;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = config;
    const driver = drivers.get(config.type);
    if (!driver) {
      throw new Error(
        `Unsupported database type: "${config.type}". ` +
        `Available: ${[...drivers.keys()].join(', ')}. ` +
        `Use registerDriver('${config.type}', driver) to add support.`
      );
    }
    this.driver = driver;
  }

  public async connect(): Promise<void> {
    this.connection = await this.driver.connect(this.config);
  }

  public async query(sql: string, params: unknown[] = []): Promise<unknown[]> {
    return this.driver.query(this.connection, sql, params);
  }

  public async execute(sql: string, params: unknown[] = []): Promise<unknown> {
    return this.driver.execute(this.connection, sql, params);
  }

  public async close(): Promise<void> {
    if (this.connection) {
      await this.driver.close(this.connection);
    }
  }

  public getConnection(): unknown {
    return this.connection;
  }

  public getType(): string {
    return this.config.type;
  }
}
