import { RouteMetadata } from '../types';

const ROUTES_METADATA_KEY = Symbol.for('routes');

function createRouteDecorator(method: string) {
  return function (path: string = '') {
    return function (target: any, propertyKey: string, descriptor?: PropertyDescriptor) {
      const routes: RouteMetadata[] = Reflect.getMetadata(ROUTES_METADATA_KEY, target.constructor) || [];
      
      const route: RouteMetadata = {
        path: path.startsWith('/') ? path : `/${path}`,
        method: method.toUpperCase(),
        handler: propertyKey
      };

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
