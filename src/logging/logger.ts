import winston from 'winston';
import { LoggerConfig } from '../types';

export class Logger {
  private winston: winston.Logger;

  constructor(config: LoggerConfig = {
    level: 'info',
    format: 'simple',
    outputs: ['console']
  }) {
    const formats: Record<string, winston.Logform.Format> = {
      json: winston.format.json(),
      simple: winston.format.simple(),
      combined: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.printf(({ timestamp, level, message, stack }) => {
          return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
        })
      )
    };

    const selectedFormat = formats[config.format] || formats.simple;
    const transports: winston.transport[] = [];

    if (config.outputs.includes('console')) {
      transports.push(new winston.transports.Console({
        format: selectedFormat
      }));
    }

    if (config.outputs.includes('file') && config.filename) {
      transports.push(new winston.transports.File({
        filename: config.filename,
        format: selectedFormat
      }));
    }

    this.winston = winston.createLogger({
      level: config.level,
      transports
    });
  }

  public debug(message: string, meta?: any): void {
    this.winston.debug(message, meta);
  }

  public info(message: string, meta?: any): void {
    this.winston.info(message, meta);
  }

  public warn(message: string, meta?: any): void {
    this.winston.warn(message, meta);
  }

  public error(message: string, error?: Error | any): void {
    this.winston.error(message, error);
  }

  public log(level: string, message: string, meta?: any): void {
    this.winston.log(level, message, meta);
  }
}
