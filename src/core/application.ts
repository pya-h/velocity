import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { Container } from './container';
import { Logger } from '../logging/logger';
import { Config } from '../config/config';
import { Database, _setCurrentApp } from '../orm/database';
import {
  VelocityRequest, VelocityResponse, ApplicationConfig,
  RouteMetadata, ControllerMetadata, RegisterOptions,
  MiddlewareFunction
} from '../types';

const CONTROLLER_METADATA_KEY = Symbol.for('controller');
const ROUTES_METADATA_KEY = Symbol.for('routes');
const SERVICE_METADATA_KEY = Symbol.for('service');

interface PendingRegistration {
  target: any;
  options: RegisterOptions;
}

export class VelocityApplication {
  private server: Server;
  private container: Container;
  private logger: Logger;
  private config: Config;
  private controllers: Map<string, any> = new Map();
  private routes: Map<string, RouteMetadata[]> = new Map();
  private databases: Database[] = [];

  // Deferred registration queues — processed at listen() time
  private pendingServices: PendingRegistration[] = [];
  private pendingControllers: PendingRegistration[] = [];

  // Scoped DI: per-controller child containers
  private controllerContainers = new Map<any, Container>();

  // Track controller class → mounted path for resolveControllerPath
  private controllerPaths = new Map<any, string>();

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

  // ─── Registration API ───

  /**
   * Unified registration method. Accepts any mix of controllers and services,
   * with an optional trailing options object.
   *
   * @example
   *   velo.register(UserController);
   *   velo.register(UserService, PostService);
   *   velo.register(AuthService, { scope: [UserController] });
   *   velo.register(ProfileController, { scope: [UserController] });
   *   velo.register(UserController, PostController, { middleware: [logMiddleware] });
   */
  public register(...args: any[]): this {
    if (args.length === 0) return this;

    // Parse: last arg may be an options object (plain object, not a class)
    let options: RegisterOptions = {};
    let targets: any[];

    const lastArg = args[args.length - 1];
    const isPlainObj = typeof lastArg === 'object' && lastArg !== null
      && Object.getPrototypeOf(lastArg) === Object.prototype;
    if (args.length > 1 && isPlainObj) {
      options = lastArg as RegisterOptions;
      targets = args.slice(0, -1);
    } else {
      targets = args;
    }

    for (const target of targets) {
      const controllerMeta: ControllerMetadata = Reflect.getMetadata(CONTROLLER_METADATA_KEY, target);
      const serviceMeta = Reflect.getMetadata(SERVICE_METADATA_KEY, target);

      if (controllerMeta) {
        this.pendingControllers.push({ target, options });
      } else if (serviceMeta) {
        this.pendingServices.push({ target, options });
      } else {
        throw new Error(
          `${target.name || target} is not decorated with @Controller or @Service`
        );
      }
    }

    return this;
  }

  // ─── Internal registration (called at listen() time) ───

  private registerService(serviceClass: any, options: RegisterOptions): void {
    const serviceMeta = Reflect.getMetadata(SERVICE_METADATA_KEY, serviceClass);
    const name = serviceMeta?.name || serviceClass.name;
    const singleton = options.singleton !== undefined ? options.singleton : true;

    if (options.scope && options.scope.length > 0) {
      // Scoped: register only in specific controller child containers
      for (const scopeTarget of options.scope) {
        const child = this.getOrCreateChildContainer(scopeTarget);
        child.register(serviceClass, serviceClass, singleton);
        if (name) child.register(name, serviceClass, singleton);
      }
      const scopeNames = options.scope.map((s: any) => s.name).join(', ');
      this.logger.info(`Registered scoped service: ${serviceClass.name} → [${scopeNames}]`);
    } else {
      // Global: register in root container
      this.container.register(serviceClass, serviceClass, singleton);
      if (name) this.container.register(name, serviceClass, singleton);
      this.logger.info(`Registered service: ${serviceClass.name}`);
    }
  }

  private registerController(controllerClass: any, options: RegisterOptions): void {
    const controllerMetadata: ControllerMetadata = Reflect.getMetadata(CONTROLLER_METADATA_KEY, controllerClass);
    if (!controllerMetadata) {
      throw new Error(`${controllerClass.name} is not decorated with @Controller`);
    }

    // Resolve the controller instance from its container (child if scoped services exist, else root)
    const container = this.controllerContainers.get(controllerClass) || this.container;
    const controller = container.resolve(controllerClass);

    // Deep-clone route metadata so per-registration middleware doesn't leak across mounts
    const routesMetadata: RouteMetadata[] = (Reflect.getMetadata(ROUTES_METADATA_KEY, controllerClass) || [])
      .map((r: RouteMetadata) => ({
        ...r,
        middlewares: r.middlewares ? [...r.middlewares] : [],
        interceptors: r.interceptors ? [...r.interceptors] : []
      }));

    // Prepend registration-time middleware to each route
    if (options.middleware && options.middleware.length > 0) {
      for (const route of routesMetadata) {
        route.middlewares = [...options.middleware, ...route.middlewares!];
      }
    }

    if (options.scope && options.scope.length > 0) {
      // Controller-on-controller: mount under each scope controller's path
      for (const parentClass of options.scope) {
        const parentMeta: ControllerMetadata = Reflect.getMetadata(CONTROLLER_METADATA_KEY, parentClass);
        if (!parentMeta) {
          throw new Error(`Scope target ${parentClass.name} is not a @Controller`);
        }
        const parentPath = this.resolveControllerPath(parentClass);
        const childPath = options.prefix || controllerMetadata.path;
        const combinedPath = this.joinPaths(parentPath, childPath);

        this.controllers.set(combinedPath, controller);
        this.routes.set(combinedPath, routesMetadata);
        this.controllerPaths.set(controllerClass, combinedPath);
        this.logger.info(
          `Registered controller: ${controllerClass.name} at ${combinedPath} (under ${parentClass.name})`
        );
      }
    } else {
      // Global: mount at root (with optional prefix override and global prefix)
      const controllerPath = options.prefix || controllerMetadata.path;
      const finalPath = this.applyGlobalPrefix(controllerPath);

      this.controllers.set(finalPath, controller);
      this.routes.set(finalPath, routesMetadata);
      this.controllerPaths.set(controllerClass, finalPath);
      this.logger.info(`Registered controller: ${controllerClass.name} at ${finalPath}`);
    }
  }

  /**
   * Process all pending registrations in correct order:
   * 1. Services (so DI is ready)
   * 2. Controllers in topological order (parents before children)
   *    with circular dependency detection
   */
  private initializeRegistrations(): void {
    // 1. Register all services
    for (const { target, options } of this.pendingServices) {
      this.registerService(target, options);
    }

    // 2. Detect circular controller nesting and register in topological order
    this.registerControllersTopological();

    // Clear queues
    this.pendingServices.length = 0;
    this.pendingControllers.length = 0;
  }

  /**
   * Topological sort of pending controllers: parents are registered before children.
   * Detects circular nesting (A scoped to B, B scoped to A).
   */
  private registerControllersTopological(): void {
    // Build adjacency: child → Set<parent classes it depends on>
    const dependsOn = new Map<any, Set<any>>();
    const pending = new Map<any, PendingRegistration>();

    for (const reg of this.pendingControllers) {
      pending.set(reg.target, reg);
      if (reg.options.scope && reg.options.scope.length > 0) {
        dependsOn.set(reg.target, new Set(reg.options.scope));
      } else {
        dependsOn.set(reg.target, new Set());
      }
    }

    const registered = new Set<any>();
    const visiting = new Set<any>();   // cycle detection

    const visit = (target: any) => {
      if (registered.has(target)) return;

      if (visiting.has(target)) {
        // Build cycle path for error message
        const names = [...visiting].map((t: any) => t.name).join(' → ');
        throw new Error(`Circular controller nesting detected: ${names} → ${target.name}`);
      }

      visiting.add(target);

      // Visit dependencies (parent controllers) first
      const deps = dependsOn.get(target);
      if (deps) {
        for (const dep of deps) {
          if (pending.has(dep)) {
            visit(dep);
          }
          // If dep isn't pending, it's either already registered or external — fine
        }
      }

      visiting.delete(target);

      // Now register this controller
      const reg = pending.get(target);
      if (reg) {
        this.registerController(reg.target, reg.options);
      }
      registered.add(target);
    };

    for (const target of pending.keys()) {
      visit(target);
    }
  }

  // ─── Path helpers ───

  /** Resolve the final mounted path for a controller class (already registered) */
  private resolveControllerPath(controllerClass: any): string {
    // Direct lookup from the class → path map (set during registerController)
    const knownPath = this.controllerPaths.get(controllerClass);
    if (knownPath) return knownPath;

    // Not yet mounted — use its decorator path with global prefix
    const meta: ControllerMetadata = Reflect.getMetadata(CONTROLLER_METADATA_KEY, controllerClass);
    if (!meta) throw new Error(`${controllerClass.name} is not a @Controller`);
    return this.applyGlobalPrefix(meta.path);
  }

  private applyGlobalPrefix(path: string): string {
    const prefix = this.config.get('globalPrefix');
    if (!prefix) return path;

    const exclusions = this.config.get('globalPrefixExclusions') || [];
    for (const exclusion of exclusions) {
      // Exact match or match at segment boundary (e.g. "/health" excludes "/health" and "/health/check" but not "/healthcheck")
      if (path === exclusion || path.startsWith(exclusion + '/')) return path;
    }

    return this.joinPaths(prefix, path);
  }

  private joinPaths(base: string, child: string): string {
    const a = base.endsWith('/') ? base.slice(0, -1) : base;
    const b = child.startsWith('/') ? child : '/' + child;
    return a + b;
  }

  private getOrCreateChildContainer(controllerClass: any): Container {
    if (!this.controllerContainers.has(controllerClass)) {
      this.controllerContainers.set(controllerClass, this.container.createChild());
    }
    return this.controllerContainers.get(controllerClass)!;
  }

  // ─── Database registration ───

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

  // ─── Lifecycle ───

  public async listen(port?: number, host?: string): Promise<void> {
    const finalPort = port || this.config.get('port') || 5000;
    const finalHost = host || this.config.get('host') || '0.0.0.0';

    // Process all pending registrations
    this.initializeRegistrations();

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

  // ─── Request handling ───

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const velocityReq = req as VelocityRequest;
    const velocityRes = this.enhanceResponse(res);

    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;
      const method = req.method?.toUpperCase() || 'GET';

      if (['POST', 'PUT', 'PATCH'].includes(method)) {
        velocityReq.body = await this.parseBody(req);
      }

      velocityReq.query = Object.fromEntries(url.searchParams);

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
      const chunks: Buffer[] = [];
      let size = 0;

      req.on('data', (chunk: Buffer | string) => {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        size += buf.length;
        if (size > MAX_BODY_SIZE) {
          req.destroy();
          reject(new Error('Request body too large'));
          return;
        }
        chunks.push(buf);
      });
      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf-8');
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
