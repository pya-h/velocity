import { ApplicationConfig } from '../types';

export class Config {
  private config: ApplicationConfig;

  constructor(config: Partial<ApplicationConfig> = {}) {
    this.config = {
      port: config.port || parseInt(process.env.PORT || '5000'),
      host: config.host || process.env.HOST || '0.0.0.0',
      database: config.database === undefined ? this.getDefaultDatabaseConfig() : config.database,
      logger: config.logger || {
        level: (process.env.LOG_LEVEL as any) || 'info',
        format: 'simple',
        outputs: ['console']
      },
      cors: config.cors || {
        origin: '*',
        credentials: false
      },
      rateLimit: config.rateLimit || {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100 // requests per window
      }
    };
  }

  private getDefaultDatabaseConfig() {
    if (process.env.DATABASE_URL) {
      const url = new URL(process.env.DATABASE_URL);
      return {
        type: url.protocol.slice(0, -1) as any,
        host: url.hostname,
        port: parseInt(url.port),
        database: url.pathname.slice(1),
        username: url.username,
        password: url.password
      };
    }

    return {
      type: 'sqlite' as const,
      database: 'app.db',
      filename: 'app.db'
    };
  }

  public get<K extends keyof ApplicationConfig>(key: K): ApplicationConfig[K] {
    return this.config[key];
  }

  public set<K extends keyof ApplicationConfig>(key: K, value: ApplicationConfig[K]): void {
    this.config[key] = value;
  }

  public getAll(): ApplicationConfig {
    return { ...this.config };
  }
}
