import 'reflect-metadata';

// Core exports
export { VelocityApplication } from './core/application';
export { Container } from './core/container';

// Decorator exports
export { Controller } from './decorators/controller';
export { Get, Post, Put, Delete, Patch } from './decorators/route';
export { Middleware, UseMiddleware } from './decorators/middleware';
export { Injectable } from './decorators/injectable';
export { Interceptor, UseInterceptor } from './decorators/interceptor';

// ORM exports
export { Entity, Column, PrimaryKey, Repository } from './orm/decorators';
export { QueryBuilder } from './orm/query-builder';
export { BaseRepository } from './orm/repository';
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
export { TestUtils } from './testing/test-utils';

// Type exports
export * from './types';
