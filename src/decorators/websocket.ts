const WEBSOCKET_METADATA_KEY = Symbol.for('websocket');

export function WebSocket(path: string) {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    Reflect.defineMetadata(WEBSOCKET_METADATA_KEY, { path, target: constructor }, constructor);
    return constructor;
  };
}

export { WEBSOCKET_METADATA_KEY };
