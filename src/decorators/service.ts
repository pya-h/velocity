const SERVICE_METADATA_KEY = Symbol.for('service');

export function Service(name?: string) {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    Reflect.defineMetadata(SERVICE_METADATA_KEY, { name: name || constructor.name }, constructor);
    return constructor;
  };
}
