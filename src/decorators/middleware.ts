import { MiddlewareFunction, RouteMetadata } from '../types';

const ROUTES_METADATA_KEY = Symbol.for('routes');
const MIDDLEWARE_METADATA_KEY = Symbol('middleware');

export function Middleware(order: number = 0) {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    Reflect.defineMetadata(MIDDLEWARE_METADATA_KEY, { order }, constructor);
    return constructor;
  };
}

export function UseMiddleware(...middlewares: (MiddlewareFunction | { new (...args: any[]): any })[]) {
  return function (target: any, propertyKey: string, descriptor?: PropertyDescriptor) {
    const routes: RouteMetadata[] = Reflect.getMetadata(ROUTES_METADATA_KEY, target.constructor) || [];
    const route = routes.find(r => r.handler === propertyKey);

    if (route) {
      const middlewareFunctions = middlewares.map(middleware => {
        if (typeof middleware === 'function' && middleware.prototype) {
          // Class-based middleware
          const instance = new (middleware as any)();
          return instance.use?.bind(instance) || middleware;
        }
        return middleware as MiddlewareFunction;
      });

      route.middlewares = [...(route.middlewares || []), ...middlewareFunctions];
    }
    return descriptor;
  };
}
