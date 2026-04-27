import { MiddlewareFunction, InterceptorFunction, GuardFunction, RouteMetadata, UploadOptions } from '../types';

const ROUTES_METADATA_KEY = Symbol.for('routes');
const PENDING_MIDDLEWARES_KEY = Symbol.for('pending_middlewares');
const PENDING_INTERCEPTORS_KEY = Symbol.for('pending_interceptors');
const PENDING_GUARDS_KEY = Symbol.for('pending_guards');
const PENDING_UPLOAD_KEY = Symbol.for('pending_upload');

function createRouteDecorator(method: string) {
  return function (path: string = '') {
    return function (target: any, propertyKey: string, descriptor?: PropertyDescriptor) {
      const routes: RouteMetadata[] = Reflect.getMetadata(ROUTES_METADATA_KEY, target.constructor) || [];

      const route: RouteMetadata = {
        path: path.startsWith('/') ? path : `/${path}`,
        method: method.toUpperCase(),
        handler: propertyKey
      };

      // Merge any pending middlewares stored by @Middlewares that ran before us
      const pendingMiddlewares: Map<string, MiddlewareFunction[]> =
        Reflect.getMetadata(PENDING_MIDDLEWARES_KEY, target.constructor) || new Map();
      if (pendingMiddlewares.has(propertyKey)) {
        route.middlewares = [...(route.middlewares || []), ...pendingMiddlewares.get(propertyKey)!];
        pendingMiddlewares.delete(propertyKey);
        Reflect.defineMetadata(PENDING_MIDDLEWARES_KEY, pendingMiddlewares, target.constructor);
      }

      // Merge any pending interceptors stored by @Interceptors that ran before us
      const pendingInterceptors: Map<string, InterceptorFunction[]> =
        Reflect.getMetadata(PENDING_INTERCEPTORS_KEY, target.constructor) || new Map();
      if (pendingInterceptors.has(propertyKey)) {
        route.interceptors = [...(route.interceptors || []), ...pendingInterceptors.get(propertyKey)!];
        pendingInterceptors.delete(propertyKey);
        Reflect.defineMetadata(PENDING_INTERCEPTORS_KEY, pendingInterceptors, target.constructor);
      }

      // Merge any pending guards stored by @Guards that ran before us
      const pendingGuards: Map<string, GuardFunction[]> =
        Reflect.getMetadata(PENDING_GUARDS_KEY, target.constructor) || new Map();
      if (pendingGuards.has(propertyKey)) {
        route.guards = [...(route.guards || []), ...pendingGuards.get(propertyKey)!];
        pendingGuards.delete(propertyKey);
        Reflect.defineMetadata(PENDING_GUARDS_KEY, pendingGuards, target.constructor);
      }

      // Merge any pending upload options stored by @Upload that ran before us
      const pendingUpload: Map<string, UploadOptions> =
        Reflect.getMetadata(PENDING_UPLOAD_KEY, target.constructor) || new Map();
      if (pendingUpload.has(propertyKey)) {
        route.upload = pendingUpload.get(propertyKey);
        pendingUpload.delete(propertyKey);
        Reflect.defineMetadata(PENDING_UPLOAD_KEY, pendingUpload, target.constructor);
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
