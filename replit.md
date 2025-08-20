# Overview

Velocity Framework is a comprehensive TypeScript-first Node.js framework that provides a decorator-based architecture for building enterprise-grade web applications. The framework emphasizes type safety, dependency injection, and modular design patterns similar to NestJS but with a lighter footprint. It includes built-in ORM capabilities, structured logging, middleware system, and comprehensive testing utilities.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Core Application Structure
The framework follows a modular architecture centered around the `VelocityApplication` class which serves as the main application bootstrapper. The application uses a custom HTTP server built on Node.js's native HTTP module rather than Express, providing direct control over request/response handling. The architecture is built around TypeScript decorators with experimental decorator support enabled.

## Dependency Injection System
The framework implements a custom dependency injection container (`Container` class) that supports singleton and transient service lifetimes. Services are registered using string identifiers, symbols, or constructor functions. The container automatically resolves dependencies and creates instances, supporting both constructor injection and factory functions.

## Decorator-Based Routing
Controllers use decorators for route definition (@Get, @Post, @Put, @Delete, @Patch) and are registered with base paths using the @Controller decorator. Route metadata is stored using Reflect.defineMetadata and retrieved during application bootstrapping. Each route can have associated middleware and interceptors defined through additional decorators.

## Middleware and Interceptor Pipeline
The framework supports both class-based and function-based middleware with execution order control. Middleware runs before route handlers, while interceptors transform responses after handlers complete. Both systems support dependency injection and can be applied at the controller or route level.

## Built-in ORM System
The ORM uses decorators (@Entity, @Column, @PrimaryKey) to define database schemas and provides a repository pattern for data access. The `BaseRepository` class offers common CRUD operations, while the `QueryBuilder` provides a fluent API for complex queries. The system supports multiple database types through a connection abstraction layer.

## Database Connection Management
The `DatabaseConnection` class provides a unified interface for SQLite, PostgreSQL, and MySQL databases. Connection configuration is handled through the application config system, with support for connection strings and individual parameter specification.

## Structured Logging
The logging system is built on Winston and provides configurable output formats (JSON, simple, combined) and multiple transport options (console, file). Loggers are injected through the dependency container and support different log levels and metadata attachment.

## Configuration Management
The `Config` class handles application configuration with environment variable support and cascading defaults. Database connections can be configured via DATABASE_URL environment variable or individual parameters.

## Security Middleware
Built-in security middleware includes CORS handling, rate limiting, and Helmet integration for security headers. Each middleware is implemented as a class with configurable options and can be applied globally or per-route.

## Validation System
Request validation uses Joi schemas with a decorator-based approach (@Validate). The validation system integrates with the route handling pipeline and provides structured error responses.

# External Dependencies

## Core Runtime Dependencies
- **express**: HTTP server framework (v5.1.0) - Used for HTTP handling capabilities
- **reflect-metadata**: Metadata reflection API (v0.2.2) - Required for decorator functionality
- **winston**: Logging library (v3.17.0) - Provides structured logging capabilities
- **class-transformer**: Object transformation (v0.5.1) - Used for data serialization
- **class-validator**: Validation decorators (v0.14.2) - Provides validation functionality

## Database Support
- **pg**: PostgreSQL client (v8.16.3) - PostgreSQL database connectivity
- **better-sqlite3**: SQLite client - SQLite database operations (implied from connection code)
- **mysql2**: MySQL client - MySQL database connectivity (implied from connection code)

## Security and Middleware
- **cors**: CORS middleware (v2.8.5) - Cross-origin resource sharing
- **helmet**: Security headers (v8.1.0) - HTTP security headers
- **express-rate-limit**: Rate limiting (v8.0.1) - Request rate limiting

## Development and Configuration
- **dotenv**: Environment variables (v17.2.1) - Configuration management
- **nodemon**: Development server (v3.1.10) - Hot reloading support
- **typescript**: TypeScript compiler (v5.9.2) - Type checking and compilation
- **ts-node**: TypeScript execution (v10.9.2) - Direct TypeScript execution

## Testing Framework
- **jest**: Testing framework (v30.0.5) - Unit and integration testing
- **ts-jest**: Jest TypeScript support (v29.4.1) - TypeScript testing integration
- **supertest**: HTTP testing (v7.1.4) - API endpoint testing

## Validation
- **joi**: Schema validation - Request validation (implied from validation code)

The framework is designed to be database-agnostic but currently has explicit support for PostgreSQL, SQLite, and MySQL through dedicated client libraries.