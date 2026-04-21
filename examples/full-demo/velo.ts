/**
 * Velocity instance — imported by controllers, services, and db to self-register.
 * Separated from main.ts to avoid circular dependency issues.
 */
import { VelocityApplication } from '@velocity/framework';

export const velo = new VelocityApplication({
  port: 5000,
  host: '0.0.0.0',
  globalPrefix: '/api',
  logger: {
    level: 'info',
    format: 'combined',
    outputs: ['console']
  },
  cors: {
    origin: '*',
    credentials: false
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 100
  }
});
