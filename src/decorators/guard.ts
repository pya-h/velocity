import { GuardFunction, RouteMetadata } from '../types';

const ROUTES_METADATA_KEY = Symbol.for('routes');
const PENDING_GUARDS_KEY = Symbol.for('pending_guards');

export function Guards(...guards: GuardFunction[]) {
  return function (target: any, propertyKey: string, descriptor?: PropertyDescriptor) {
    const routes: RouteMetadata[] = Reflect.getMetadata(ROUTES_METADATA_KEY, target.constructor) || [];
    const route = routes.find(r => r.handler === propertyKey);

    if (route) {
      route.guards = [...(route.guards || []), ...guards];
    } else {
      // Route doesn't exist yet — store as pending for the route decorator to pick up
      const pending: Map<string, GuardFunction[]> =
        Reflect.getMetadata(PENDING_GUARDS_KEY, target.constructor) || new Map();
      const existing = pending.get(propertyKey) || [];
      pending.set(propertyKey, [...existing, ...guards]);
      Reflect.defineMetadata(PENDING_GUARDS_KEY, pending, target.constructor);
    }

    return descriptor;
  };
}
