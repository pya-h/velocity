/**
 * Velocity instance — imported by controllers, services, and db to self-register.
 * Separated from main.ts to avoid circular dependency issues.
 */
import { VelocityApplication, Frame } from '@velocity/framework';
import { envelocity } from './velo/envelocity';

export const velo = new VelocityApplication({
  port: parseInt(envelocity.server.portOrThrow),
  host: envelocity.server.hostOrThrow,
  globalPrefix: '/api',
  cookieSecret: envelocity.auth.jwtSecret ?? 'change-me-in-production',
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

// ── Global ResponseFrame ────────────────────────────────────────────────────
// All controllers use this frame unless they have their own @ResponseFrame.
//
// Every response becomes:
//   { status: 200, data: <handler return>, error: null }
//   { status: 500, data: null, error: "message" }

velo.responseFrame({
  status: Frame.Status,
  data:   Frame.Data,
  error:  Frame.Error,
});
