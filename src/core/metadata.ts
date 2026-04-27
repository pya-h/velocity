/**
 * Minimal Reflect metadata polyfill — replaces the `reflect-metadata` npm package.
 *
 * Implements only the three methods used by this framework:
 *   Reflect.defineMetadata(key, value, target [, propertyKey])
 *   Reflect.getMetadata(key, target [, propertyKey])
 *   Reflect.metadata(key, value)  ← decorator factory; TypeScript emits this for design:* keys
 *
 * `design:paramtypes` (DI) and `design:type` (ORM) continue to work as long as
 * tsconfig has `emitDecoratorMetadata: true` — the compiler still emits the calls;
 * this polyfill is what receives and stores them.
 */

// Two-level store: target object → property key → metadata key → value
// CLASS_KEY is used when no propertyKey is given (class-level metadata).
const CLASS_KEY = Symbol('class');
const store = new WeakMap<object, Map<string | symbol, Map<string | symbol, unknown>>>();

function getPropMap(target: object, propertyKey: string | symbol | undefined): Map<string | symbol, unknown> {
  let classMap = store.get(target);
  if (!classMap) { classMap = new Map(); store.set(target, classMap); }
  const pk = propertyKey ?? CLASS_KEY;
  let propMap = classMap.get(pk);
  if (!propMap) { propMap = new Map(); classMap.set(pk, propMap); }
  return propMap;
}

function defineMetadata(key: string | symbol, value: unknown, target: object, propertyKey?: string | symbol): void {
  getPropMap(target, propertyKey).set(key, value);
}

function getMetadata(key: string | symbol, target: object, propertyKey?: string | symbol): unknown {
  // Walk the prototype chain so subclasses inherit class-level metadata.
  let t: object | null = target;
  while (t !== null && t !== Object.prototype) {
    const propMap = store.get(t)?.get(propertyKey ?? CLASS_KEY);
    if (propMap?.has(key)) return propMap.get(key);
    t = Object.getPrototypeOf(t) as object | null;
  }
  return undefined;
}

// Decorator factory — TypeScript emits:  __metadata("design:type", String)
// which compiles to: Reflect.metadata("design:type", String)(target, propertyKey)
function metadata(key: string | symbol, value: unknown) {
  return (target: object, propertyKey?: string | symbol): void => {
    defineMetadata(key, value, target, propertyKey);
  };
}

(Reflect as any).defineMetadata = defineMetadata;
(Reflect as any).getMetadata   = getMetadata;
(Reflect as any).metadata      = metadata;
