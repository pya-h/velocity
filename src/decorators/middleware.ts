import { MiddlewareFunction, RouteMetadata } from '../types';

const ROUTES_METADATA_KEY = Symbol.for('routes');
const MIDDLEWARE_METADATA_KEY = Symbol('middleware');
const PENDING_MIDDLEWARES_KEY = Symbol.for('pending_middlewares');

export function Middleware(order: number = 0) {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    Reflect.defineMetadata(MIDDLEWARE_METADATA_KEY, { order }, constructor);
    return constructor;
  };
}

function resolveMiddlewareFunctions(middlewares: (MiddlewareFunction | { new (...args: any[]): any })[]): MiddlewareFunction[] {
  return middlewares.map(middleware => {
    if (typeof middleware === 'function' && middleware.prototype) {
      const instance = new (middleware as any)();
      if (typeof instance.use === 'function') {
        return instance.use.bind(instance);
      }
      throw new Error(`Class-based middleware ${middleware.name || 'unknown'} must have a use() method`);
    }
    return middleware as MiddlewareFunction;
  });
}

export function UseMiddleware(...middlewares: (MiddlewareFunction | { new (...args: any[]): any })[]) {
  return function (target: any, propertyKey: string, descriptor?: PropertyDescriptor) {
    const middlewareFunctions = resolveMiddlewareFunctions(middlewares);

    // Try to attach to existing route (if route decorator ran first)
    const routes: RouteMetadata[] = Reflect.getMetadata(ROUTES_METADATA_KEY, target.constructor) || [];
    const route = routes.find(r => r.handler === propertyKey);

    if (route) {
      route.middlewares = [...(route.middlewares || []), ...middlewareFunctions];
    } else {
      // Route doesn't exist yet — store as pending for the route decorator to pick up
      const pending: Map<string, MiddlewareFunction[]> =
        Reflect.getMetadata(PENDING_MIDDLEWARES_KEY, target.constructor) || new Map();
      const existing = pending.get(propertyKey) || [];
      pending.set(propertyKey, [...existing, ...middlewareFunctions]);
      Reflect.defineMetadata(PENDING_MIDDLEWARES_KEY, pending, target.constructor);
    }

    return descriptor;
  };
}
