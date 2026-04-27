export const GO_METADATA_KEY = Symbol.for('velocity:go');

// Populated when @Go decorates a class (in both main thread and worker thread).
// Allows go-runner to find non-exported service classes by name.
export const _goClassRegistry = new Map<string, any>();

export interface GoOptions {
  /** Initial data passed as the first argument to the method in the worker thread. */
  data?: any;
}

export interface GoMethodDef {
  method: string;
  data?: any;
  file?: string;
}

function detectCallerFile(): string | undefined {
  const lines = (new Error().stack ?? '').split('\n');
  let passedGoFrame = false;
  for (const line of lines) {
    // V8 / Bun format:  "    at Something (/abs/path/file.ts:N:N)"
    //                or "    at /abs/path/file.ts:N:N"
    const m = line.match(/\((.+\.[tj]s):\d+:\d+\)/)
           || line.match(/^\s+at\s+(.+\.[tj]s):\d+:\d+\s*$/);
    if (!m) continue;
    const file = m[1];
    if (file.includes('decorators/go')) {
      passedGoFrame = true;
      continue;
    }
    if (passedGoFrame) return file;
  }
  return undefined;
}

export function Go(options?: GoOptions): MethodDecorator {
  const file = detectCallerFile();
  return (target, propertyKey) => {
    const ctor = (target as any).constructor;
    _goClassRegistry.set(ctor.name, ctor);
    const defs: GoMethodDef[] = Reflect.getMetadata(GO_METADATA_KEY, ctor) ?? [];
    defs.push({ method: String(propertyKey), data: options?.data, file });
    Reflect.defineMetadata(GO_METADATA_KEY, defs, ctor);
  };
}
