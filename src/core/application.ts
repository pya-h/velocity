import { createServer, IncomingMessage, ServerResponse } from 'http';
import * as fs from 'fs';
import * as fsPath from 'path';

const IS_BUN = typeof Bun !== 'undefined';
import { Container } from './container';
import { Logger } from '../logging/logger';
import { Config } from '../config/config';
import { Database, _setCurrentApp } from '../orm/database';
import {
  VelocityRequest, VelocityResponse, ApplicationConfig,
  RouteMetadata, ControllerMetadata, RegisterOptions,
} from '../types';
import { GO_METADATA_KEY, GoMethodDef } from '../decorators/go';
import { FN_METADATA_KEY, FnDef, parseFunctionCall, parseFnArgs } from '../decorators/fn';

const CONTROLLER_METADATA_KEY = Symbol.for('controller');
const ROUTES_METADATA_KEY = Symbol.for('routes');
const SERVICE_METADATA_KEY = Symbol.for('service');

interface PendingRegistration {
  target: any;
  options: RegisterOptions;
}

interface CompiledRoute {
  regex: RegExp;
  paramNames: string[];
  method: string;
  controller: any;
  route: RouteMetadata;
}

export class VelocityApplication {
  private server: any;
  private container: Container;
  private logger: Logger;
  private config: Config;
  private controllers: Map<string, any> = new Map();
  private routes: Map<string, RouteMetadata[]> = new Map();
  private functionRegistry = new Map<string, { instance: any; method: string }>();
  private compiledRoutes: CompiledRoute[] = [];
  private databases: Database[] = [];

  private pendingServices: PendingRegistration[] = [];
  private pendingControllers: PendingRegistration[] = [];
  private controllerContainers = new Map<any, Container>();
  private controllerPaths = new Map<any, string>();
  private fileMounts = new Map<string, string>();
  private dirMounts: { prefix: string; dir: string }[] = [];
  private goServiceClasses: any[] = [];

  constructor(config?: Partial<ApplicationConfig>) {
    this.container = new Container();
    this.config = new Config(config);
    this.logger = new Logger(this.config.get('logger'));

    this.server = IS_BUN ? null : createServer((req, res) => this.handleRequest(req, res));
    this.setupContainer();
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

  // ─── Static file serving ───

  /** Serve a single file at a URL path. */
  public serve(urlPath: string, filePath: string): this {
    this.fileMounts.set(urlPath, fsPath.isAbsolute(filePath) ? filePath : fsPath.resolve(filePath));
    return this;
  }

  /** Serve a directory of files under a URL prefix. */
  public static(urlPrefix: string, directory: string): this {
    const dir = fsPath.isAbsolute(directory) ? directory : fsPath.resolve(directory);
    this.dirMounts.push({ prefix: urlPrefix.endsWith('/') ? urlPrefix : urlPrefix + '/', dir });
    return this;
  }

  private tryServeStatic(pathname: string, res: ServerResponse): boolean {
    // Single file mounts
    const filePath = this.fileMounts.get(pathname);
    if (filePath) {
      try { if (fs.existsSync(filePath)) { this.sendFile(filePath, res); return true; } }
      catch { /* file gone or permission denied */ }
    }

    // Directory mounts
    for (const mount of this.dirMounts) {
      if (pathname.startsWith(mount.prefix)) {
        const relative = pathname.slice(mount.prefix.length) || 'index.html';
        // Reject obvious traversal attempts before touching the filesystem
        if (relative.includes('\0') || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(relative)) return false;
        const resolved = fsPath.resolve(mount.dir, relative);
        // Resolved path must stay within the mount directory (handles symlinks via realpath)
        try {
          const realDir = fs.realpathSync(mount.dir);
          const realFile = fs.realpathSync(resolved);
          if (!realFile.startsWith(realDir + fsPath.sep) && realFile !== realDir) return false;
          if (fs.statSync(realFile).isFile()) { this.sendFile(realFile, res); return true; }
        } catch { /* file not found or permission denied */ }
      }
    }
    return false;
  }

  private static MIME: Record<string, string> = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain',
    '.pdf': 'application/pdf', '.xml': 'application/xml',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
    '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
  };

  private sendFile(filePath: string, res: ServerResponse): void {
    const mime = VelocityApplication.MIME[fsPath.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); });
    stream.pipe(res);
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

      const goMethods: GoMethodDef[] = Reflect.getMetadata(GO_METADATA_KEY, serviceClass) ?? [];
      if (goMethods.length > 0) this.goServiceClasses.push(serviceClass);
    }
  }

  private registerController(controllerClass: any, options: RegisterOptions): void {
    const controllerMetadata: ControllerMetadata = Reflect.getMetadata(CONTROLLER_METADATA_KEY, controllerClass);
    if (!controllerMetadata) {
      throw new Error(`${controllerClass.name} is not decorated with @Controller`);
    }

    const container = this.controllerContainers.get(controllerClass) || this.container;
    const controller = container.resolve(controllerClass);

    // Deep-clone so per-registration middleware doesn't leak across mounts
    const routesMetadata: RouteMetadata[] = (Reflect.getMetadata(ROUTES_METADATA_KEY, controllerClass) || [])
      .map((r: RouteMetadata) => ({
        ...r,
        middlewares: r.middlewares ? [...r.middlewares] : [],
        interceptors: r.interceptors ? [...r.interceptors] : []
      }));

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

    const fnDefs: FnDef[] = Reflect.getMetadata(FN_METADATA_KEY, controllerClass) ?? [];
    for (const def of fnDefs) {
      if (this.functionRegistry.has(def.name)) {
        this.logger.warn(`@Fn: "/.${def.name}" already registered — overwriting`);
      }
      this.functionRegistry.set(def.name, { instance: controller, method: def.method });
      this.logger.info(`Registered function: /.${def.name} → ${controllerClass.name}.${def.method}`);
    }
  }

  private initializeRegistrations(): void {
    for (const { target, options } of this.pendingServices) {
      this.registerService(target, options);
    }
    this.registerControllersTopological();
    this.pendingServices.length = 0;
    this.pendingControllers.length = 0;
  }

  // Topological sort: parents registered before children; circular nesting detected.
  private registerControllersTopological(): void {
    const dependsOn = new Map<any, Set<any>>();
    const pending = new Map<any, PendingRegistration>();

    for (const reg of this.pendingControllers) {
      pending.set(reg.target, reg);
      dependsOn.set(reg.target, new Set(reg.options.scope?.length ? reg.options.scope : []));
    }

    const registered = new Set<any>();
    const visiting = new Set<any>();

    const visit = (target: any) => {
      if (registered.has(target)) return;
      if (visiting.has(target)) {
        const names = [...visiting].map((t: any) => t.name).join(' → ');
        throw new Error(`Circular controller nesting detected: ${names} → ${target.name}`);
      }

      visiting.add(target);

      const deps = dependsOn.get(target);
      if (deps) {
        for (const dep of deps) {
          if (pending.has(dep)) visit(dep);
          // dep not in pending = already registered or external, skip
        }
      }

      visiting.delete(target);
      const reg = pending.get(target);
      if (reg) this.registerController(reg.target, reg.options);
      registered.add(target);
    };

    for (const target of pending.keys()) visit(target);
  }

  // ─── Path helpers ───

  private resolveControllerPath(controllerClass: any): string {
    const knownPath = this.controllerPaths.get(controllerClass);
    if (knownPath) return knownPath;
    const meta: ControllerMetadata = Reflect.getMetadata(CONTROLLER_METADATA_KEY, controllerClass);
    if (!meta) throw new Error(`${controllerClass.name} is not a @Controller`);
    return this.applyGlobalPrefix(meta.path);
  }

  private applyGlobalPrefix(path: string): string {
    const prefix = this.config.get('globalPrefix');
    if (!prefix) return path;

    const exclusions = this.config.get('globalPrefixExclusions') || [];
    for (const exclusion of exclusions) {
      // Segment boundary match: "/health" excludes "/health" and "/health/check" but not "/healthcheck"
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

  public registerDatabase(database: Database): void {
    this.databases.push(database);
    this.container.register(`db:${database.name}`, database);
    if (database.name === 'default') {
      this.container.register('database', database);
    }
  }

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

    this.initializeRegistrations();
    this.compileRoutes();
    await this.initializeDatabases();

    this.logger.info('Application initialized successfully');

    if (IS_BUN) {
      this.server = Bun.serve({
        port: finalPort,
        hostname: finalHost,
        fetch: (request: Request) => this.bunFetchHandler(request),
      });
      this.logger.info(`Server running on http://${finalHost}:${finalPort}`);
      this.startGoMethods();
      return;
    }

    return new Promise((resolve, reject) => {
      this.server.once('error', (err: NodeJS.ErrnoException) => {
        const msg = err.code === 'EADDRINUSE'
          ? `Port ${finalPort} is already in use`
          : `Failed to start server: ${err.message}`;
        reject(new Error(msg));
      });
      this.server.listen(finalPort, finalHost, () => {
        this.logger.info(`Server running on http://${finalHost}:${finalPort}`);
        this.startGoMethods();
        resolve();
      });
    });
  }

  public async close(): Promise<void> {
    for (const db of this.databases) {
      await db.close();
    }

    if (IS_BUN) {
      this.server?.stop(true);
      this.logger.info('Server closed');
      return;
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

      const corsConfig = this.config.get('cors');
      if (corsConfig) {
        let allowedOrigin: string;
        if (Array.isArray(corsConfig.origin)) {
          // Match request origin against whitelist; fall back to first entry
          const reqOrigin = req.headers.origin || '';
          allowedOrigin = corsConfig.origin.includes(reqOrigin) ? reqOrigin : corsConfig.origin[0] || '';
          res.setHeader('Vary', 'Origin');
        } else {
          allowedOrigin = corsConfig.origin;
        }
        res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
        if (corsConfig.credentials) res.setHeader('Access-Control-Allow-Credentials', 'true');
        if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      }

      if (method === 'GET' && !(req as any).__bunSkipStatic && this.tryServeStatic(pathname, res)) return;

      if (['POST', 'PUT', 'PATCH'].includes(method)) {
        velocityReq.body = await this.parseBody(req);
      }

      velocityReq.query = Object.fromEntries(url.searchParams);

      if (pathname.startsWith('/.')) {
        await this.dispatchFunction(pathname, velocityReq, velocityRes);
        return;
      }

      const { controller, route, params } = this.findRoute(pathname || '/', method);

      if (!controller || !route) {
        velocityRes.status(404).json({ error: 'Route not found' });
        return;
      }

      velocityReq.params = params;

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

      const result = await controller[route.handler](velocityReq, velocityRes);

      let finalResult = result;
      if (route.interceptors) {
        for (const interceptor of route.interceptors) {
          finalResult = await interceptor(finalResult, velocityReq, velocityRes);
        }
      }

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
    const bunReq: Request | undefined = (req as any).__bunNativeRequest;
    if (bunReq) {
      const cl = parseInt(bunReq.headers.get('content-length') || '0', 10);
      if (cl > MAX_BODY_SIZE) throw new Error('Request body too large');
      const ct = bunReq.headers.get('content-type') || '';
      if (ct.includes('application/json')) return bunReq.json().catch(() => ({}));
      return bunReq.text().catch(() => '');
    }

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

  private async dispatchFunction(pathname: string, _req: VelocityRequest, res: VelocityResponse): Promise<void> {
    const call = parseFunctionCall(pathname);
    if (!call) {
      res.status(404).json({ error: 'Route not found' });
      return;
    }

    if (call.rawArgs.length > 2000) {
      res.status(400).json({ error: 'Function argument string too long (max 2000 chars)' });
      return;
    }

    const fn = this.functionRegistry.get(call.name);
    if (!fn) {
      res.status(404).json({ error: `Function "${call.name}" not found` });
      return;
    }

    const args = parseFnArgs(call.rawArgs);
    const result = await fn.instance[fn.method](...args);

    if (!res.headersSent) {
      if (result !== undefined) {
        res.json(result);
      } else {
        res.status(204).send('');
      }
    }
  }

  private compilePattern(pattern: string): { regex: RegExp; paramNames: string[] } {
    const paramNames: string[] = [];
    const parts = pattern.split('/').filter(p => p !== '');

    if (parts.length === 0) {
      return { regex: /^\/$/, paramNames: [] };
    }

    const segments = parts.map(part => {
      if (part.startsWith(':')) {
        const name = part.slice(1);
        paramNames.push(name);
        return `(?<${name}>[^/]+)`;
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });

    return { regex: new RegExp(`^/${segments.join('/')}$`), paramNames };
  }

  private compileRoutes(): void {
    this.compiledRoutes = [];
    for (const [basePath, routes] of this.routes.entries()) {
      const controller = this.controllers.get(basePath);
      for (const route of routes) {
        const { regex, paramNames } = this.compilePattern(basePath + route.path);
        this.compiledRoutes.push({ regex, paramNames, method: route.method, controller, route });
      }
    }
  }

  private findRoute(pathname: string, method: string): { controller: any; route: RouteMetadata; params: Record<string, string> } | { controller: null; route: null; params: {} } {
    for (const cr of this.compiledRoutes) {
      if (cr.method !== method) continue;
      const match = cr.regex.exec(pathname);
      if (match) {
        const params: Record<string, string> = {};
        for (const name of cr.paramNames) {
          params[name] = match.groups![name];
        }
        return { controller: cr.controller, route: cr.route, params };
      }
    }
    return { controller: null, route: null, params: {} };
  }

  // ─── Background goroutines (@Go) ───

  private startGoMethods(): void {
    const ext = __filename.endsWith('.ts') ? '.ts' : '.js';
    const goRunnerPath = fsPath.join(__dirname, '..', 'workers', `go-runner${ext}`);

    for (const serviceClass of this.goServiceClasses) {
      const defs: GoMethodDef[] = Reflect.getMetadata(GO_METADATA_KEY, serviceClass) ?? [];

      for (const def of defs) {
        if (!IS_BUN || !def.file) {
          // Fallback: event-loop concurrency when not on Bun or file detection failed
          if (!IS_BUN) {
            this.logger.warn(`@Go: ${serviceClass.name}.${def.method} — Bun Workers require the Bun runtime. Falling back to event-loop.`);
          } else {
            this.logger.warn(`@Go: ${serviceClass.name}.${def.method} — could not auto-detect source file. Falling back to event-loop.`);
          }
          let instance: any;
          try { instance = this.container.resolve(serviceClass); }
          catch (err) { this.logger.error(`@Go: failed to resolve ${serviceClass.name}`, err as Error); continue; }
          setImmediate(() => {
            Promise.resolve(instance[def.method](def.data)).catch((err: Error) => {
              this.logger.error(`@Go: ${serviceClass.name}.${def.method} crashed`, err);
            });
          });
          continue;
        }

        try {
          const worker = new Worker(goRunnerPath);
          worker.postMessage({
            serviceFile: def.file,
            className: serviceClass.name,
            method: def.method,
            data: def.data,
          });
          worker.addEventListener('message', (e: MessageEvent) => {
            if (e.data?.type === 'error') {
              this.logger.error(`@Go[${serviceClass.name}.${def.method}]: ${e.data.message}`);
            }
          });
          worker.addEventListener('error', (e: ErrorEvent) => {
            this.logger.error(`@Go worker crashed: ${serviceClass.name}.${def.method}`, new Error(e.message));
          });
          this.logger.debug(`@Go: spawned worker thread for ${serviceClass.name}.${def.method}()`);
        } catch (err) {
          this.logger.error(`@Go: failed to spawn worker for ${serviceClass.name}.${def.method}`, err as Error);
        }
      }
    }
  }

  // ─── Bun.serve() adapter ───

  private async bunFetchHandler(request: Request): Promise<Response> {
    const reqUrl = new URL(request.url);
    const pathname = reqUrl.pathname;
    const method = request.method.toUpperCase();

    if (method === 'GET') {
      const staticResp = this.tryServeStaticBun(pathname, request.headers);
      if (staticResp) return staticResp;
    }

    const { req, res, getResponse } = this.createBunReqRes(request, reqUrl);
    await this.handleRequest(req, res);
    return getResponse();
  }

  private tryServeStaticBun(pathname: string, requestHeaders: Headers): Response | null {
    const getMime = (fp: string) =>
      VelocityApplication.MIME[fsPath.extname(fp).toLowerCase()] || 'application/octet-stream';

    const buildHeaders = (fp: string): Record<string, string> => {
      const h: Record<string, string> = { 'Content-Type': getMime(fp) };
      const cors = this.config.get('cors');
      if (cors) {
        const origin = requestHeaders.get('origin') || '';
        const allowed = Array.isArray(cors.origin)
          ? (cors.origin.includes(origin) ? origin : cors.origin[0] || '')
          : cors.origin;
        h['Access-Control-Allow-Origin'] = allowed;
        h['Access-Control-Allow-Methods'] = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
        h['Access-Control-Allow-Headers'] = 'Content-Type,Authorization';
        if (cors.credentials) h['Access-Control-Allow-Credentials'] = 'true';
        if (Array.isArray(cors.origin)) h['Vary'] = 'Origin';
      }
      return h;
    };

    const filePath = this.fileMounts.get(pathname);
    if (filePath) {
      try {
        if (fs.existsSync(filePath)) {
          return new Response(Bun.file(filePath), { headers: buildHeaders(filePath) });
        }
      } catch { /* file gone or permission denied */ }
    }

    for (const mount of this.dirMounts) {
      if (pathname.startsWith(mount.prefix)) {
        const relative = pathname.slice(mount.prefix.length) || 'index.html';
        if (relative.includes('\0') || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(relative)) return null;
        const resolved = fsPath.resolve(mount.dir, relative);
        try {
          const realDir = fs.realpathSync(mount.dir);
          const realFile = fs.realpathSync(resolved);
          if (!realFile.startsWith(realDir + fsPath.sep) && realFile !== realDir) return null;
          if (fs.statSync(realFile).isFile()) {
            return new Response(Bun.file(realFile), { headers: buildHeaders(realFile) });
          }
        } catch { /* file not found or permission denied */ }
      }
    }

    return null;
  }

  private createBunReqRes(
    request: Request,
    url: URL,
  ): { req: VelocityRequest; res: VelocityResponse; getResponse: () => Response } {
    const headers: Record<string, string | string[] | undefined> = {};
    request.headers.forEach((value, key) => { headers[key] = value; });

    const req: any = {
      url: url.pathname + (url.search || ''),
      method: request.method,
      headers,
      __bunNativeRequest: request,
      __bunSkipStatic: true,
    };

    let _status = 200;
    const _headers: Record<string, string> = {};
    let _body = '';
    let _sent = false;

    const rawRes: any = {
      get statusCode() { return _status; },
      set statusCode(v: number) { _status = v; },
      get headersSent() { return _sent; },
      setHeader(name: string, value: string | number | readonly string[]) {
        _headers[name.toLowerCase()] = Array.isArray(value)
          ? (value as string[]).join(', ')
          : String(value);
      },
      getHeader(name: string) { return _headers[name.toLowerCase()]; },
      removeHeader(name: string) { delete _headers[name.toLowerCase()]; },
      writeHead(code: number, hdrs?: Record<string, string | string[]>) {
        _status = code;
        if (hdrs) {
          for (const [k, v] of Object.entries(hdrs)) {
            _headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
          }
        }
        _sent = true;
      },
      end(data?: string) {
        if (data !== undefined && data !== '') _body = data;
        _sent = true;
      },
      write() {},
      on()             { return rawRes; },
      once()           { return rawRes; },
      emit()           { return false; },
      removeListener() { return rawRes; },
    };

    const res = this.enhanceResponse(rawRes as ServerResponse) as VelocityResponse;
    const getResponse = (): Response =>
      new Response(_body || null, { status: _status, headers: _headers });

    return { req: req as VelocityRequest, res, getResponse };
  }
}
