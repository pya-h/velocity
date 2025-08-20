import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';
import { Container } from './container';
import { Logger } from '../logging/logger';
import { Config } from '../config/config';
import { DatabaseConnection } from '../orm/connection';
import { VelocityRequest, VelocityResponse, ApplicationConfig, RouteMetadata, ControllerMetadata } from '../types';

const CONTROLLER_METADATA_KEY = Symbol.for('controller');
const ROUTES_METADATA_KEY = Symbol.for('routes');

export class VelocityApplication {
  private server: Server;
  private container: Container;
  private logger: Logger;
  private config: Config;
  private database?: DatabaseConnection;
  private controllers: Map<string, any> = new Map();
  private routes: Map<string, RouteMetadata[]> = new Map();

  constructor(config?: Partial<ApplicationConfig>) {
    this.container = new Container();
    this.config = new Config(config);
    this.logger = new Logger(this.config.get('logger'));
    
    this.server = createServer((req, res) => this.handleRequest(req, res));
    this.setupContainer();
  }

  private setupContainer(): void {
    this.container.register('logger', this.logger);
    this.container.register('config', this.config);
    this.container.register('app', this);
  }

  public async initialize(): Promise<void> {
    // Initialize database connection if configured
    const dbConfig = this.config.get('database');
    if (dbConfig && dbConfig !== null) {
      this.database = new DatabaseConnection(dbConfig);
      await this.database.connect();
      this.container.register('database', this.database);
    }

    this.logger.info('Application initialized successfully');
  }

  public registerController(controllerClass: any): void {
    const controllerMetadata: ControllerMetadata = Reflect.getMetadata(CONTROLLER_METADATA_KEY, controllerClass);
    
    if (!controllerMetadata) {
      throw new Error(`Controller ${controllerClass.name} is not decorated with @Controller`);
    }

    const controller = this.container.resolve(controllerClass);
    const routesMetadata: RouteMetadata[] = Reflect.getMetadata(ROUTES_METADATA_KEY, controllerClass) || [];

    this.controllers.set(controllerMetadata.path, controller);
    this.routes.set(controllerMetadata.path, routesMetadata);

    this.logger.info(`Registered controller: ${controllerClass.name} at path ${controllerMetadata.path}`);
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const velocityReq = req as VelocityRequest;
    const velocityRes = this.enhanceResponse(res);

    try {
      // Parse URL and method
      const { pathname, query } = parse(req.url || '', true);
      const method = req.method?.toUpperCase() || 'GET';

      // Parse body for POST/PUT requests
      if (['POST', 'PUT', 'PATCH'].includes(method)) {
        velocityReq.body = await this.parseBody(req);
      }

      velocityReq.query = query as Record<string, string>;

      // Find matching route
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
          if (!nextCalled) return; // Middleware didn't call next()
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
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => body += chunk);
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

  public async listen(port?: number, host?: string): Promise<void> {
    const finalPort = port || this.config.get('port') || 5000;
    const finalHost = host || this.config.get('host') || '0.0.0.0';

    await this.initialize();

    return new Promise((resolve) => {
      this.server.listen(finalPort, finalHost, () => {
        this.logger.info(`Server running on http://${finalHost}:${finalPort}`);
        resolve();
      });
    });
  }

  public async close(): Promise<void> {
    if (this.database) {
      await this.database.close();
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
}
