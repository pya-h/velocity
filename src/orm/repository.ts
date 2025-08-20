import { DatabaseConnection } from './connection';
import { QueryBuilder } from './query-builder';
import { EntityMetadata } from '../types';

const ENTITY_METADATA_KEY = Symbol('entity');

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
    return await insertBuilder
      .into(this.metadata.tableName)
      .values(data as Record<string, any>)
      .execute();
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
      let columnDef = `${col.columnName} ${this.mapType(col.type)}`;
      
      if (col.primaryKey) {
        columnDef += ' PRIMARY KEY';
        if (this.connection.getType() === 'sqlite') {
          columnDef += ' AUTOINCREMENT';
        }
      }
      
      if (!col.nullable) {
        columnDef += ' NOT NULL';
      }
      
      if (col.unique && !col.primaryKey) {
        columnDef += ' UNIQUE';
      }
      
      return columnDef;
    });

    const sql = `CREATE TABLE IF NOT EXISTS ${this.metadata.tableName} (${columns.join(', ')})`;
    await this.connection.execute(sql);
  }

  private mapType(type: string): string {
    const dbType = this.connection.getType();
    
    switch (type.toLowerCase()) {
      case 'string':
      case 'text':
        return dbType === 'postgresql' ? 'TEXT' : 'TEXT';
      case 'number':
      case 'integer':
        return dbType === 'postgresql' ? 'INTEGER' : 'INTEGER';
      case 'boolean':
        return dbType === 'postgresql' ? 'BOOLEAN' : 'INTEGER';
      case 'date':
        return dbType === 'postgresql' ? 'TIMESTAMP' : 'TEXT';
      default:
        return 'TEXT';
    }
  }
}
