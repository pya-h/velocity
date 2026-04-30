import { IncomingMessage, ServerResponse } from 'http';
import type { VeloSession } from '../core/session';

export interface VeloRequest extends Omit<IncomingMessage, 'headers'> {
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, string>;
  /** Node: Record with bracket access. Bun: native Headers — use .get('key') for cross-compat. */
  headers: Record<string, string | string[] | undefined> | Headers;
  user?: unknown;
  session?: VeloSession;
  cookies?: Record<string, string>;
  /** Signed cookies — value is the verified plaintext, or `false` if signature invalid. */
  signedCookies?: Record<string, string | false>;
  files?: Record<string, UploadedFile | UploadedFile[]>;
}

export interface VeloResponse extends ServerResponse {
  json(data: unknown): void;
  status(code: number): VeloResponse;
  send(data: unknown): void;
  setCookie(name: string, value: string, options?: CookieOptions): VeloResponse;
  clearCookie(name: string, options?: Omit<CookieOptions, 'maxAge' | 'expires'>): VeloResponse;
}

export interface RouteHandler {
  (req: VeloRequest, res: VeloResponse): Promise<unknown> | unknown;
}

export interface MiddlewareFunction {
  (req: VeloRequest, res: VeloResponse, next: () => void): Promise<void> | void;
}

export interface InterceptorFunction {
  (data: unknown, req: VeloRequest, res: VeloResponse): Promise<unknown> | unknown;
}

export type GuardFunction = (req: VeloRequest) => boolean | Promise<boolean>;

/** Read a header from either native Headers (.get) or plain object (bracket access). */
export function getHeader(headers: VeloRequest['headers'], name: string): string | undefined {
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) ?? undefined;
  return (headers as Record<string, string | string[] | undefined>)[name] as string | undefined;
}

export type OnRequestHook = (req: VeloRequest) => void | Promise<void>;
export type OnResponseHook = (req: VeloRequest, res: VeloResponse) => void | Promise<void>;
export type OnErrorHook = (error: Error, req: VeloRequest, res: VeloResponse) => void | Promise<void>;

export interface CookieOptions {
  maxAge?: number;
  expires?: Date;
  path?: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  /** Sign the cookie value with HMAC-SHA256 using the app's cookieSecret. */
  signed?: boolean;
}

export interface UploadedFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface UploadOptions {
  maxSize?: number;
  maxFiles?: number;
}

export interface RouteMetadata {
  path: string;
  method: string;
  handler: string;
  middlewares?: MiddlewareFunction[];
  interceptors?: InterceptorFunction[];
  guards?: GuardFunction[];
  upload?: UploadOptions;
  schema?: unknown;
  statusCode?: number;
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
  pool?: {
    min?: number; // pg only; ignored for mysql2 and sqlite
    max?: number; // pg: default 10; mysql2 connectionLimit: default 10
  };
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
  /** Secret key for signing cookies (HMAC-SHA256). Required for `signed: true` in setCookie. */
  cookieSecret?: string;
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
  shutdown?: {
    /** ms to wait for in-flight requests before forcing close. Default: 5000 */
    timeout?: number;
    /** Auto-register SIGTERM/SIGINT handlers that call close() + process.exit(). Default: false */
    auto?: boolean;
  };
  compression?: {
    /** Enable response compression. Default: false */
    enabled?: boolean;
    /** Minimum response size in bytes to compress. Default: 1024 */
    threshold?: number;
  };
  /** Encrypted cookie session. If not set, session features are disabled (zero overhead). */
  session?: {
    /** Secret key for AES-256-GCM encryption + HMAC-SHA256 signing. */
    secret: string;
    /** Cookie name. Default: 'velocity.sid' */
    cookieName?: string;
    /** Max age in seconds. Default: 3600 (1 hour) */
    maxAge?: number;
  };
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

export interface VeloSocket {
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
  data: unknown;
}

export interface WebSocketMetadata {
  path: string;
  target: unknown;
}

export interface WsResponse {
  ok: boolean;
  cmd: string;
  data: unknown;
  error: string | null;
}

// ─── Status codes ────────────────────────────────────────────────────────────

export const StatusCode = {
  // 2xx Success
  OK: 200,
  Created: 201,
  Accepted: 202,
  NoContent: 204,

  // 3xx Redirection
  MovedPermanently: 301,
  Found: 302,
  NotModified: 304,
  TemporaryRedirect: 307,
  PermanentRedirect: 308,

  // 4xx Client Error
  BadRequest: 400,
  Unauthorized: 401,
  Forbidden: 403,
  NotFound: 404,
  MethodNotAllowed: 405,
  Conflict: 409,
  Gone: 410,
  UnprocessableEntity: 422,
  TooManyRequests: 429,

  // 5xx Server Error
  InternalServerError: 500,
  NotImplemented: 501,
  BadGateway: 502,
  ServiceUnavailable: 503,
  GatewayTimeout: 504,
} as const;
