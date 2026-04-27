import { RouteMetadata, UploadOptions } from '../types';

const ROUTES_METADATA_KEY = Symbol.for('routes');
const PENDING_UPLOAD_KEY = Symbol.for('pending_upload');

export function Upload(options: UploadOptions = {}) {
  return function (target: any, propertyKey: string, descriptor?: PropertyDescriptor) {
    const routes: RouteMetadata[] = Reflect.getMetadata(ROUTES_METADATA_KEY, target.constructor) || [];
    const route = routes.find(r => r.handler === propertyKey);

    if (route) {
      route.upload = options;
    } else {
      const pending: Map<string, UploadOptions> =
        Reflect.getMetadata(PENDING_UPLOAD_KEY, target.constructor) || new Map();
      pending.set(propertyKey, options);
      Reflect.defineMetadata(PENDING_UPLOAD_KEY, pending, target.constructor);
    }

    return descriptor;
  };
}
