const INJECTABLE_METADATA_KEY = Symbol('injectable');

export function Injectable() {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    Reflect.defineMetadata(INJECTABLE_METADATA_KEY, true, constructor);
    return constructor;
  };
}
