import { VelocityChannel } from '../channel/channel';

export const CHANNEL_PARAM_METADATA_KEY = Symbol.for('velocity:channel-params');

export interface ChannelParamDef {
  index: number;
  name: string;
}

/**
 * Parameter decorator for @Go methods.
 * Injects a VelocityChannel<T> instance with the given channel name into the worker.
 *
 * All parameters that receive data should be decorated with @Channel.
 * Any un-decorated parameter position will be undefined at runtime.
 *
 * @example
 * @Go()
 * async run(@Channel('velocity:jobs') jobs: VelocityChannel<Job>) {
 *   for await (const job of jobs) { ... }
 * }
 */
export function Channel(name: string): ParameterDecorator {
  return (target, propertyKey, parameterIndex) => {
    const defs: ChannelParamDef[] = Reflect.getMetadata(CHANNEL_PARAM_METADATA_KEY, target, propertyKey!) ?? [];
    defs.push({ index: parameterIndex, name });
    Reflect.defineMetadata(CHANNEL_PARAM_METADATA_KEY, defs, target, propertyKey!);
  };
}

export function resolveChannelArgs(instance: any, method: string, data?: any): any[] {
  const defs: ChannelParamDef[] = Reflect.getMetadata(
    CHANNEL_PARAM_METADATA_KEY,
    Object.getPrototypeOf(instance),
    method,
  ) ?? [];

  if (defs.length === 0) return data !== undefined ? [data] : [];

  const args: any[] = [];
  for (const { index, name } of defs) {
    args[index] = new VelocityChannel(name);
  }
  return args;
}
