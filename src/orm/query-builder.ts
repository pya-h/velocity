import { DatabaseConnection } from './connection';

// Validates and quotes a SQL identifier to prevent injection
function quoteIdentifier(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return `"${name}"`;
}

export class QueryBuilder {
  private selectFields: string[] = [];
  private fromTable: string = '';
  private whereConditions: string[] = [];
  private joinClauses: string[] = [];
  private orderByFields: string[] = [];
  private limitValue?: number;
  private offsetValue?: number;
  private parameters: any[] = [];

  constructor(private connection: DatabaseConnection) {}

  public select(fields: string | string[]): QueryBuilder {
    if (Array.isArray(fields)) {
      this.selectFields = fields;
    } else {
      this.selectFields = [fields];
    }
    return this;
  }

  public from(table: string): QueryBuilder {
    this.fromTable = table;
    return this;
  }

  public where(condition: string, ...params: any[]): QueryBuilder {
    this.whereConditions.push(condition);
    this.parameters.push(...params);
    return this;
  }

  public join(table: string, condition: string): QueryBuilder {
    this.joinClauses.push(`JOIN ${quoteIdentifier(table)} ON ${condition}`);
    return this;
  }

  public leftJoin(table: string, condition: string): QueryBuilder {
    this.joinClauses.push(`LEFT JOIN ${quoteIdentifier(table)} ON ${condition}`);
    return this;
  }

  public orderBy(field: string, direction: 'ASC' | 'DESC' = 'ASC'): QueryBuilder {
    this.orderByFields.push(`${quoteIdentifier(field)} ${direction}`);
    return this;
  }

  public limit(count: number): QueryBuilder {
    this.limitValue = count;
    return this;
  }

  public offset(count: number): QueryBuilder {
    this.offsetValue = count;
    return this;
  }

  public async execute(): Promise<any[]> {
    const sql = this.buildQuery();
    return await this.connection.query(sql, this.parameters);
  }

  public async first(): Promise<any | null> {
    this.limitValue = 1;
    const results = await this.execute();
    return results.length > 0 ? results[0] : null;
  }

  private buildQuery(): string {
    let sql = 'SELECT ';

    // SELECT clause
    if (this.selectFields.length > 0) {
      sql += this.selectFields.map(f => f === '*' ? '*' : quoteIdentifier(f)).join(', ');
    } else {
      sql += '*';
    }

    // FROM clause
    sql += ` FROM ${quoteIdentifier(this.fromTable)}`;

    // JOIN clauses
    if (this.joinClauses.length > 0) {
      sql += ' ' + this.joinClauses.join(' ');
    }

    // WHERE clause
    if (this.whereConditions.length > 0) {
      sql += ' WHERE ' + this.whereConditions.join(' AND ');
    }

    // ORDER BY clause
    if (this.orderByFields.length > 0) {
      sql += ' ORDER BY ' + this.orderByFields.join(', ');
    }

    // LIMIT clause
    if (this.limitValue !== undefined) {
      sql += ` LIMIT ${this.limitValue}`;
    }

    // OFFSET clause
    if (this.offsetValue !== undefined) {
      sql += ` OFFSET ${this.offsetValue}`;
    }

    return sql;
  }

  // Insert builder
  public static insert(connection: DatabaseConnection): InsertBuilder {
    return new InsertBuilder(connection);
  }

  // Update builder
  public static update(connection: DatabaseConnection): UpdateBuilder {
    return new UpdateBuilder(connection);
  }

  // Delete builder
  public static delete(connection: DatabaseConnection): DeleteBuilder {
    return new DeleteBuilder(connection);
  }
}

class InsertBuilder {
  private table: string = '';
  private data: Record<string, any> = {};
  private returningField?: string;

  constructor(private connection: DatabaseConnection) {}

  public into(table: string): InsertBuilder {
    this.table = table;
    return this;
  }

  public values(data: Record<string, any>): InsertBuilder {
    this.data = data;
    return this;
  }

  public returning(field: string): InsertBuilder {
    this.returningField = field;
    return this;
  }

  public async execute(): Promise<any> {
    const fields = Object.keys(this.data);
    const values = Object.values(this.data);
    const quotedFields = fields.map(f => quoteIdentifier(f)).join(', ');
    const placeholders = fields.map(() => '?').join(', ');

    let sql = `INSERT INTO ${quoteIdentifier(this.table)} (${quotedFields}) VALUES (${placeholders})`;

    // Add RETURNING clause for PostgreSQL
    if (this.returningField && this.connection.getType() === 'postgresql') {
      sql += ` RETURNING ${quoteIdentifier(this.returningField)}`;
    }

    return await this.connection.execute(sql, values);
  }
}

class UpdateBuilder {
  private table: string = '';
  private data: Record<string, any> = {};
  private whereConditions: string[] = [];
  private parameters: any[] = [];

  constructor(private connection: DatabaseConnection) {}

  public setTable(table: string): UpdateBuilder {
    this.table = table;
    return this;
  }

  public set(data: Record<string, any>): UpdateBuilder {
    this.data = data;
    return this;
  }

  public where(condition: string, ...params: any[]): UpdateBuilder {
    this.whereConditions.push(condition);
    this.parameters.push(...params);
    return this;
  }

  public async execute(): Promise<any> {
    const setClause = Object.keys(this.data).map(key => `${quoteIdentifier(key)} = ?`).join(', ');
    const dataValues = Object.values(this.data);

    let sql = `UPDATE ${quoteIdentifier(this.table)} SET ${setClause}`;

    if (this.whereConditions.length > 0) {
      sql += ' WHERE ' + this.whereConditions.join(' AND ');
    }

    return await this.connection.execute(sql, [...dataValues, ...this.parameters]);
  }
}

class DeleteBuilder {
  private table: string = '';
  private whereConditions: string[] = [];
  private parameters: any[] = [];

  constructor(private connection: DatabaseConnection) {}

  public from(table: string): DeleteBuilder {
    this.table = table;
    return this;
  }

  public where(condition: string, ...params: any[]): DeleteBuilder {
    this.whereConditions.push(condition);
    this.parameters.push(...params);
    return this;
  }

  public async execute(): Promise<any> {
    let sql = `DELETE FROM ${quoteIdentifier(this.table)}`;

    if (this.whereConditions.length > 0) {
      sql += ' WHERE ' + this.whereConditions.join(' AND ');
    }

    return await this.connection.execute(sql, this.parameters);
  }
}
