import { VelocityRequest, VelocityResponse } from '../types';

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
  permittedCrossDomainPolicies?: boolean | { permittedPolicies: string };
  referrerPolicy?: boolean | { policy: string | string[] };
  xssFilter?: boolean;
}

export class HelmetMiddleware {
  constructor(private options: HelmetOptions = {}) {}

  public use(req: VelocityRequest, res: VelocityResponse, next: () => void): void {
    // Content Security Policy
    if (this.options.contentSecurityPolicy !== false) {
      const csp = typeof this.options.contentSecurityPolicy === 'object' 
        ? this.options.contentSecurityPolicy 
        : { directives: { defaultSrc: ["'self'"] } };
      
      res.setHeader('Content-Security-Policy', this.buildCSP(csp));
    }

    // Cross-Origin Embedder Policy
    if (this.options.crossOriginEmbedderPolicy !== false) {
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    }

    // Cross-Origin Opener Policy
    if (this.options.crossOriginOpenerPolicy !== false) {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    }

    // Cross-Origin Resource Policy
    if (this.options.crossOriginResourcePolicy !== false) {
      const policy = typeof this.options.crossOriginResourcePolicy === 'object'
        ? this.options.crossOriginResourcePolicy.policy
        : 'same-origin';
      res.setHeader('Cross-Origin-Resource-Policy', policy);
    }

    // DNS Prefetch Control
    if (this.options.dnsPrefetchControl !== false) {
      const allow = typeof this.options.dnsPrefetchControl === 'object'
        ? this.options.dnsPrefetchControl.allow
        : false;
      res.setHeader('X-DNS-Prefetch-Control', allow ? 'on' : 'off');
    }

    // Frameguard
    if (this.options.frameguard !== false) {
      const action = typeof this.options.frameguard === 'object'
        ? this.options.frameguard.action
        : 'DENY';
      res.setHeader('X-Frame-Options', action);
    }

    // Hide Powered By
    if (this.options.hidePoweredBy !== false) {
      res.removeHeader('X-Powered-By');
    }

    // HTTP Strict Transport Security
    if (this.options.hsts !== false) {
      const hsts = typeof this.options.hsts === 'object'
        ? this.options.hsts as any
        : { maxAge: 31536000, includeSubDomains: true };
      
      let hstsValue = `max-age=${hsts.maxAge || 31536000}`;
      if (hsts.includeSubDomains) hstsValue += '; includeSubDomains';
      if (hsts.preload) hstsValue += '; preload';
      
      res.setHeader('Strict-Transport-Security', hstsValue);
    }

    // IE No Open
    if (this.options.ieNoOpen !== false) {
      res.setHeader('X-Download-Options', 'noopen');
    }

    // X-Content-Type-Options
    if (this.options.noSniff !== false) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }

    // Origin Agent Cluster
    if (this.options.originAgentCluster !== false) {
      res.setHeader('Origin-Agent-Cluster', '?1');
    }

    // Referrer Policy
    if (this.options.referrerPolicy !== false) {
      const policy = typeof this.options.referrerPolicy === 'object'
        ? Array.isArray(this.options.referrerPolicy.policy)
          ? this.options.referrerPolicy.policy.join(', ')
          : this.options.referrerPolicy.policy
        : 'no-referrer';
      res.setHeader('Referrer-Policy', policy);
    }

    // XSS Filter
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
