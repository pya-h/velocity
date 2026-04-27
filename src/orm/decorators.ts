import { EntityMetadata, ColumnMetadata } from '../types';

const ENTITY_METADATA_KEY = Symbol.for('entity');
const COLUMN_METADATA_KEY = Symbol.for('column');

export function Entity(tableName?: string) {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    const metadata: EntityMetadata = {
      target: constructor,
      tableName: tableName || constructor.name.toLowerCase(),
      columns: Reflect.getMetadata(COLUMN_METADATA_KEY, constructor) || [],
      primaryKey: undefined
    };

    const primaryKeyColumn = metadata.columns.find(col => col.primaryKey);
    if (primaryKeyColumn) {
      metadata.primaryKey = primaryKeyColumn.propertyName;
    }

    Reflect.defineMetadata(ENTITY_METADATA_KEY, metadata, constructor);
    return constructor;
  };
}

export function Column(options: {
  name?: string;
  type?: string;
  nullable?: boolean;
  unique?: boolean;
} = {}) {
  return function (target: any, propertyKey: string) {
    const columns: ColumnMetadata[] = Reflect.getMetadata(COLUMN_METADATA_KEY, target.constructor) || [];
    
    const columnType = options.type || Reflect.getMetadata('design:type', target, propertyKey)?.name.toLowerCase() || 'text';
    
    const column: ColumnMetadata = {
      propertyName: propertyKey,
      columnName: options.name || propertyKey,
      type: columnType,
      nullable: options.nullable !== false,
      unique: options.unique || false,
      primaryKey: false
    };

    columns.push(column);
    Reflect.defineMetadata(COLUMN_METADATA_KEY, columns, target.constructor);
  };
}

export function PrimaryKey() {
  return function (target: any, propertyKey: string) {
    const columns: ColumnMetadata[] = Reflect.getMetadata(COLUMN_METADATA_KEY, target.constructor) || [];
    
    const column: ColumnMetadata = {
      propertyName: propertyKey,
      columnName: propertyKey,
      type: 'integer',
      nullable: false,
      unique: true,
      primaryKey: true
    };

    columns.push(column);
    Reflect.defineMetadata(COLUMN_METADATA_KEY, columns, target.constructor);
  };
}

