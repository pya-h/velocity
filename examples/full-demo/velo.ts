/**
 * Velocity instance — imported by controllers, services, and db to self-register.
 * Separated from main.ts to avoid circular dependency issues.
 */
import { VelocityApplication } from '@velocity/framework';
import { envelocity } from './velo/envelocity';

export const velo = new VelocityApplication({
  port: parseInt(envelocity.server.portOrThrow),
  host: envelocity.server.hostOrThrow,
  globalPrefix: '/api',
  logger: {
    level: 'info',
    format: 'combined',
    outputs: ['console'],
  },
  cors: {
    origin: '*',
    credentials: false,
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 100,
  },
  compression: {
    enabled: true,
    threshold: 1024,
  },
  shutdown: {
    timeout: 5000,
    auto: true,
  },
});
