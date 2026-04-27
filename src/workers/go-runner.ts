/**
 * Bun Worker entry point for @Go decorated service methods.
 *
 * Receives a single message: { serviceFile, className, method, data }
 * Dynamically imports the service file, instantiates the class (no DI container —
 * the worker is isolated), and calls the method with `data` as the first argument.
 *
 * The service class can be a named export, default export, or a non-exported class
 * decorated with @Go (which registers itself in _goClassRegistry at decoration time).
 * If the constructor requires injected dependencies, the worker context won't have
 * them — design @Go methods to be self-sufficient (create their own connections).
 */

import { _goClassRegistry } from '../decorators/go';

// `self` is the DedicatedWorkerGlobalScope in Bun Workers.
// Cast through globalThis to avoid a missing-lib TS error (bun-types doesn't
// expose the Worker global scope when lib is ES2022 without dom/webworker).
const workerSelf = globalThis as any;

workerSelf.onmessage = async (event: MessageEvent) => {
  const { serviceFile, className, method, data } = event.data as {
    serviceFile: string;
    className: string;
    method: string;
    data?: any;
  };

  try {
    const mod = await import(serviceFile);

    // Named export → default export → @Go class registry (populated when the
    // service file is imported above, re-running the @Go decorator in this worker).
    const ServiceClass: any = mod[className] ?? mod.default ?? _goClassRegistry.get(className);
    if (typeof ServiceClass !== 'function') {
      throw new Error(`Class "${className}" not found or not exported from ${serviceFile}`);
    }

    const instance = new ServiceClass();
    await instance[method](data);

    // Method resolved (one-shot tasks finish here; infinite loops never reach this)
    workerSelf.postMessage({ type: 'done' });
  } catch (err: any) {
    workerSelf.postMessage({ type: 'error', message: err?.message ?? String(err) });
  }
};
