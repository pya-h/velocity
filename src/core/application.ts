import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';
import { Container } from './container';
import { Logger } from '../logging/logger';
import { Config } from '../config/config';
import { Database, _setCurrentApp } from '../orm/database';
import { VelocityRequest, VelocityResponse, ApplicationConfig, RouteMetadata, ControllerMetadata } from '../types';

const CONTROLLER_METADATA_KEY = Symbol.for('controller');
const ROUTES_METADATA_KEY = Symbol.for('routes');
const SERVICE_METADATA_KEY = Symbol.for('service');

export class VelocityApplication {
  private server: Server;
  private container: Container;
  private logger: Logger;
  private config: Config;
  private controllers: Map<string, any> = new Map();
  private routes: Map<string, RouteMetadata[]> = new Map();
  private databases: Database[] = [];

  constructor(config?: Partial<ApplicationConfig>) {
    this.container = new Container();
    this.config = new Config(config);
    this.logger = new Logger(this.config.get('logger'));

    this.server = createServer((req, res) => this.handleRequest(req, res));
    this.setupContainer();

    // Register this app as the current global app so DB() auto-registers
    _setCurrentApp(this);
  }

  private setupContainer(): void {
    this.container.register('logger', this.logger);
    this.container.register('config', this.config);
    this.container.register('app', this);
  }

  /**
   * Unified registration method.
   * Accepts a controller class, a service class, or a pre-built instance.
   *
   * Controllers: must be decorated with @Controller
   * Services:    must be decorated with @Service (registered in DI container)
   */
  public register(target: any): this {
    // Check if it's a controller
    const controllerMeta: ControllerMetadata = Reflect.getMetadata(CONTROLLER_METADATA_KEY, target);
    if (controllerMeta) {
      this.registerController(target);
      return this;
    }

    // Check if it's a service
    const serviceMeta = Reflect.getMetadata(SERVICE_METADATA_KEY, target);
    if (serviceMeta) {
      this.registerService(target);
      return this;
    }

    // Fallback: try as controller (throws if not decorated)
    this.registerController(target);
    return this;
  }

  /** Register a controller class (must be decorated with @Controller) */
  public registerController(controllerClass: any): void {
    const controllerMetadata: ControllerMetadata = Reflect.getMetadata(CONTROLLER_METADATA_KEY, controllerClass);

    if (!controllerMetadata) {
      throw new Error(`${controllerClass.name} is not decorated with @Controller`);
    }

    const controller = this.container.resolve(controllerClass);
    const routesMetadata: RouteMetadata[] = Reflect.getMetadata(ROUTES_METADATA_KEY, controllerClass) || [];

    this.controllers.set(controllerMetadata.path, controller);
    this.routes.set(controllerMetadata.path, routesMetadata);

    this.logger.info(`Registered controller: ${controllerClass.name} at ${controllerMetadata.path}`);
  }

  /** Register a service class in the DI container */
  public registerService(serviceClass: any): void {
    const serviceMeta = Reflect.getMetadata(SERVICE_METADATA_KEY, serviceClass);
    const name = serviceMeta?.name || serviceClass.name;

    // Register both by class and by name for flexible injection
    this.container.register(serviceClass, serviceClass, true);
    if (name) {
      this.container.register(name, serviceClass, true);
    }

    this.logger.info(`Registered service: ${serviceClass.name}`);
  }

  /** Register a Database instance (called automatically by DB() factory) */
  public registerDatabase(database: Database): void {
    this.databases.push(database);
    this.container.register(`db:${database.name}`, database);
    if (database.name === 'default') {
      this.container.register('database', database);
    }
  }

  /** Initialize all registered databases */
  private async initializeDatabases(): Promise<void> {
    for (const db of this.databases) {
      if (!db.initialized) {
        await db.initialize();
        this.logger.info(`Database "${db.name}" initialized (${db.getEntityNames().join(', ')} entities)`);
      }
    }
  }

  public async listen(port?: number, host?: string): Promise<void> {
    const finalPort = port || this.config.get('port') || 5000;
    const finalHost = host || this.config.get('host') || '0.0.0.0';

    // Initialize databases before starting the server
    await this.initializeDatabases();

    this.logger.info('Application initialized successfully');

    return new Promise((resolve) => {
      this.server.listen(finalPort, finalHost, () => {
        this.logger.info(`Server running on http://${finalHost}:${finalPort}`);
        resolve();
      });
    });
  }

  public async close(): Promise<void> {
    // Close all databases
    for (const db of this.databases) {
      await db.close();
    }

    return new Promise((resolve) => {
      this.server.close(() => {
        this.logger.info('Server closed');
        resolve();
      });
    });
  }

  public getContainer(): Container {
    return this.container;
  }

  // ─── Request handling (unchanged logic) ───

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const velocityReq = req as VelocityRequest;
    const velocityRes = this.enhanceResponse(res);

    try {
      const { pathname, query } = parse(req.url || '', true);
      const method = req.method?.toUpperCase() || 'GET';

      if (['POST', 'PUT', 'PATCH'].includes(method)) {
        velocityReq.body = await this.parseBody(req);
      }

      velocityReq.query = query as Record<string, string>;

      const { controller, route, params } = this.findRoute(pathname || '/', method);

      if (!controller || !route) {
        velocityRes.status(404).json({ error: 'Route not found' });
        return;
      }

      velocityReq.params = params;

      // Execute middlewares
      if (route.middlewares) {
        for (const middleware of route.middlewares) {
          let nextCalled = false;
          await middleware(velocityReq, velocityRes, () => { nextCalled = true; });
          if (!nextCalled) {
            if (!velocityRes.headersSent) {
              velocityRes.status(500).json({ error: 'Middleware did not send a response' });
            }
            return;
          }
        }
      }

      // Execute route handler
      const result = await controller[route.handler](velocityReq, velocityRes);

      // Execute interceptors
      let finalResult = result;
      if (route.interceptors) {
        for (const interceptor of route.interceptors) {
          finalResult = await interceptor(finalResult, velocityReq, velocityRes);
        }
      }

      // Send response if not already sent
      if (!velocityRes.headersSent) {
        if (finalResult !== undefined) {
          velocityRes.json(finalResult);
        } else {
          velocityRes.status(204).send('');
        }
      }

    } catch (error) {
      this.logger.error('Request handling error:', error);
      if (!velocityRes.headersSent) {
        velocityRes.status(500).json({
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  }

  private enhanceResponse(res: ServerResponse): VelocityResponse {
    const velocityRes = res as VelocityResponse;

    velocityRes.json = function(data: any) {
      this.setHeader('Content-Type', 'application/json');
      this.end(JSON.stringify(data));
    };

    velocityRes.status = function(code: number) {
      this.statusCode = code;
      return this;
    };

    velocityRes.send = function(data: any) {
      if (typeof data === 'string') {
        this.setHeader('Content-Type', 'text/plain');
        this.end(data);
      } else {
        this.json(data);
      }
    };

    return velocityRes;
  }

  private async parseBody(req: IncomingMessage): Promise<any> {
    const MAX_BODY_SIZE = 1024 * 1024;

    return new Promise((resolve, reject) => {
      let body = '';
      let size = 0;

      req.on('data', (chunk: Buffer | string) => {
        size += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
        if (size > MAX_BODY_SIZE) {
          req.destroy();
          reject(new Error('Request body too large'));
          return;
        }
        body += chunk;
      });
      req.on('end', () => {
        try {
          const contentType = req.headers['content-type'] || '';
          if (contentType.includes('application/json')) {
            resolve(JSON.parse(body));
          } else {
            resolve(body);
          }
        } catch (error) {
          reject(error);
        }
      });
      req.on('error', reject);
    });
  }

  private findRoute(pathname: string, method: string): { controller: any; route: RouteMetadata; params: Record<string, string> } | { controller: null; route: null; params: {} } {
    for (const [basePath, routes] of this.routes.entries()) {
      for (const route of routes) {
        if (route.method !== method) continue;

        const fullPath = basePath + route.path;
        const match = this.matchPath(fullPath, pathname);

        if (match) {
          const controller = this.controllers.get(basePath);
          return { controller, route, params: match.params };
        }
      }
    }

    return { controller: null, route: null, params: {} };
  }

  private matchPath(pattern: string, pathname: string): { params: Record<string, string> } | null {
    const patternParts = pattern.split('/').filter(p => p);
    const pathnameParts = pathname.split('/').filter(p => p);

    if (patternParts.length !== pathnameParts.length) {
      return null;
    }

    const params: Record<string, string> = {};

    for (let i = 0; i < patternParts.length; i++) {
      const patternPart = patternParts[i];
      const pathnamePart = pathnameParts[i];

      if (patternPart.startsWith(':')) {
        const paramName = patternPart.slice(1);
        params[paramName] = pathnamePart;
      } else if (patternPart !== pathnamePart) {
        return null;
      }
    }

    return { params };
  }
}
