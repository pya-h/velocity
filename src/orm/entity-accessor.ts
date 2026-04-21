import { DatabaseConnection } from './connection';
import { QueryBuilder } from './query-builder';
import { EntityMetadata } from '../types';

/**
 * Prisma-like entity accessor — provides direct data access methods
 * on a per-entity basis. Created automatically when entities register
 * on a Database instance.
 *
 * Usage:  db.User.findAll(), db.User.create({ name: 'Alice' }), etc.
 */
export class EntityAccessor<T = any> {
  private connection!: DatabaseConnection;
  private metadata: EntityMetadata;
  private initialized = false;

  constructor(metadata: EntityMetadata) {
    this.metadata = metadata;
  }

  /** Called internally by Database.initialize() once the connection is live */
  _setConnection(connection: DatabaseConnection): void {
    this.connection = connection;
    this.initialized = true;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        `Database not initialized. Call app.listen() or db.initialize() before querying "${this.metadata.tableName}".`
      );
    }
  }

  // --------------- Read ---------------

  async findAll(): Promise<T[]> {
    this.ensureInitialized();
    return new QueryBuilder(this.connection)
      .select('*')
      .from(this.metadata.tableName)
      .execute();
  }

  async findById(id: any): Promise<T | null> {
    this.ensureInitialized();
    this.requirePrimaryKey();
    return new QueryBuilder(this.connection)
      .select('*')
      .from(this.metadata.tableName)
      .where(`${this.metadata.primaryKey} = ?`, id)
      .first();
  }

  async findOne(conditions: Partial<T>): Promise<T | null> {
    this.ensureInitialized();
    let qb = new QueryBuilder(this.connection)
      .select('*')
      .from(this.metadata.tableName);

    for (const [key, value] of Object.entries(conditions)) {
      qb = qb.where(`${key} = ?`, value);
    }
    return qb.first();
  }

  async findMany(conditions: Partial<T> = {}): Promise<T[]> {
    this.ensureInitialized();
    let qb = new QueryBuilder(this.connection)
      .select('*')
      .from(this.metadata.tableName);

    for (const [key, value] of Object.entries(conditions)) {
      qb = qb.where(`${key} = ?`, value);
    }
    return qb.execute();
  }

  // --------------- Write ---------------

  async create(data: Partial<T>): Promise<T> {
    this.ensureInitialized();
    const insertBuilder = QueryBuilder.insert(this.connection);
    let builder = insertBuilder
      .into(this.metadata.tableName)
      .values(data as Record<string, any>);

    if (this.metadata.primaryKey && this.connection.getType() === 'postgresql') {
      builder = builder.returning(this.metadata.primaryKey);
    }

    const result = await builder.execute();

    // Resolve inserted ID across DB engines
    let insertedId: any;
    if (this.connection.getType() === 'postgresql' && result.rows?.length > 0) {
      insertedId = result.rows[0][this.metadata.primaryKey!];
    } else if (result.lastInsertRowid !== undefined) {
      insertedId = result.lastInsertRowid;
    } else if (result.insertId !== undefined) {
      insertedId = result.insertId;
    }

    // Return the full created record if we have a primary key
    if (this.metadata.primaryKey && insertedId !== undefined) {
      const created = await this.findById(insertedId);
      if (created) return created;
    }

    return { ...data, ...(insertedId !== undefined ? { [this.metadata.primaryKey!]: insertedId } : {}) } as T;
  }

  async update(id: any, data: Partial<T>): Promise<T | null> {
    this.ensureInitialized();
    this.requirePrimaryKey();

    const updateBuilder = QueryBuilder.update(this.connection);
    await updateBuilder
      .setTable(this.metadata.tableName)
      .set(data as Record<string, any>)
      .where(`${this.metadata.primaryKey} = ?`, id)
      .execute();

    return this.findById(id);
  }

  async delete(id: any): Promise<boolean> {
    this.ensureInitialized();
    this.requirePrimaryKey();

    const deleteBuilder = QueryBuilder.delete(this.connection);
    await deleteBuilder
      .from(this.metadata.tableName)
      .where(`${this.metadata.primaryKey} = ?`, id)
      .execute();

    return true;
  }

  async deleteWhere(conditions: Partial<T>): Promise<void> {
    this.ensureInitialized();
    const deleteBuilder = QueryBuilder.delete(this.connection);
    let builder = deleteBuilder.from(this.metadata.tableName);

    for (const [key, value] of Object.entries(conditions)) {
      builder = builder.where(`${key} = ?`, value);
    }
    await builder.execute();
  }

  // --------------- Utility ---------------

  async count(conditions: Partial<T> = {}): Promise<number> {
    this.ensureInitialized();
    let qb = new QueryBuilder(this.connection)
      .select('COUNT(*) as count')
      .from(this.metadata.tableName);

    for (const [key, value] of Object.entries(conditions)) {
      qb = qb.where(`${key} = ?`, value);
    }
    const rows = await qb.execute();
    return rows[0]?.count ?? 0;
  }

  /** Returns a raw QueryBuilder bound to this entity's table */
  query(): QueryBuilder {
    this.ensureInitialized();
    return new QueryBuilder(this.connection).from(this.metadata.tableName);
  }

  // --------------- Internal ---------------

  private requirePrimaryKey(): void {
    if (!this.metadata.primaryKey) {
      throw new Error(`Entity "${this.metadata.tableName}" does not have a primary key defined`);
    }
  }

  /** Create table in the database for this entity */
  async createTable(): Promise<void> {
    this.ensureInitialized();
    const columns = this.metadata.columns.map(col => {
      let columnDef = `"${col.columnName}" ${this.mapType(col.type)}`;

      if (col.primaryKey) {
        columnDef += ' PRIMARY KEY';
        if (this.connection.getType() === 'sqlite') {
          columnDef += ' AUTOINCREMENT';
        } else if (this.connection.getType() === 'postgresql') {
          columnDef = `"${col.columnName}" SERIAL PRIMARY KEY`;
        } else if (this.connection.getType() === 'mysql') {
          columnDef += ' AUTO_INCREMENT';
        }
      }

      if (!col.nullable && !col.primaryKey) {
        columnDef += ' NOT NULL';
      }

      if (col.unique && !col.primaryKey) {
        columnDef += ' UNIQUE';
      }

      return columnDef;
    });

    const sql = `CREATE TABLE IF NOT EXISTS "${this.metadata.tableName}" (${columns.join(', ')})`;
    await this.connection.execute(sql);
  }

  private mapType(type: string): string {
    const dbType = this.connection.getType();

    switch (type.toLowerCase()) {
      case 'string':
      case 'text':
        return 'TEXT';
      case 'number':
      case 'integer':
        if (dbType === 'mysql') return 'INT';
        return 'INTEGER';
      case 'boolean':
        if (dbType === 'postgresql') return 'BOOLEAN';
        if (dbType === 'mysql') return 'TINYINT(1)';
        return 'INTEGER';
      case 'date':
        if (dbType === 'postgresql') return 'TIMESTAMP';
        if (dbType === 'mysql') return 'DATETIME';
        return 'TEXT';
      default:
        return 'TEXT';
    }
  }
}
