// Type declarations for the internal reflect-metadata polyfill (src/core/metadata.ts).
// Augments the global Reflect namespace with the three methods the framework uses.
declare namespace Reflect {
  function defineMetadata(key: any, value: any, target: object, propertyKey?: string | symbol): void;
  function getMetadata(key: any, target: object, propertyKey?: string | symbol): any;
  function metadata(key: any, value: any): (target: object, propertyKey?: string | symbol) => void;
}
