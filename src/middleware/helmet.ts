import { VeloRequest, VeloResponse } from '../types';

export interface HelmetOptions {
  contentSecurityPolicy?: boolean | object;
  crossOriginEmbedderPolicy?: boolean;
  crossOriginOpenerPolicy?: boolean;
  crossOriginResourcePolicy?: boolean | { policy: string };
  dnsPrefetchControl?: boolean | { allow: boolean };
  frameguard?: boolean | { action: string };
  hidePoweredBy?: boolean;
  hsts?: boolean | object;
  ieNoOpen?: boolean;
  noSniff?: boolean;
  originAgentCluster?: boolean;
  referrerPolicy?: boolean | { policy: string | string[] };
  xssFilter?: boolean;
}

export class HelmetMiddleware {
  constructor(private options: HelmetOptions = {}) {}

  public use(_req: VeloRequest, res: VeloResponse, next: () => void): void {
    if (this.options.contentSecurityPolicy !== false) {
      const csp = typeof this.options.contentSecurityPolicy === 'object'
        ? this.options.contentSecurityPolicy
        : { directives: { defaultSrc: ["'self'"] } };
      res.setHeader('Content-Security-Policy', this.buildCSP(csp));
    }

    if (this.options.crossOriginEmbedderPolicy !== false) {
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    }

    if (this.options.crossOriginOpenerPolicy !== false) {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    }

    if (this.options.crossOriginResourcePolicy !== false) {
      const policy = typeof this.options.crossOriginResourcePolicy === 'object'
        ? this.options.crossOriginResourcePolicy.policy
        : 'same-origin';
      res.setHeader('Cross-Origin-Resource-Policy', policy);
    }

    if (this.options.dnsPrefetchControl !== false) {
      const allow = typeof this.options.dnsPrefetchControl === 'object'
        ? this.options.dnsPrefetchControl.allow
        : false;
      res.setHeader('X-DNS-Prefetch-Control', allow ? 'on' : 'off');
    }

    if (this.options.frameguard !== false) {
      const action = typeof this.options.frameguard === 'object'
        ? this.options.frameguard.action
        : 'DENY';
      res.setHeader('X-Frame-Options', action);
    }

    if (this.options.hidePoweredBy !== false) {
      res.removeHeader('X-Powered-By');
    }

    if (this.options.hsts !== false) {
      const hsts = typeof this.options.hsts === 'object'
        ? this.options.hsts as any
        : { maxAge: 31536000, includeSubDomains: true };
      let hstsValue = `max-age=${hsts.maxAge || 31536000}`;
      if (hsts.includeSubDomains) hstsValue += '; includeSubDomains';
      if (hsts.preload) hstsValue += '; preload';
      res.setHeader('Strict-Transport-Security', hstsValue);
    }

    if (this.options.ieNoOpen !== false) {
      res.setHeader('X-Download-Options', 'noopen');
    }

    if (this.options.noSniff !== false) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }

    if (this.options.originAgentCluster !== false) {
      res.setHeader('Origin-Agent-Cluster', '?1');
    }

    if (this.options.referrerPolicy !== false) {
      const policy = typeof this.options.referrerPolicy === 'object'
        ? Array.isArray(this.options.referrerPolicy.policy)
          ? this.options.referrerPolicy.policy.join(', ')
          : this.options.referrerPolicy.policy
        : 'no-referrer';
      res.setHeader('Referrer-Policy', policy);
    }

    if (this.options.xssFilter !== false) {
      res.setHeader('X-XSS-Protection', '0');
    }

    next();
  }

  private buildCSP(csp: any): string {
    if (typeof csp === 'string') return csp;
    
    const directives = csp.directives || {};
    return Object.entries(directives)
      .map(([key, values]) => {
        const directiveName = key.replace(/([A-Z])/g, '-$1').toLowerCase();
        const directiveValues = Array.isArray(values) ? values.join(' ') : values;
        return `${directiveName} ${directiveValues}`;
      })
      .join('; ');
  }
}
