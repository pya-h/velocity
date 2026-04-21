import { InterceptorFunction, RouteMetadata } from '../types';

const ROUTES_METADATA_KEY = Symbol.for('routes');
const INTERCEPTOR_METADATA_KEY = Symbol('interceptor');
const PENDING_INTERCEPTORS_KEY = Symbol.for('pending_interceptors');

export function Interceptor(order: number = 0) {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    Reflect.defineMetadata(INTERCEPTOR_METADATA_KEY, { order }, constructor);
    return constructor;
  };
}

function resolveInterceptorFunctions(interceptors: (InterceptorFunction | { new (...args: any[]): any })[]): InterceptorFunction[] {
  return interceptors.map(interceptor => {
    if (typeof interceptor === 'function' && interceptor.prototype) {
      const instance = new (interceptor as any)();
      if (typeof instance.intercept === 'function') {
        return instance.intercept.bind(instance);
      }
      throw new Error(`Class-based interceptor ${interceptor.name || 'unknown'} must have an intercept() method`);
    }
    return interceptor as InterceptorFunction;
  });
}

export function UseInterceptor(...interceptors: (InterceptorFunction | { new (...args: any[]): any })[]) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const interceptorFunctions = resolveInterceptorFunctions(interceptors);

    // Try to attach to existing route (if route decorator ran first)
    const routes: RouteMetadata[] = Reflect.getMetadata(ROUTES_METADATA_KEY, target.constructor) || [];
    const route = routes.find(r => r.handler === propertyKey);

    if (route) {
      route.interceptors = [...(route.interceptors || []), ...interceptorFunctions];
    } else {
      // Route doesn't exist yet — store as pending for the route decorator to pick up
      const pending: Map<string, InterceptorFunction[]> =
        Reflect.getMetadata(PENDING_INTERCEPTORS_KEY, target.constructor) || new Map();
      const existing = pending.get(propertyKey) || [];
      pending.set(propertyKey, [...existing, ...interceptorFunctions]);
      Reflect.defineMetadata(PENDING_INTERCEPTORS_KEY, pending, target.constructor);
    }

    return descriptor;
  };
}
