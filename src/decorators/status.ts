import type { RouteMetadata } from '../types';

const ROUTES_METADATA_KEY = Symbol.for('routes');
const PENDING_STATUS_KEY = Symbol.for('pending_status');

export function Status(code: number) {
  return function (target: unknown, propertyKey: string, descriptor?: PropertyDescriptor) {
    const ctor = (target as { constructor: Function }).constructor;
    const routes: RouteMetadata[] = Reflect.getMetadata(ROUTES_METADATA_KEY, ctor) || [];
    const route = routes.find(r => r.handler === propertyKey);

    if (route) {
      route.statusCode = code;
    } else {
      const pending: Map<string, number> =
        Reflect.getMetadata(PENDING_STATUS_KEY, ctor) || new Map();
      pending.set(propertyKey, code);
      Reflect.defineMetadata(PENDING_STATUS_KEY, pending, ctor);
    }

    return descriptor;
  };
}

export { PENDING_STATUS_KEY };
