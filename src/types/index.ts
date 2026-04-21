import { IncomingMessage, ServerResponse } from 'http';

export interface VelocityRequest extends IncomingMessage {
  body?: any;
  params?: Record<string, string>;
  query?: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
  user?: any;
  session?: any;
}

export interface VelocityResponse extends ServerResponse {
  json(data: any): void;
  status(code: number): VelocityResponse;
  send(data: any): void;
}

export interface RouteHandler {
  (req: VelocityRequest, res: VelocityResponse): Promise<any> | any;
}

export interface MiddlewareFunction {
  (req: VelocityRequest, res: VelocityResponse, next: () => void): Promise<void> | void;
}

export interface InterceptorFunction {
  (data: any, req: VelocityRequest, res: VelocityResponse): Promise<any> | any;
}

export interface RouteMetadata {
  path: string;
  method: string;
  handler: string;
  middlewares?: MiddlewareFunction[];
  interceptors?: InterceptorFunction[];
}

export interface ControllerMetadata {
  path: string;
  target: any;
}

export interface DatabaseConfig {
  type: 'sqlite' | 'postgresql' | 'mysql';
  host?: string;
  port?: number;
  database: string;
  username?: string;
  password?: string;
  filename?: string; // For SQLite
}

export interface LoggerConfig {
  level: 'error' | 'warn' | 'info' | 'debug';
  format: 'json' | 'simple' | 'combined';
  outputs: ('console' | 'file')[];
  filename?: string;
}

export interface RegisterOptions {
  scope?: any[];
  singleton?: boolean;
  prefix?: string;
  middleware?: MiddlewareFunction[];
}

export interface ApplicationConfig {
  port: number;
  host: string;
  logger?: LoggerConfig;
  cors?: {
    origin: string | string[];
    credentials: boolean;
  };
  rateLimit?: {
    windowMs: number;
    max: number;
  };
  globalPrefix?: string;
  globalPrefixExclusions?: string[];
}

export interface EntityMetadata {
  target: any;
  tableName: string;
  columns: ColumnMetadata[];
  primaryKey?: string;
}

export interface ColumnMetadata {
  propertyName: string;
  columnName: string;
  type: string;
  nullable: boolean;
  unique: boolean;
  primaryKey: boolean;
}
