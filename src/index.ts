import './core/metadata';

// Core exports
export { VelocityApplication } from './core/application';
export { Container } from './core/container';

// Decorator exports
export { Controller } from './decorators/controller';
export { Get, Post, Put, Delete, Patch } from './decorators/route';
export { Middleware, Middlewares } from './decorators/middleware';
export { Interceptor, Interceptors } from './decorators/interceptor';
export { Service } from './decorators/service';
export { Go } from './decorators/go';
export { Channel } from './decorators/channel';
export { Fn } from './decorators/fn';
export { Guards } from './decorators/guard';
export { Upload } from './decorators/upload';
export { Status } from './decorators/status';
export { ResponseFrame } from './decorators/response-frame';
export { Frame } from './core/frame';
export { VelocitySession } from './core/session';
export type { SessionConfig } from './core/session';
export type { FrameTemplate, CompiledFrame } from './core/frame';
export { WebSocket, Command, CommandElse } from './decorators/websocket';
export { VelocityChannel } from './channel/channel';

// ORM exports
export { Entity, Column, PrimaryKey } from './orm/decorators';
export { DB, Database } from './orm/database';
export { EntityAccessor } from './orm/entity-accessor';
export { QueryBuilder } from './orm/query-builder';
export { DatabaseConnection, registerDriver } from './orm/connection';
export type { DatabaseDriver } from './orm/connection';

// Middleware exports
export { CorsMiddleware } from './middleware/cors';
export { RateLimitMiddleware } from './middleware/rate-limit';
export { HelmetMiddleware } from './middleware/helmet';

// Interceptor exports
export { TransformInterceptor } from './interceptors/transform';

// Utility exports
export { Logger } from './logging/logger';
export { Validator, Validate, compileValidator } from './validation/validator';
export type { ValidateSchema, CompiledValidator } from './validation/validator';
export { Config } from './config/config';
export { createEnvelocity } from './config/envelocity';
export type { EnvelocityOptions } from './config/envelocity';
export { TestUtils } from './testing/test-utils';
export { Suite, Test, BeforeEach, AfterEach, BeforeAll, AfterAll, Mock } from './testing/decorators';

// Type exports (RegisterOptions, ApplicationConfig, etc.)
export * from './types';
