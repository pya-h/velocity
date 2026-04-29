import type { IncomingMessage, ServerResponse } from 'http';
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
  CookieOptions, UploadedFile, UploadOptions,
  OnRequestHook, OnResponseHook, OnErrorHook,
  WebSocketMetadata,
} from '../types';
import { GO_METADATA_KEY, GoMethodDef } from '../decorators/go';
import { FN_METADATA_KEY, FnDef, parseFunctionCall, parseFnArgs } from '../decorators/fn';
import { WEBSOCKET_METADATA_KEY, WS_COMMANDS_KEY, WS_COMMAND_ELSE_KEY } from '../decorators/websocket';
import type { WsCommandDef } from '../decorators/websocket';
import type { WsResponse } from '../types';
import { Validator } from '../validation/validator';
import { compileFrame, CompiledFrame, FrameTemplate } from './frame';
import { RESPONSE_FRAME_KEY } from '../decorators/response-frame';

const CONTROLLER_METADATA_KEY = Symbol.for('controller');
const ROUTES_METADATA_KEY = Symbol.for('routes');
const SERVICE_METADATA_KEY = Symbol.for('service');

// ─── Param-name injection ────────────────────────────────────────────────────
// Parse handler parameter names from fn.toString() — runs once per route at startup.
// Works because server-side code is never minified (param names survive TS compilation).

const INJECTABLE_MAP: Record<string, string> = {
  body: 'body',
  param: 'params', params: 'params',
  query: 'query',
  cookie: 'cookies', cookies: 'cookies',
  signedCookies: 'signedCookies', signedCookie: 'signedCookies',
  header: 'headers', headers: 'headers',
  file: 'files', files: 'files',
  user: 'user',
  session: 'session',
  req: 'req', request: 'req',
  res: 'res', response: 'res',
};

type ArgBuilder = (req: VelocityRequest, res: VelocityResponse) => any;

const ARG_BUILDER_MAP: Record<string, ArgBuilder> = {
  body:    (req) => req.body,
  params:  (req) => req.params,
  query:   (req) => req.query,
  cookies: (req) => req.cookies,
  signedCookies: (req) => req.signedCookies,
  headers: (req) => req.headers,
  files:   (req) => req.files,
  user:    (req) => req.user,
  session: (req) => req.session,
  req:     (req) => req,
  res:     (_, res) => res,
};

function parseHandlerParamNames(fn: Function): string[] {
  const src = fn.toString();
  const match = src.match(/^[^(]*\(([^)]*)\)/);
  if (!match || !match[1].trim()) return [];
  return match[1].split(',')
    .map(p => {
      const trimmed = p.trim();
      if (!trimmed || trimmed.startsWith('{') || trimmed.startsWith('[')) return null;
      // Strip rest operator, then extract name before : = or whitespace
      const name = trimmed.replace(/^\.\.\./, '').split(/[\s:=]/)[0];
      return name || null;
    })
    .filter(Boolean) as string[];
}

function resolveInjectable(name: string): string | null {
  const clean = name.replace(/^_+/, ''); // strip leading underscores (_req → req)
  return INJECTABLE_MAP[clean] || null;
}

// Shared response methods — allocated once, assigned by reference (no per-request closures)
function _resJson(this: VelocityResponse, data: any) {
  this.setHeader('Content-Type', 'application/json');
  this.end(JSON.stringify(data));
}
function _resStatus(this: VelocityResponse, code: number) {
  this.statusCode = code;
  return this;
}
function _resSend(this: VelocityResponse, data: any) {
  if (typeof data === 'string') {
    this.setHeader('Content-Type', 'text/plain');
    this.end(data);
  } else {
    this.json(data);
  }
}

// ─── Cookie signing (HMAC-SHA256) ────────────────────────────────────────────

import { createHmac, timingSafeEqual } from 'crypto';

function _signValue(value: string, secret: string): string {
  const sig = createHmac('sha256', secret).update(value).digest('base64url');
  return `${value}.${sig}`;
}

function _unsignValue(signed: string, secret: string): string | false {
  const dot = signed.lastIndexOf('.');
  if (dot === -1) return false;
  const value = signed.slice(0, dot);
  const sig = signed.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(value).digest('base64url');
  // Timing-safe comparison to prevent timing attacks
  try {
    if (sig.length !== expected.length) return false;
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  } catch { return false; }
  return value;
}

// ─── Cookie helpers ──────────────────────────────────────────────────────────

/** Bound to each VelocityResponse — captures `cookieSecret` from app config. */
let _cookieSecret: string | undefined;

function _resCookie(this: VelocityResponse, name: string, value: string, options?: CookieOptions) {
  const finalValue = (options?.signed && _cookieSecret) ? _signValue(value, _cookieSecret) : value;
  let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(finalValue)}`;
  if (options?.maxAge !== undefined) cookie += `; Max-Age=${options.maxAge}`;
  if (options?.expires) cookie += `; Expires=${options.expires.toUTCString()}`;
  if (options?.path) cookie += `; Path=${options.path}`;
  if (options?.domain) cookie += `; Domain=${options.domain}`;
  if (options?.secure) cookie += '; Secure';
  if (options?.httpOnly) cookie += '; HttpOnly';
  if (options?.sameSite) cookie += `; SameSite=${options.sameSite}`;
  const existing = this.getHeader('Set-Cookie');
  const cookies = existing
    ? (Array.isArray(existing) ? [...existing, cookie] : [existing as string, cookie])
    : cookie;
  this.setHeader('Set-Cookie', cookies);
  return this;
}

function _resClearCookie(this: VelocityResponse, name: string, options?: Omit<CookieOptions, 'maxAge' | 'expires'>) {
  return this.setCookie(name, '', { ...options, maxAge: 0 });
}

function _parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const key = decodeURIComponent(pair.slice(0, eq).trim());
    const val = decodeURIComponent(pair.slice(eq + 1).trim());
    result[key] = val;
  }
  return result;
}

function _parseSignedCookies(raw: Record<string, string>, secret: string): Record<string, string | false> {
  const result: Record<string, string | false> = {};
  for (const [key, val] of Object.entries(raw)) {
    result[key] = _unsignValue(val, secret);
  }
  return result;
}

interface PendingRegistration {
  target: any;
  options: RegisterOptions;
}

type CompiledRouteHandler = (req: VelocityRequest, res: VelocityResponse) => Promise<void>;

interface CompiledWsGateway {
  instance: unknown;
  /** If the gateway has onMessage — use it directly (approach A). */
  hasManualHandler: boolean;
  /** Compiled command dispatch map (approach B). */
  commands: Map<string, string> | null;
  /** @CommandElse method name. */
  commandElse: string | null;
}

interface TrieNode {
  children: Map<string, TrieNode>;
  paramChild: { name: string; node: TrieNode } | null;
  handlers: Map<string, { route: RouteMetadata; controller: any; compiled: CompiledRouteHandler }>;
}

export class VelocityApplication {
  private server: any;
  private container: Container;
  private logger: Logger;
  private config: Config;
  private controllers: Map<string, any> = new Map();
  private routes: Map<string, RouteMetadata[]> = new Map();
  private functionRegistry = new Map<string, { instance: any; method: string }>();
  private routerTrie: TrieNode = { children: new Map(), paramChild: null, handlers: new Map() };
  private databases: Database[] = [];

  private pendingServices: PendingRegistration[] = [];
  private pendingControllers: PendingRegistration[] = [];
  private controllerContainers = new Map<any, Container>();
  private controllerPaths = new Map<any, string>();
  private fileMounts = new Map<string, string>();
  private dirMounts: { prefix: string; dir: string }[] = [];
  private goServiceClasses: any[] = [];
  private activeRequests = 0;
  private ready = false;
  private corsPrecomputed: {
    isArrayOrigin: boolean;
    /** For single-origin: the fixed origin. For array-origin: the fallback. */
    singleOrigin: string;
    /** For array-origin: O(1) lookup set. */
    originSet: Set<string> | null;
    /** [name, value] tuples for headers that never change per-request. */
    fixedHeaders: [string, string][];
    /** Same as fixedHeaders but as an object — used by Bun static responses. */
    fixedHeadersObj: Record<string, string>;
  } | null = null;
  private _onRequest: OnRequestHook[] = [];
  private _onResponse: OnResponseHook[] = [];
  private _onError: OnErrorHook[] = [];
  private wsGateways = new Map<string, CompiledWsGateway>();
  private pendingWsGateways: any[] = [];
  private compressionEnabled = false;
  private compressionThreshold = 1024;
  private globalFrame: CompiledFrame | null = null;

  constructor(config?: Partial<ApplicationConfig>) {
    this.container = new Container();
    this.config = new Config(config);
    this.logger = new Logger(this.config.get('logger'));
    _cookieSecret = config?.cookieSecret;

    // Only load node:http on Node.js — Bun uses Bun.serve() and never needs it
    this.server = IS_BUN ? null : require('http').createServer((req: IncomingMessage, res: ServerResponse) => this.handleRequest(req, res));
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
      const wsMeta: WebSocketMetadata = Reflect.getMetadata(WEBSOCKET_METADATA_KEY, target);

      if (controllerMeta) {
        this.pendingControllers.push({ target, options });
      } else if (wsMeta) {
        this.pendingWsGateways.push(target);
      } else if (serviceMeta) {
        this.pendingServices.push({ target, options });
      } else {
        throw new Error(
          `${target.name || target} is not decorated with @Controller, @Service, or @WebSocket`
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
    for (const gwClass of this.pendingWsGateways) {
      this.registerWebSocket(gwClass);
    }
    this.pendingServices.length = 0;
    this.pendingControllers.length = 0;
    this.pendingWsGateways.length = 0;
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
    this.buildTrie();
    this.buildCorsPrecomputed();

    // Init compression config
    const compCfg = this.config.get('compression');
    if (compCfg?.enabled) {
      this.compressionEnabled = true;
      this.compressionThreshold = compCfg.threshold ?? 1024;
    }

    this.ready = true;
    await this.initializeDatabases();

    this.logger.info('Application initialized successfully');

    if (IS_BUN) {
      const bunServeOpts: any = {
        port: finalPort,
        hostname: finalHost,
        fetch: (request: Request, server: any) => this.bunFetchHandler(request, server),
      };

      // Wire WebSocket gateways into Bun.serve()
      if (this.wsGateways.size > 0) {
        const gateways = this.wsGateways;
        bunServeOpts.websocket = {
          open: (ws: any) => {
            const gw = gateways.get(ws.data?.__wsPath);
            if (!gw) return;
            const inst = gw.instance as any;
            if (inst.onOpen) inst.onOpen(ws);
          },
          message: (ws: any, message: any) => {
            const gw = gateways.get(ws.data?.__wsPath);
            if (!gw) return;
            const inst = gw.instance as any;

            // Approach A: manual onMessage handler — pass raw message
            if (gw.hasManualHandler) {
              inst.onMessage(ws, message);
              return;
            }

            // Approach B: @Command dispatch — parse { cmd, data } JSON
            if (!gw.commands) return;
            let parsed: { cmd?: string; data?: unknown };
            try {
              const text = typeof message === 'string' ? message : message.toString();
              parsed = JSON.parse(text);
            } catch {
              const resp: WsResponse = { ok: false, cmd: '', data: null, error: 'Invalid JSON' };
              ws.send(JSON.stringify(resp));
              return;
            }

            const cmd = parsed.cmd || '';
            const cmdData = parsed.data;
            const methodName = gw.commands.get(cmd);

            if (methodName) {
              // Check if handler wants ws client (param-name injection)
              const paramNames = parseHandlerParamNames(inst[methodName]);
              const wantsWs = paramNames.some(n => {
                const clean = n.replace(/^_+/, '');
                return clean === 'ws' || clean === 'client' || clean === 'socket';
              });

              try {
                const result = wantsWs
                  ? inst[methodName](cmdData, ws)
                  : inst[methodName](cmdData);

                // If handler returns a value and didn't use ws directly, send structured response
                Promise.resolve(result).then((val: unknown) => {
                  if (!wantsWs && val !== undefined) {
                    const resp: WsResponse = { ok: true, cmd, data: val, error: null };
                    ws.send(JSON.stringify(resp));
                  }
                }).catch((err: Error) => {
                  const resp: WsResponse = { ok: false, cmd, data: null, error: err.message };
                  ws.send(JSON.stringify(resp));
                });
              } catch (err: any) {
                const resp: WsResponse = { ok: false, cmd, data: null, error: err.message };
                ws.send(JSON.stringify(resp));
              }
            } else if (gw.commandElse) {
              try {
                const result = inst[gw.commandElse](cmd, cmdData, ws);
                Promise.resolve(result).then((val: unknown) => {
                  if (val !== undefined) {
                    const resp: WsResponse = { ok: true, cmd, data: val, error: null };
                    ws.send(JSON.stringify(resp));
                  }
                }).catch((err: Error) => {
                  const resp: WsResponse = { ok: false, cmd, data: null, error: err.message };
                  ws.send(JSON.stringify(resp));
                });
              } catch (err: any) {
                const resp: WsResponse = { ok: false, cmd, data: null, error: err.message };
                ws.send(JSON.stringify(resp));
              }
            } else {
              const resp: WsResponse = { ok: false, cmd, data: null, error: `Unknown command: ${cmd}` };
              ws.send(JSON.stringify(resp));
            }
          },
          close: (ws: any, code: number, reason: string) => {
            const gw = gateways.get(ws.data?.__wsPath);
            if (!gw) return;
            const inst = gw.instance as any;
            if (inst.onClose) inst.onClose(ws, code, reason);
          },
        };
      }

      this.server = Bun.serve(bunServeOpts);
      this.logger.info(`Server running on http://${finalHost}:${finalPort}`);
      this.startGoMethods();
      this.maybeRegisterSignalHandlers();
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
        this.maybeRegisterSignalHandlers();
        resolve();
      });
    });
  }

  public async close(): Promise<void> {
    this.logger.info('Shutting down gracefully...');
    const timeout = this.config.get('shutdown')?.timeout ?? 5000;

    for (const db of this.databases) {
      await db.close();
    }

    if (IS_BUN) {
      this.server?.stop(false); // stop accepting; existing requests keep processing
      await this.waitForDrain(timeout);
      this.logger.info('Server closed');
      return;
    }

    this.server.close(); // stop accepting new connections
    await this.waitForDrain(timeout);
    this.logger.info('Server closed');
  }

  private waitForDrain(timeout: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.activeRequests <= 0) { resolve(); return; }
      const deadline = Date.now() + timeout;
      const iv = setInterval(() => {
        if (this.activeRequests <= 0 || Date.now() >= deadline) {
          clearInterval(iv);
          if (this.activeRequests > 0) {
            this.logger.warn(
              `Shutdown: ${this.activeRequests} in-flight request(s) still active after ${timeout}ms — proceeding anyway`,
            );
          }
          resolve();
        }
      }, 50);
    });
  }

  private maybeRegisterSignalHandlers(): void {
    if (!this.config.get('shutdown')?.auto) return;
    const handler = () => {
      this.close().then(() => process.exit(0)).catch(() => process.exit(1));
    };
    process.once('SIGTERM', handler);
    process.once('SIGINT', handler);
  }

  /**
   * Initializes registrations and builds the route trie without starting a server.
   * Idempotent — safe to call multiple times. Intended for use in tests via TestUtils.makeRequest().
   */
  public async prepareForTesting(): Promise<this> {
    if (this.ready) return this;
    this.initializeRegistrations();
    this.buildTrie();
    this.buildCorsPrecomputed();
    const compCfg = this.config.get('compression');
    if (compCfg?.enabled) {
      this.compressionEnabled = true;
      this.compressionThreshold = compCfg.threshold ?? 1024;
    }
    this.ready = true;
    return this;
  }

  public getContainer(): Container {
    return this.container;
  }

  // ─── Lifecycle hooks ───

  public onRequest(hook: OnRequestHook): this { this._onRequest.push(hook); return this; }
  public onResponse(hook: OnResponseHook): this { this._onResponse.push(hook); return this; }
  public onError(hook: OnErrorHook): this { this._onError.push(hook); return this; }

  // ─── Response framing ───

  public responseFrame(template: FrameTemplate): this {
    this.globalFrame = compileFrame(template);
    return this;
  }

  // ─── WebSocket registration ───

  public registerWebSocket(gatewayClass: any): this {
    const meta: WebSocketMetadata = Reflect.getMetadata(WEBSOCKET_METADATA_KEY, gatewayClass);
    if (!meta) throw new Error(`${gatewayClass.name} is not decorated with @WebSocket`);
    const instance: any = this.container.resolve(gatewayClass);

    const hasManualHandler = typeof instance.onMessage === 'function';

    // Compile @Command map (approach B) — only used if no onMessage
    let commands: Map<string, string> | null = null;
    let commandElse: string | null = null;

    if (!hasManualHandler) {
      const defs: WsCommandDef[] = Reflect.getMetadata(WS_COMMANDS_KEY, gatewayClass) || [];
      if (defs.length > 0) {
        commands = new Map();
        for (const def of defs) commands.set(def.name, def.method);
      }
      const elseFn: string | undefined = Reflect.getMetadata(WS_COMMAND_ELSE_KEY, gatewayClass);
      if (elseFn) commandElse = elseFn;
    }

    this.wsGateways.set(meta.path, { instance, hasManualHandler, commands, commandElse });
    this.logger.info(`Registered WebSocket gateway: ${gatewayClass.name} at ${meta.path}` +
      (commands ? ` (${commands.size} commands)` : hasManualHandler ? ' (manual onMessage)' : ''));
    return this;
  }

  // ─── Request handling ───

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Track in-flight requests for graceful shutdown (Bun path tracks in bunFetchHandler)
    if (!(req as any).__bunSkipStatic) {
      this.activeRequests++;
      let counted = true;
      const done = () => { if (counted) { counted = false; this.activeRequests--; } };
      res.on('finish', done);
      res.on('close', done);
    }

    const velocityReq = req as VelocityRequest;
    const velocityRes = this.enhanceResponse(res);

    try {
      // Lifecycle: onRequest hooks
      for (const hook of this._onRequest) await hook(velocityReq);

      const url: URL = (req as any).__parsedUrl || new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;
      const method = req.method?.toUpperCase() || 'GET';

      // Cookie parsing — lazy, only allocates on first access
      const rawCookieHeader = (req.headers.cookie ?? req.headers.Cookie) as string | undefined;
      Object.defineProperty(velocityReq, 'cookies', {
        get() {
          const val = _parseCookies(rawCookieHeader);
          Object.defineProperty(this, 'cookies', { value: val, writable: true, enumerable: true, configurable: true });
          return val;
        },
        enumerable: true,
        configurable: true,
      });
      if (_cookieSecret) {
        Object.defineProperty(velocityReq, 'signedCookies', {
          get() {
            const raw = _parseCookies(rawCookieHeader);
            const val = _parseSignedCookies(raw, _cookieSecret!);
            Object.defineProperty(this, 'signedCookies', { value: val, writable: true, enumerable: true, configurable: true });
            return val;
          },
          enumerable: true,
          configurable: true,
        });
      }

      if (this.corsPrecomputed) {
        const cors = this.corsPrecomputed;
        for (const [k, v] of cors.fixedHeaders) res.setHeader(k, v);
        if (cors.isArrayOrigin) {
          const reqOrigin = (req.headers.origin as string) || '';
          res.setHeader('Access-Control-Allow-Origin', cors.originSet!.has(reqOrigin) ? reqOrigin : cors.singleOrigin);
        }
        if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      }

      if (method === 'GET' && !(req as any).__bunSkipStatic && this.tryServeStatic(pathname, res)) return;

      // Lazy query parsing — only allocates when handler accesses req.query
      Object.defineProperty(velocityReq, 'query', {
        get() {
          const val = Object.fromEntries(url.searchParams);
          Object.defineProperty(this, 'query', { value: val, writable: true, enumerable: true, configurable: true });
          return val;
        },
        enumerable: true,
        configurable: true,
      });

      if (pathname.startsWith('/.')) {
        await this.dispatchFunction(pathname, velocityReq, velocityRes);
        // Lifecycle: onResponse hooks
        for (const hook of this._onResponse) await hook(velocityReq, velocityRes);
        return;
      }

      const match = this.findRoute(pathname || '/', method);

      if (!match) {
        velocityRes.status(404).json({ error: 'Route not found' });
        for (const hook of this._onResponse) await hook(velocityReq, velocityRes);
        return;
      }

      velocityReq.params = match.params;

      // Compiled handler includes body parsing, guards, middleware, interceptors, error handling
      await match.compiled(velocityReq, velocityRes);

      // Lifecycle: onResponse hooks
      for (const hook of this._onResponse) await hook(velocityReq, velocityRes);

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (this._onError.length > 0) {
        for (const hook of this._onError) await hook(err, velocityReq, velocityRes);
      } else {
        this.logger.error('Request handling error:', error);
        if (!velocityRes.headersSent) {
          velocityRes.status(500).json({
            error: 'Internal Server Error',
            message: err.message,
          });
        }
      }
    }
  }

  private enhanceResponse(res: ServerResponse): VelocityResponse {
    const velocityRes = res as VelocityResponse;
    velocityRes.json = _resJson;
    velocityRes.status = _resStatus;
    velocityRes.send = _resSend;
    velocityRes.setCookie = _resCookie;
    velocityRes.clearCookie = _resClearCookie;
    return velocityRes;
  }

  private async parseBody(req: IncomingMessage, uploadOpts?: UploadOptions): Promise<any> {
    const maxSize = uploadOpts?.maxSize || 1024 * 1024; // default 1 MB, overridable per route
    const bunReq: Request | undefined = (req as any).__bunNativeRequest;

    if (bunReq) {
      const cl = parseInt(bunReq.headers.get('content-length') || '0', 10);
      if (cl > maxSize) throw new Error('Request body too large');
      const ct = bunReq.headers.get('content-type') || '';

      // Multipart: use native formData() on Bun
      if (ct.includes('multipart/form-data')) {
        return this.parseMultipartBun(bunReq, req as any, uploadOpts);
      }
      if (ct.includes('application/json')) return bunReq.json().catch(() => ({}));
      return bunReq.text().catch(() => '');
    }

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;

      req.on('data', (chunk: Buffer | string) => {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        size += buf.length;
        if (size > maxSize) {
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

  private async parseMultipartBun(bunReq: Request, velocityReq: VelocityRequest, opts?: UploadOptions): Promise<any> {
    const formData = await bunReq.formData();
    const body: Record<string, any> = {};
    const files: Record<string, UploadedFile | UploadedFile[]> = {};
    let fileCount = 0;
    const maxFiles = opts?.maxFiles ?? Infinity;

    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        if (++fileCount > maxFiles) throw new Error(`Too many files (max ${maxFiles})`);
        const buf = Buffer.from(await value.arrayBuffer());
        const file: UploadedFile = {
          fieldname: key,
          originalname: value.name,
          mimetype: value.type,
          size: buf.length,
          buffer: buf,
        };
        const existing = files[key];
        if (existing) {
          files[key] = Array.isArray(existing) ? [...existing, file] : [existing, file];
        } else {
          files[key] = file;
        }
      } else {
        body[key] = value;
      }
    }

    velocityReq.files = files;
    return body;
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

  private insertRoute(pattern: string, method: string, route: RouteMetadata, controller: any): void {
    const parts = pattern.split('/').filter(p => p !== '');
    let node = this.routerTrie;
    for (const part of parts) {
      if (part.startsWith(':')) {
        const name = part.slice(1);
        if (!node.paramChild) {
          node.paramChild = { name, node: { children: new Map(), paramChild: null, handlers: new Map() } };
        } else if (node.paramChild.name !== name) {
          this.logger.warn(`Router: conflicting param names ":${node.paramChild.name}" and ":${name}" at same path level — using ":${node.paramChild.name}"`);
        }
        node = node.paramChild.node;
      } else {
        if (!node.children.has(part)) {
          node.children.set(part, { children: new Map(), paramChild: null, handlers: new Map() });
        }
        node = node.children.get(part)!;
      }
    }
    const compiled = this.compileRouteHandler(controller, route, method);
    node.handlers.set(method, { route, controller, compiled });
  }

  private buildTrie(): void {
    this.routerTrie = { children: new Map(), paramChild: null, handlers: new Map() };
    for (const [basePath, routes] of this.routes.entries()) {
      const controller = this.controllers.get(basePath);
      for (const route of routes) {
        this.insertRoute(basePath + route.path, route.method, route, controller);
      }
    }
  }

  private buildCorsPrecomputed(): void {
    const corsConfig = this.config.get('cors');
    if (!corsConfig) { this.corsPrecomputed = null; return; }

    const isArray = Array.isArray(corsConfig.origin);
    const fixed: [string, string][] = [];
    const fixedObj: Record<string, string> = {};

    if (!isArray) {
      fixed.push(['Access-Control-Allow-Origin', corsConfig.origin as string]);
      fixedObj['Access-Control-Allow-Origin'] = corsConfig.origin as string;
    } else {
      fixed.push(['Vary', 'Origin']);
      fixedObj['Vary'] = 'Origin';
    }
    fixed.push(['Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS']);
    fixedObj['Access-Control-Allow-Methods'] = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
    fixed.push(['Access-Control-Allow-Headers', 'Content-Type,Authorization']);
    fixedObj['Access-Control-Allow-Headers'] = 'Content-Type,Authorization';
    if (corsConfig.credentials) {
      fixed.push(['Access-Control-Allow-Credentials', 'true']);
      fixedObj['Access-Control-Allow-Credentials'] = 'true';
    }

    this.corsPrecomputed = {
      isArrayOrigin: isArray,
      singleOrigin: isArray ? ((corsConfig.origin as string[])[0] || '') : (corsConfig.origin as string),
      originSet: isArray ? new Set(corsConfig.origin as string[]) : null,
      fixedHeaders: fixed,
      fixedHeadersObj: fixedObj,
    };
  }

  private compileRouteHandler(
    controller: any,
    route: RouteMetadata,
    httpMethod: string,
  ): CompiledRouteHandler {
    const method = route.handler;
    const guards = route.guards?.length ? route.guards : null;
    const middlewares = route.middlewares?.length ? route.middlewares : null;
    const interceptors = route.interceptors?.length ? route.interceptors : null;
    const uploadOpts = route.upload;
    const logger = this.logger;

    // ── Param-name injection (once per route at startup) ──
    const paramNames = parseHandlerParamNames(controller[method]);
    const injections = paramNames.map(n => resolveInjectable(n));
    const argBuilders: ArgBuilder[] = injections.map(key =>
      key ? (ARG_BUILDER_MAP[key] || (() => undefined)) : (() => undefined)
    );

    // Only parse body if HTTP method supports it AND handler uses body or req
    const isBodyMethod = httpMethod === 'POST' || httpMethod === 'PUT' || httpMethod === 'PATCH';
    const handlerUsesBody = injections.includes('body') || injections.includes('req');
    const parseBody = (isBodyMethod && handlerUsesBody) ? this.parseBody.bind(this) : null;

    // Validation: from @Validate schema on route, or DTO class with static `schema`
    let validationSchema: any = route.schema || null;
    if (!validationSchema) {
      const bodyIdx = injections.indexOf('body');
      if (bodyIdx !== -1) {
        const paramTypes = Reflect.getMetadata('design:paramtypes', Object.getPrototypeOf(controller), method) || [];
        const DtoClass = paramTypes[bodyIdx];
        if (DtoClass?.schema) validationSchema = DtoClass.schema;
      }
    }

    // Build args for the handler call
    const hasArgs = argBuilders.length > 0;
    const callHandler = hasArgs
      ? (req: VelocityRequest, res: VelocityResponse) =>
          controller[method](...argBuilders.map(fn => fn(req, res)))
      : () => controller[method]();

    // @Status decorator: override default 200
    const defaultStatus = route.statusCode || 0; // 0 = use framework default (200/204)

    // ResponseFrame: controller-level overrides global
    const ctrlFrame = Reflect.getMetadata(RESPONSE_FRAME_KEY, controller.constructor);
    const frame: CompiledFrame | null = ctrlFrame ? compileFrame(ctrlFrame) : this.globalFrame;

    // Send response helper — applies @Status and ResponseFrame
    const sendResult = (res: VelocityResponse, result: unknown) => {
      if (res.headersSent) return;
      const status = defaultStatus || (result !== undefined ? 200 : 204);
      if (frame && result !== undefined) {
        res.statusCode = status;
        res.json(frame.success(status, result));
      } else if (result !== undefined) {
        if (defaultStatus) res.statusCode = defaultStatus;
        res.json(result);
      } else {
        res.status(status).send('');
      }
    };

    // Error handler — applies onError hooks, or ResponseFrame error path, or default 500
    const onErrorHooks = this._onError;
    const handleError = async (req: VelocityRequest, res: VelocityResponse, error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      if (onErrorHooks.length > 0) {
        for (const hook of onErrorHooks) await hook(err, req, res);
      } else {
        logger.error('Request handling error:', error);
        if (res.headersSent) return;
        if (frame) {
          res.statusCode = 500;
          res.json(frame.error(500, err.message));
        } else {
          res.status(500).json({ error: 'Internal Server Error', message: err.message });
        }
      }
    };

    // Fast path: no body, no guards, no middleware, no interceptors, no validation
    if (!guards && !middlewares && !interceptors && !parseBody && !validationSchema) {
      return async (req, res) => {
        try {
          const result = await callHandler(req, res);
          sendResult(res, result);
        } catch (error) {
          await handleError(req, res, error);
        }
      };
    }

    // General path
    return async (req, res) => {
      try {
        if (parseBody) req.body = await parseBody(req as any, uploadOpts);
        // Validate body (from @Validate or DTO static schema)
        if (validationSchema && req.body !== undefined) {
          const { error, value } = Validator.validate(validationSchema, req.body);
          if (error) {
            if (!res.headersSent) {
              if (frame) {
                res.statusCode = 400;
                res.json(frame.error(400, error));
              } else {
                res.status(400).json({ error: 'Validation failed', message: error });
              }
            }
            return;
          }
          req.body = value; // apply Joi coercion
        }
        // Guards run before middleware — return 403 if any guard rejects
        if (guards) {
          for (const guard of guards) {
            const allowed = await guard(req);
            if (!allowed) {
              if (!res.headersSent) {
                if (frame) {
                  res.statusCode = 403;
                  res.json(frame.error(403, 'Forbidden'));
                } else {
                  res.status(403).json({ error: 'Forbidden' });
                }
              }
              return;
            }
          }
        }
        if (middlewares) {
          for (const mw of middlewares) {
            let nextCalled = false;
            await mw(req, res, () => { nextCalled = true; });
            if (!nextCalled) {
              if (!res.headersSent) res.status(500).json({ error: 'Middleware did not send a response' });
              return;
            }
          }
        }
        const result = await callHandler(req, res);
        let finalResult = result;
        if (interceptors) {
          for (const ic of interceptors) finalResult = await ic(finalResult, req, res);
        }
        sendResult(res, finalResult);
      } catch (error) {
        await handleError(req, res, error);
      }
    };
  }

  private walkTrie(node: TrieNode, parts: string[], index: number, params: Record<string, string>): TrieNode | null {
    if (index === parts.length) return node;
    const segment = parts[index];

    const literalChild = node.children.get(segment);
    if (literalChild) {
      if (!node.paramChild) {
        // Only literal child — no param fallback, skip the copy
        return this.walkTrie(literalChild, parts, index + 1, params);
      }
      // Both literal and param exist at this depth — copy for rollback safety
      const literalParams = { ...params };
      const result = this.walkTrie(literalChild, parts, index + 1, literalParams);
      if (result) {
        Object.assign(params, literalParams);
        return result;
      }
    }

    if (node.paramChild) {
      params[node.paramChild.name] = segment;
      return this.walkTrie(node.paramChild.node, parts, index + 1, params);
    }

    return null;
  }

  private findRoute(pathname: string, method: string): { compiled: CompiledRouteHandler; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter(p => p !== '');
    const params: Record<string, string> = {};
    const node = this.walkTrie(this.routerTrie, parts, 0, params);
    if (!node) return null;
    const handler = node.handlers.get(method);
    if (!handler) return null;
    return { compiled: handler.compiled, params };
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

  private async bunFetchHandler(request: Request, server?: any): Promise<Response> {
    const reqUrl = new URL(request.url);
    const pathname = reqUrl.pathname;

    // WebSocket upgrade — must happen before activeRequests tracking
    if (server && this.wsGateways.has(pathname)) {
      const upgraded = server.upgrade(request, { data: { __wsPath: pathname } });
      if (upgraded) return undefined as any; // Bun expects no Response on upgrade
    }

    this.activeRequests++;
    try {
      const method = request.method.toUpperCase();

      if (method === 'GET') {
        const staticResp = this.tryServeStaticBun(pathname, request.headers);
        if (staticResp) return staticResp;
      }

      const { req, res, getResponse } = this.createBunReqRes(request, reqUrl);
      await this.handleRequest(req, res);
      return getResponse();
    } finally {
      this.activeRequests--;
    }
  }

  private tryServeStaticBun(pathname: string, requestHeaders: Headers): Response | null {
    const getMime = (fp: string) =>
      VelocityApplication.MIME[fsPath.extname(fp).toLowerCase()] || 'application/octet-stream';

    const buildHeaders = (fp: string): Record<string, string> => {
      const h: Record<string, string> = { 'Content-Type': getMime(fp) };
      if (this.corsPrecomputed) {
        Object.assign(h, this.corsPrecomputed.fixedHeadersObj);
        if (this.corsPrecomputed.isArrayOrigin) {
          const origin = requestHeaders.get('origin') || '';
          h['Access-Control-Allow-Origin'] = this.corsPrecomputed.originSet!.has(origin) ? origin : this.corsPrecomputed.singleOrigin;
        }
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
    // Lazy header access — fetch from native Headers on demand instead of copying all upfront
    const nativeHeaders = request.headers;
    const headersCache: Record<string, string | undefined> = {};
    const headers = new Proxy(headersCache, {
      get(cache, key: string | symbol) {
        if (typeof key === 'symbol') return undefined;
        if (key in cache) return cache[key];
        const v = nativeHeaders.get(key);
        const result = v ?? undefined;
        cache[key] = result;
        return result;
      },
      has(_, key: string | symbol) {
        if (typeof key === 'symbol') return false;
        return nativeHeaders.has(key as string);
      },
      ownKeys() {
        const keys: string[] = [];
        nativeHeaders.forEach((_, k) => keys.push(k));
        return keys;
      },
      getOwnPropertyDescriptor(cache, key: string | symbol) {
        if (typeof key === 'symbol') return undefined;
        if (!(key in cache)) {
          const v = nativeHeaders.get(key as string);
          cache[key as string] = v ?? undefined;
        }
        return { value: cache[key as string], writable: true, enumerable: true, configurable: true };
      },
    });

    const req: any = {
      url: url.pathname + (url.search || ''),
      method: request.method,
      headers,
      __bunNativeRequest: request,
      __bunSkipStatic: true,
      __parsedUrl: url,
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
      json: _resJson,
      status: _resStatus,
      send: _resSend,
      setCookie: _resCookie,
      clearCookie: _resClearCookie,
    };

    const res = rawRes as unknown as VelocityResponse;
    const compress = this.compressionEnabled;
    const threshold = this.compressionThreshold;
    const acceptEnc = request.headers.get('accept-encoding') || '';

    const getResponse = (): Response => {
      // Response compression (gzip) — Bun path
      if (compress && _body && _body.length >= threshold && acceptEnc.includes('gzip')) {
        const ct = _headers['content-type'] || '';
        // Only compress text-based responses
        if (ct.includes('json') || ct.includes('text') || ct.includes('javascript') || ct.includes('xml')) {
          const compressed = Bun.gzipSync(Buffer.from(_body));
          _headers['content-encoding'] = 'gzip';
          _headers['vary'] = 'Accept-Encoding';
          return new Response(compressed, { status: _status, headers: _headers });
        }
      }
      return new Response(_body || null, { status: _status, headers: _headers });
    };

    return { req: req as VelocityRequest, res, getResponse };
  }
}
