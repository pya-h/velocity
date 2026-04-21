import { ApplicationConfig } from '../types';

export class Config {
  private config: ApplicationConfig;

  constructor(config: Partial<ApplicationConfig> = {}) {
    this.config = {
      port: config.port || parseInt(process.env.PORT || '5000'),
      host: config.host || process.env.HOST || '0.0.0.0',
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
        windowMs: 15 * 60 * 1000,
        max: 100
      },
      globalPrefix: config.globalPrefix,
      globalPrefixExclusions: config.globalPrefixExclusions
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
