import { DatabaseConnection } from './connection';
import { QueryBuilder } from './query-builder';
import { EntityMetadata } from '../types';

export class EntityAccessor<T = any> {
  private connection!: DatabaseConnection;
  private metadata: EntityMetadata;
  private initialized = false;

  constructor(metadata: EntityMetadata) {
    this.metadata = metadata;
  }

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
      qb = qb.where(`"${key}" = ?`, value);
    }
    return qb.first();
  }

  async findMany(conditions: Partial<T> = {}): Promise<T[]> {
    this.ensureInitialized();
    let qb = new QueryBuilder(this.connection)
      .select('*')
      .from(this.metadata.tableName);

    for (const [key, value] of Object.entries(conditions)) {
      qb = qb.where(`"${key}" = ?`, value);
    }
    return qb.execute();
  }

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

    let insertedId: any;
    if (this.connection.getType() === 'postgresql' && result.rows?.length > 0) {
      insertedId = result.rows[0][this.metadata.primaryKey!];
    } else if (result.lastInsertRowid !== undefined) {
      insertedId = result.lastInsertRowid;
    } else if (result.insertId !== undefined) {
      insertedId = result.insertId;
    }

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

  async count(conditions: Partial<T> = {}): Promise<number> {
    this.ensureInitialized();
    const entries = Object.entries(conditions as Record<string, any>);
    const params: any[] = [];
    let sql = `SELECT COUNT(*) as count FROM "${this.metadata.tableName}"`;
    if (entries.length > 0) {
      sql += ' WHERE ' + entries.map(([key]) => `"${key}" = ?`).join(' AND ');
      params.push(...entries.map(([, v]) => v));
    }
    const rows = await this.connection.query(sql, params) as Record<string, unknown>[];
    return (rows[0]?.count as number) ?? 0;
  }

  query(): QueryBuilder {
    this.ensureInitialized();
    return new QueryBuilder(this.connection).from(this.metadata.tableName);
  }

  private requirePrimaryKey(): void {
    if (!this.metadata.primaryKey) {
      throw new Error(`Entity "${this.metadata.tableName}" does not have a primary key defined`);
    }
  }

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
