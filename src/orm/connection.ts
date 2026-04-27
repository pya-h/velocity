import { DatabaseConfig } from '../types';
import { Database } from 'bun:sqlite';
import { Client as PgClient } from 'pg';
import mysql from 'mysql2/promise';

export class DatabaseConnection {
  private connection: any;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  // Convert ? placeholders to $1, $2, ... for PostgreSQL
  private toPgParams(sql: string): string {
    let idx = 0;
    return sql.replace(/\?/g, () => `$${++idx}`);
  }

  public async connect(): Promise<void> {
    switch (this.config.type) {
      case 'sqlite':
        this.connection = new Database(this.config.filename || ':memory:');
        break;
      
      case 'postgresql':
        this.connection = new PgClient({
          host: this.config.host || process.env.PGHOST || 'localhost',
          port: this.config.port || parseInt(process.env.PGPORT || '5432'),
          database: this.config.database || process.env.PGDATABASE || 'postgres',
          user: this.config.username || process.env.PGUSER || 'postgres',
          password: this.config.password || process.env.PGPASSWORD || ''
        });
        await this.connection.connect();
        break;
      
      case 'mysql':
        this.connection = await mysql.createConnection({
          host: this.config.host || 'localhost',
          port: this.config.port || 3306,
          database: this.config.database,
          user: this.config.username || 'root',
          password: this.config.password || ''
        });
        break;
      
      default:
        throw new Error(`Unsupported database type: ${this.config.type}`);
    }
  }

  public async query(sql: string, params: any[] = []): Promise<any[]> {
    switch (this.config.type) {
      case 'sqlite':
        const stmt = this.connection.prepare(sql);
        return stmt.all(...params);
      
      case 'postgresql':
        const result = await this.connection.query(this.toPgParams(sql), params);
        return result.rows;
      
      case 'mysql':
        const [rows] = await this.connection.execute(sql, params);
        return rows as any[];
      
      default:
        throw new Error(`Unsupported database type: ${this.config.type}`);
    }
  }

  public async execute(sql: string, params: any[] = []): Promise<any> {
    switch (this.config.type) {
      case 'sqlite':
        const stmt = this.connection.prepare(sql);
        return stmt.run(...params);
      
      case 'postgresql':
        return await this.connection.query(this.toPgParams(sql), params);
      
      case 'mysql':
        return await this.connection.execute(sql, params);
      
      default:
        throw new Error(`Unsupported database type: ${this.config.type}`);
    }
  }

  public async close(): Promise<void> {
    if (this.connection) {
      switch (this.config.type) {
        case 'sqlite':
          this.connection.close();
          break;
        case 'postgresql':
          await this.connection.end();
          break;
        case 'mysql':
          await this.connection.end();
          break;
      }
    }
  }

  public getConnection(): any {
    return this.connection;
  }

  public getType(): string {
    return this.config.type;
  }
}
