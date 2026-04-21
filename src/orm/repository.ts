import { DatabaseConnection } from './connection';
import { QueryBuilder } from './query-builder';
import { EntityMetadata } from '../types';

const ENTITY_METADATA_KEY = Symbol.for('entity');

export class BaseRepository<T> {
  protected connection: DatabaseConnection;
  protected metadata: EntityMetadata;

  constructor(connection: DatabaseConnection, entityClass: new () => T) {
    this.connection = connection;
    this.metadata = Reflect.getMetadata(ENTITY_METADATA_KEY, entityClass);

    if (!this.metadata) {
      throw new Error(`Entity ${entityClass.name} is not decorated with @Entity`);
    }
  }

  public async find(): Promise<T[]> {
    const queryBuilder = new QueryBuilder(this.connection);
    return await queryBuilder.select('*').from(this.metadata.tableName).execute();
  }

  public async findById(id: any): Promise<T | null> {
    if (!this.metadata.primaryKey) {
      throw new Error('Entity does not have a primary key defined');
    }

    const queryBuilder = new QueryBuilder(this.connection);
    return await queryBuilder
      .select('*')
      .from(this.metadata.tableName)
      .where(`${this.metadata.primaryKey} = ?`, id)
      .first();
  }

  public async findOne(conditions: Partial<T>): Promise<T | null> {
    const queryBuilder = new QueryBuilder(this.connection);
    let query = queryBuilder.select('*').from(this.metadata.tableName);

    Object.entries(conditions).forEach(([key, value]) => {
      query = query.where(`${key} = ?`, value);
    });

    return await query.first();
  }

  public async findWhere(conditions: Partial<T>): Promise<T[]> {
    const queryBuilder = new QueryBuilder(this.connection);
    let query = queryBuilder.select('*').from(this.metadata.tableName);

    Object.entries(conditions).forEach(([key, value]) => {
      query = query.where(`${key} = ?`, value);
    });

    return await query.execute();
  }

  public async create(data: Partial<T>): Promise<any> {
    const insertBuilder = QueryBuilder.insert(this.connection);
    let builder = insertBuilder
      .into(this.metadata.tableName)
      .values(data as Record<string, any>);

    // Use RETURNING for PostgreSQL to get the inserted ID
    if (this.metadata.primaryKey && this.connection.getType() === 'postgresql') {
      builder = builder.returning(this.metadata.primaryKey);
    }

    const result = await builder.execute();

    // Normalize the result to always include an insertedId
    if (this.connection.getType() === 'postgresql' && result.rows && result.rows.length > 0) {
      result.insertedId = result.rows[0][this.metadata.primaryKey!];
    } else if (result.lastInsertRowid !== undefined) {
      result.insertedId = result.lastInsertRowid;
    } else if (result.insertId !== undefined) {
      result.insertedId = result.insertId;
    }

    return result;
  }

  public async update(id: any, data: Partial<T>): Promise<any> {
    if (!this.metadata.primaryKey) {
      throw new Error('Entity does not have a primary key defined');
    }

    const updateBuilder = QueryBuilder.update(this.connection);
    return await updateBuilder
      .setTable(this.metadata.tableName)
      .set(data as Record<string, any>)
      .where(`${this.metadata.primaryKey} = ?`, id)
      .execute();
  }

  public async delete(id: any): Promise<any> {
    if (!this.metadata.primaryKey) {
      throw new Error('Entity does not have a primary key defined');
    }

    const deleteBuilder = QueryBuilder.delete(this.connection);
    return await deleteBuilder
      .from(this.metadata.tableName)
      .where(`${this.metadata.primaryKey} = ?`, id)
      .execute();
  }

  public async deleteWhere(conditions: Partial<T>): Promise<any> {
    const deleteBuilder = QueryBuilder.delete(this.connection);
    let query = deleteBuilder.from(this.metadata.tableName);

    Object.entries(conditions).forEach(([key, value]) => {
      query = query.where(`${key} = ?`, value);
    });

    return await query.execute();
  }

  public createQueryBuilder(): QueryBuilder {
    return new QueryBuilder(this.connection).from(this.metadata.tableName);
  }

  public async createTable(): Promise<void> {
    const columns = this.metadata.columns.map(col => {
      let columnDef = `"${col.columnName}" ${this.mapType(col.type)}`;

      if (col.primaryKey) {
        columnDef += ' PRIMARY KEY';
        if (this.connection.getType() === 'sqlite') {
          columnDef += ' AUTOINCREMENT';
        } else if (this.connection.getType() === 'postgresql') {
          // Use SERIAL instead of INTEGER PRIMARY KEY for auto-increment in PostgreSQL
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
