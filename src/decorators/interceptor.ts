import { InterceptorFunction, RouteMetadata } from '../types';

const ROUTES_METADATA_KEY = Symbol('routes');
const INTERCEPTOR_METADATA_KEY = Symbol('interceptor');

export function Interceptor(order: number = 0) {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    Reflect.defineMetadata(INTERCEPTOR_METADATA_KEY, { order }, constructor);
    return constructor;
  };
}

export function UseInterceptor(...interceptors: (InterceptorFunction | { new (...args: any[]): any })[]) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const routes: RouteMetadata[] = Reflect.getMetadata(ROUTES_METADATA_KEY, target.constructor) || [];
    const route = routes.find(r => r.handler === propertyKey);

    if (route) {
      const interceptorFunctions = interceptors.map(interceptor => {
        if (typeof interceptor === 'function' && interceptor.prototype) {
          // Class-based interceptor
          const instance = new (interceptor as any)();
          return instance.intercept?.bind(instance) || interceptor;
        }
        return interceptor as InterceptorFunction;
      });

      route.interceptors = [...(route.interceptors || []), ...interceptorFunctions];
    }
  };
}
