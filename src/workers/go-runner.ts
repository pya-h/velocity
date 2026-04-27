import { _goClassRegistry } from '../decorators/go';
import { resolveChannelArgs } from '../decorators/channel';

// globalThis cast avoids missing-lib TS error for DedicatedWorkerGlobalScope
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

    const ServiceClass: any = mod[className] ?? mod.default ?? _goClassRegistry.get(className);
    if (typeof ServiceClass !== 'function') {
      throw new Error(`Class "${className}" not found or not exported from ${serviceFile}`);
    }

    const instance = new ServiceClass();
    const args = resolveChannelArgs(instance, method, data);
    await instance[method](...args);

    workerSelf.postMessage({ type: 'done' });
  } catch (err: any) {
    workerSelf.postMessage({ type: 'error', message: err?.message ?? String(err) });
  }
};
