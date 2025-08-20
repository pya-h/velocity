import { VelocityRequest, VelocityResponse } from '../types';

export interface CorsOptions {
  origin?: string | string[] | ((origin: string) => boolean);
  credentials?: boolean;
  allowedHeaders?: string[];
  methods?: string[];
  maxAge?: number;
}

export class CorsMiddleware {
  constructor(private options: CorsOptions = {}) {}

  public use(req: VelocityRequest, res: VelocityResponse, next: () => void): void {
    const origin = req.headers.origin as string;
    const { 
      origin: allowedOrigin = '*',
      credentials = false,
      allowedHeaders = ['Content-Type', 'Authorization'],
      methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      maxAge = 86400
    } = this.options;

    // Set CORS headers
    if (typeof allowedOrigin === 'string') {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    } else if (Array.isArray(allowedOrigin)) {
      if (allowedOrigin.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
    } else if (typeof allowedOrigin === 'function') {
      if (allowedOrigin(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
    }

    if (credentials) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    res.setHeader('Access-Control-Allow-Methods', methods.join(', '));
    res.setHeader('Access-Control-Allow-Headers', allowedHeaders.join(', '));
    res.setHeader('Access-Control-Max-Age', maxAge.toString());

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    next();
  }
}
