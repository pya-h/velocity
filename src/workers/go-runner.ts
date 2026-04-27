/**
 * Bun Worker entry point for @Go decorated service methods.
 *
 * Receives a single message: { serviceFile, className, method, data }
 * Dynamically imports the service file, instantiates the class (no DI container —
 * the worker is isolated), and calls the method with `data` as the first argument.
 *
 * The service class must be a named export matching `className`.
 * If the constructor requires injected dependencies, the worker context won't have
 * them — design @Go methods to be self-sufficient (create their own connections).
 */

self.onmessage = async (event: MessageEvent) => {
  const { serviceFile, className, method, data } = event.data as {
    serviceFile: string;
    className: string;
    method: string;
    data?: any;
  };

  try {
    const mod = await import(serviceFile);

    // Named export takes priority; fall back to default export
    const ServiceClass: any = mod[className] ?? mod.default;
    if (typeof ServiceClass !== 'function') {
      throw new Error(`Class "${className}" not found or not exported from ${serviceFile}`);
    }

    const instance = new ServiceClass();
    await instance[method](data);

    // Method resolved (one-shot tasks finish here; infinite loops never reach this)
    self.postMessage({ type: 'done' });
  } catch (err: any) {
    self.postMessage({ type: 'error', message: err?.message ?? String(err) });
  }
};
