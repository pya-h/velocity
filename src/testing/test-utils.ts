import { VelocityApplication } from '../core/application';
import { Container } from '../core/container';

export class TestUtils {
  public static createTestApp(config?: any): VelocityApplication {
    const testConfig = {
      port: 0,
      logger: {
        level: 'error' as const,
        format: 'simple' as const,
        outputs: [] as const
      },
      ...config
    };

    return new VelocityApplication(testConfig);
  }

  public static createMockRequest(options: {
    method?: string;
    url?: string;
    body?: any;
    headers?: Record<string, string>;
    params?: Record<string, string>;
    query?: Record<string, string>;
  } = {}): any {
    return {
      method: options.method || 'GET',
      url: options.url || '/',
      body: options.body,
      headers: options.headers || {},
      params: options.params || {},
      query: options.query || {}
    };
  }

  public static createMockResponse(): any {
    const response = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      body: '',
      headersSent: false,

      setHeader: function(name: string, value: string) {
        this.headers[name] = value;
      },

      removeHeader: function(name: string) {
        delete this.headers[name];
      },

      status: function(code: number) {
        this.statusCode = code;
        return this;
      },

      json: function(data: any) {
        this.setHeader('Content-Type', 'application/json');
        this.body = JSON.stringify(data);
        this.headersSent = true;
      },

      send: function(data: any) {
        if (typeof data === 'string') {
          this.setHeader('Content-Type', 'text/plain');
          this.body = data;
        } else {
          this.json(data);
        }
        this.headersSent = true;
      },

      end: function(data?: any) {
        if (data) this.body = data;
        this.headersSent = true;
      }
    };

    return response;
  }

  public static async makeRequest(app: VelocityApplication, options: {
    method: string;
    path: string;
    body?: any;
    headers?: Record<string, string>;
  }): Promise<any> {
    const req = this.createMockRequest({
      method: options.method,
      url: options.path,
      body: options.body,
      headers: options.headers
    });

    const res = this.createMockResponse();

    // Simulate request handling
    await (app as any).handleRequest(req, res);

    return {
      status: res.statusCode,
      headers: res.headers,
      body: res.body ? JSON.parse(res.body) : null
    };
  }

  public static createMockContainer(): Container {
    const container = new Container();
    
    // Register common test dependencies
    container.register('logger', {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      log: () => {}
    });

    return container;
  }

  public static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  public static generateRandomString(length: number = 10): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  public static generateRandomEmail(): string {
    return `${this.generateRandomString(8)}@example.com`;
  }
}
