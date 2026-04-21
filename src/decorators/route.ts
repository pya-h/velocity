import { MiddlewareFunction, InterceptorFunction, RouteMetadata } from '../types';

const ROUTES_METADATA_KEY = Symbol.for('routes');
const PENDING_MIDDLEWARES_KEY = Symbol.for('pending_middlewares');
const PENDING_INTERCEPTORS_KEY = Symbol.for('pending_interceptors');

function createRouteDecorator(method: string) {
  return function (path: string = '') {
    return function (target: any, propertyKey: string, descriptor?: PropertyDescriptor) {
      const routes: RouteMetadata[] = Reflect.getMetadata(ROUTES_METADATA_KEY, target.constructor) || [];

      const route: RouteMetadata = {
        path: path.startsWith('/') ? path : `/${path}`,
        method: method.toUpperCase(),
        handler: propertyKey
      };

      // Merge any pending middlewares stored by @UseMiddleware that ran before us
      const pendingMiddlewares: Map<string, MiddlewareFunction[]> =
        Reflect.getMetadata(PENDING_MIDDLEWARES_KEY, target.constructor) || new Map();
      if (pendingMiddlewares.has(propertyKey)) {
        route.middlewares = [...(route.middlewares || []), ...pendingMiddlewares.get(propertyKey)!];
        pendingMiddlewares.delete(propertyKey);
        Reflect.defineMetadata(PENDING_MIDDLEWARES_KEY, pendingMiddlewares, target.constructor);
      }

      // Merge any pending interceptors stored by @UseInterceptor that ran before us
      const pendingInterceptors: Map<string, InterceptorFunction[]> =
        Reflect.getMetadata(PENDING_INTERCEPTORS_KEY, target.constructor) || new Map();
      if (pendingInterceptors.has(propertyKey)) {
        route.interceptors = [...(route.interceptors || []), ...pendingInterceptors.get(propertyKey)!];
        pendingInterceptors.delete(propertyKey);
        Reflect.defineMetadata(PENDING_INTERCEPTORS_KEY, pendingInterceptors, target.constructor);
      }

      routes.push(route);
      Reflect.defineMetadata(ROUTES_METADATA_KEY, routes, target.constructor);
      return descriptor;
    };
  };
}

export const Get = createRouteDecorator('GET');
export const Post = createRouteDecorator('POST');
export const Put = createRouteDecorator('PUT');
export const Delete = createRouteDecorator('DELETE');
export const Patch = createRouteDecorator('PATCH');
