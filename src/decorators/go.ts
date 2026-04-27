export const GO_METADATA_KEY = Symbol.for('velocity:go');

export interface GoOptions {
  /** Initial data passed as the first argument to the method in the worker thread. */
  data?: any;
}

export interface GoMethodDef {
  method: string;
  data?: any;
  /** Absolute path to the source file containing the service class. Auto-detected via stack trace. */
  file?: string;
}

/**
 * Walk the Error stack to find the first frame that lives outside the
 * framework's own decorator files — that is the user's service file.
 */
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
    if (!passedGoFrame) {
      // Mark once we've seen this decorator's own frame
      if (file.includes('decorators/go')) { passedGoFrame = true; }
      continue;
    }
    // First frame after the go.ts frame is the user's service file
    return file;
  }
  return undefined;
}

/**
 * Marks a service method as a real background goroutine.
 * When the server starts, the method is launched in a dedicated Bun Worker thread —
 * true OS-level parallelism, completely independent of the main request-handling thread.
 *
 * The worker runs in full isolation (its own JS context). The method receives
 * `options.data` as its first argument and should create its own DB/service
 * connections if needed.
 *
 * @example
 * @Service()
 * class SyncService {
 *   @Go({ data: { interval: 30_000 } })
 *   async syncFromRemote(data: { interval: number }) {
 *     while (true) {
 *       await Bun.sleep(data.interval);
 *       // ... fetch, store, repeat
 *     }
 *   }
 * }
 */
export function Go(options?: GoOptions): MethodDecorator {
  const file = detectCallerFile();
  return (target, propertyKey) => {
    const defs: GoMethodDef[] = Reflect.getMetadata(GO_METADATA_KEY, (target as any).constructor) ?? [];
    defs.push({ method: String(propertyKey), data: options?.data, file });
    Reflect.defineMetadata(GO_METADATA_KEY, defs, (target as any).constructor);
  };
}
