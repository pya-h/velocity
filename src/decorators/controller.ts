const CONTROLLER_METADATA_KEY = Symbol.for('controller');

export function Controller(path: string = '') {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    Reflect.defineMetadata(CONTROLLER_METADATA_KEY, {
      path: path.startsWith('/') ? path : `/${path}`,
      target: constructor
    }, constructor);

    return constructor;
  };
}
