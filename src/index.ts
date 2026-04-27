import 'reflect-metadata';

// Core exports
export { VelocityApplication } from './core/application';
export { Container } from './core/container';

// Decorator exports
export { Controller } from './decorators/controller';
export { Get, Post, Put, Delete, Patch } from './decorators/route';
export { Middleware, UseMiddleware } from './decorators/middleware';
export { Interceptor, UseInterceptor } from './decorators/interceptor';
export { Service } from './decorators/service';
export { Go } from './decorators/go';
export { Channel } from './decorators/channel';
export { VelocityChannel } from './channel/channel';

// ORM exports
export { Entity, Column, PrimaryKey } from './orm/decorators';
export { DB, Database } from './orm/database';
export { EntityAccessor } from './orm/entity-accessor';
export { QueryBuilder } from './orm/query-builder';
export { DatabaseConnection } from './orm/connection';

// Middleware exports
export { CorsMiddleware } from './middleware/cors';
export { RateLimitMiddleware } from './middleware/rate-limit';
export { HelmetMiddleware } from './middleware/helmet';

// Interceptor exports
export { TransformInterceptor } from './interceptors/transform';

// Utility exports
export { Logger } from './logging/logger';
export { Validator, Validate } from './validation/validator';
export { Config } from './config/config';
export { createEnvelocity } from './config/envelocity';
export type { EnvelocityOptions } from './config/envelocity';
export { TestUtils } from './testing/test-utils';

// Type exports (RegisterOptions, ApplicationConfig, etc.)
export * from './types';
