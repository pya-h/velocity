import { DatabaseConnection } from './connection';
import { EntityAccessor } from './entity-accessor';
import { DatabaseConfig, EntityMetadata } from '../types';

const ENTITY_METADATA_KEY = Symbol.for('entity');

const _pendingDatabases: Database[] = [];
let _currentApp: any = null;

export function _setCurrentApp(app: any): void {
  _currentApp = app;
  for (const db of _pendingDatabases) {
    app.registerDatabase(db);
  }
  _pendingDatabases.length = 0;
}

interface RegisteredEntity {
  entityClass: any;
  metadata: EntityMetadata;
  accessor: EntityAccessor;
}

export class Database {
  readonly name: string;
  private config: DatabaseConfig;
  private connection!: DatabaseConnection;
  private entities = new Map<string, RegisteredEntity>();
  private _initialized = false;

  constructor(name: string, config: DatabaseConfig) {
    this.name = name;
    this.config = config;
  }

  /**
   * Register one or more entity classes on this database.
   * Each entity must be decorated with @Entity().
   * After initialization, entities are accessible as db.ClassName.
   *
   * @example
   *   db.register(User);
   *   db.register(User, Post, Comment);
   */
  register(...entityClasses: any[]): this {
    for (const entityClass of entityClasses) {
      const metadata: EntityMetadata = Reflect.getMetadata(ENTITY_METADATA_KEY, entityClass);
      if (!metadata) {
        throw new Error(`${entityClass.name} is not decorated with @Entity()`);
      }

      const accessorName = entityClass.name;
      const accessor = new EntityAccessor(metadata);

      this.entities.set(accessorName, { entityClass, metadata, accessor });

          (this as any)[accessorName] = accessor;
    }

    return this;
  }

  /** Connect to the database and create tables for all registered entities */
  async initialize(): Promise<void> {
    if (this._initialized) return;

    this.connection = new DatabaseConnection(this.config);
    await this.connection.connect();

    for (const [, entity] of this.entities) {
      entity.accessor._setConnection(this.connection);
      await entity.accessor.createTable();
    }

    this._initialized = true;
  }

  get initialized(): boolean { return this._initialized; }

  getConnection(): DatabaseConnection { return this.connection; }

  getConfig(): DatabaseConfig { return this.config; }

  getEntity<T = any>(name: string): EntityAccessor<T> | undefined {
    return this.entities.get(name)?.accessor as EntityAccessor<T> | undefined;
  }

  getEntityNames(): string[] {
    return Array.from(this.entities.keys());
  }

  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.close();
    }
  }
}

/**
 * Create a database instance.
 *
 * @example
 *   // Single (default) database
 *   export const db = DB({ type: 'sqlite', database: ':memory:' });
 *
 *   // Named database for multi-DB setups
 *   export const db1 = DB('analytics', { type: 'postgresql', ... });
 *   export const db2 = DB('cache', { type: 'sqlite', ... });
 *
 * The database auto-registers on the current VelocityApplication.
 * Entities register on it: db.register(User).register(Post);
 * After app.listen(), access data: db.User.findAll(), db.Post.create({...})
 */
export function DB(nameOrConfig: string | DatabaseConfig, config?: DatabaseConfig): Database {
  let dbName: string;
  let dbConfig: DatabaseConfig;

  if (typeof nameOrConfig === 'string') {
    dbName = nameOrConfig;
    dbConfig = config!;
  } else {
    dbName = 'default';
    dbConfig = nameOrConfig;
  }

  const database = new Database(dbName, dbConfig);

  if (_currentApp && typeof _currentApp.registerDatabase === 'function') {
    _currentApp.registerDatabase(database);
  } else {
    _pendingDatabases.push(database);
  }

  return database;
}
