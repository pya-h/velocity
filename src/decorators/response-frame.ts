import type { FrameTemplate } from '../core/frame';

const RESPONSE_FRAME_KEY = Symbol.for('response_frame');

export function ResponseFrame(template: FrameTemplate) {
  return function <T extends { new (...args: unknown[]): {} }>(constructor: T) {
    Reflect.defineMetadata(RESPONSE_FRAME_KEY, template, constructor);
    return constructor;
  };
}

export { RESPONSE_FRAME_KEY };
