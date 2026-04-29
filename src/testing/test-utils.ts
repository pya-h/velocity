import { VeloApplication } from '../core/application';
import { Container } from '../core/container';
import type { ApplicationConfig } from '../types';

export class TestUtils {
  /** Creates a VeloApplication with logging suppressed — suitable for tests. */
  public static createTestApp(config?: Partial<ApplicationConfig>): VeloApplication {
    return new VeloApplication({
      port: 0,
      logger: { level: 'error', format: 'simple', outputs: [] as ('console' | 'file')[] },
      ...config,
    });
  }

  /**
   * Creates a mock request object compatible with VeloApplication's handleRequest().
   *
   * For POST/PUT/PATCH with a `body`, a fake `__bunNativeRequest` is attached so that
   * parseBody() takes the Bun code-path and returns the body synchronously — no stream
   * emulation required.
   */
  public static createMockRequest(options: {
    method?: string;
    url?: string;
    body?: any;
    headers?: Record<string, string>;
    params?: Record<string, string>;
    query?: Record<string, string>;
  } = {}): any {
    const req: any = {
      method: options.method || 'GET',
      url: options.url || '/',
      headers: options.headers || {},
      params: options.params || {},
      query: options.query || {},
      on: (_ev: string, _fn: any) => req,
    };

    if (options.body !== undefined) {
      req.body = options.body; // pre-set for direct method calls (bypassing handleRequest)
    }

    // Always provide __bunNativeRequest so handleRequest's parseBody() uses the Bun
    // code-path (synchronous text/json, no stream events). Without this, POST/PUT/PATCH
    // requests would hang waiting for stream 'end' events that the mock never fires.
    const isJson = options.body !== undefined && typeof options.body !== 'string';
    const bodyStr = options.body !== undefined
      ? (isJson ? JSON.stringify(options.body) : String(options.body))
      : '';
    req.__bunNativeRequest = {
      headers: {
        get: (name: string) => {
          if (name === 'content-length') return String(bodyStr.length);
          if (name === 'content-type') return isJson ? 'application/json' : 'text/plain';
          return null;
        },
      },
      json:  async () => (isJson ? options.body : (bodyStr ? JSON.parse(bodyStr) : {})),
      text:  async () => bodyStr,
    };

    return req;
  }

  /** Creates a mock response object compatible with VeloApplication's enhanceResponse(). */
  public static createMockResponse(): any {
    const res: any = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      body: '',
      headersSent: false,

      setHeader(name: string, value: string | number | readonly string[]) {
        this.headers[name.toLowerCase()] = Array.isArray(value)
          ? (value as string[]).join(', ')
          : String(value);
      },
      getHeader(name: string) { return this.headers[name.toLowerCase()]; },
      removeHeader(name: string) { delete this.headers[name.toLowerCase()]; },

      writeHead(code: number, hdrs?: Record<string, string>) {
        this.statusCode = code;
        if (hdrs) for (const [k, v] of Object.entries(hdrs)) this.headers[k.toLowerCase()] = v;
        this.headersSent = true;
      },

      status(code: number) { this.statusCode = code; return this; },

      json(data: any) {
        this.setHeader('content-type', 'application/json');
        this.body = JSON.stringify(data);
        this.headersSent = true;
      },

      send(data: any) {
        if (typeof data === 'string') {
          this.setHeader('content-type', 'text/plain');
          this.body = data;
        } else {
          this.json(data);
        }
        this.headersSent = true;
      },

      end(data?: any) {
        if (data !== undefined && data !== '') this.body = data;
        this.headersSent = true;
      },

      // No-op EventEmitter stubs (used by graceful-shutdown tracking)
      on()             { return res; },
      once()           { return res; },
      emit()           { return false; },
      removeListener() { return res; },
    };

    return res;
  }

  /**
   * Sends a request directly through the application's request pipeline (no network).
   * Calls `prepareForTesting()` automatically — safe to call before or after `register()`.
   *
   * @returns `{ status, headers, body }` — body is parsed as JSON when possible.
   */
  public static async makeRequest(
    app: VeloApplication,
    options: {
      method: string;
      path: string;
      body?: any;
      headers?: Record<string, string>;
    },
  ): Promise<{ status: number; headers: Record<string, string>; body: any }> {
    await app.prepareForTesting();

    const req = this.createMockRequest({
      method: options.method,
      url:    options.path,
      body:   options.body,
      headers: options.headers,
    });
    const res = this.createMockResponse();

    await (app as any).handleRequest(req, res);

    let body: any = res.body || null;
    if (body && typeof body === 'string') {
      try { body = JSON.parse(body); } catch { /* keep as string */ }
    }

    return { status: res.statusCode, headers: res.headers, body };
  }

  public static createMockContainer(): Container {
    const container = new Container();
    container.register('logger', {
      debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, log: () => {},
    });
    return container;
  }

  public static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  public static generateRandomString(length = 10): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
  }

  public static generateRandomEmail(): string {
    return `${this.generateRandomString(8)}@example.com`;
  }
}
