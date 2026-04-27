import * as fs from 'fs';
import { LoggerConfig } from '../types';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
type Level = keyof typeof LEVELS;

const COLORS: Record<Level, string> = {
  error: '\x1b[31m',
  warn:  '\x1b[33m',
  info:  '\x1b[36m',
  debug: '\x1b[90m',
};
const RESET = '\x1b[0m';

export class Logger {
  private threshold: number;
  private format: string;
  private outputs: string[];
  private fileStream?: fs.WriteStream;

  constructor(config: LoggerConfig = { level: 'info', format: 'simple', outputs: ['console'] }) {
    this.threshold = LEVELS[config.level ?? 'info'] ?? LEVELS.info;
    this.format = config.format ?? 'simple';
    this.outputs = config.outputs ?? ['console'];

    if (this.outputs.includes('file') && config.filename) {
      this.fileStream = fs.createWriteStream(config.filename, { flags: 'a' });
    }
  }

  private write(level: Level, message: string, meta?: any): void {
    if (LEVELS[level] > this.threshold) return;

    const ts = new Date().toISOString();
    let line: string;

    if (this.format === 'json') {
      line = JSON.stringify({ timestamp: ts, level, message, ...(meta != null ? { meta } : {}) });
    } else if (this.format === 'combined') {
      const extra = meta instanceof Error
        ? `\n${meta.stack}`
        : meta != null ? ` ${JSON.stringify(meta)}` : '';
      line = `${ts} [${level.toUpperCase()}]: ${message}${extra}`;
    } else {
      // simple
      const extra = meta != null
        ? ` ${meta instanceof Error ? meta.message : JSON.stringify(meta)}`
        : '';
      line = `${level.toUpperCase()}: ${message}${extra}`;
    }

    if (this.outputs.includes('console')) {
      const tty = process.stdout.isTTY === true;
      process.stdout.write(tty ? `${COLORS[level]}${line}${RESET}\n` : `${line}\n`);
    }

    if (this.fileStream) {
      this.fileStream.write(line + '\n');
    }
  }

  public debug(message: string, meta?: any): void { this.write('debug', message, meta); }
  public info(message: string, meta?: any): void  { this.write('info',  message, meta); }
  public warn(message: string, meta?: any): void  { this.write('warn',  message, meta); }
  public error(message: string, meta?: any): void { this.write('error', message, meta); }
  public log(level: string, message: string, meta?: any): void {
    if (level in LEVELS) this.write(level as Level, message, meta);
  }
}
