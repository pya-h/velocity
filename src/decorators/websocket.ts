const WEBSOCKET_METADATA_KEY = Symbol.for('websocket');
const WS_COMMANDS_KEY = Symbol.for('ws_commands');
const WS_COMMAND_ELSE_KEY = Symbol.for('ws_command_else');

export function WebSocket(path: string) {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    Reflect.defineMetadata(WEBSOCKET_METADATA_KEY, { path, target: constructor }, constructor);
    return constructor;
  };
}

export interface WsCommandDef {
  name: string;
  method: string;
}

/**
 * Register a method as a WebSocket command handler.
 * Client sends: { "cmd": "name", "data": ... }
 * Handler receives (data, ws?) and returns the response payload.
 */
export function Command(name: string) {
  return function (target: unknown, propertyKey: string, _descriptor?: PropertyDescriptor) {
    const ctor = (target as { constructor: Function }).constructor;
    const commands: WsCommandDef[] = Reflect.getMetadata(WS_COMMANDS_KEY, ctor) || [];
    commands.push({ name, method: propertyKey });
    Reflect.defineMetadata(WS_COMMANDS_KEY, commands, ctor);
  };
}

/**
 * Fallback handler for unrecognized commands.
 * Receives (cmd: string, data: unknown, ws?) — called when no @Command matches.
 */
export function CommandElse(target: unknown, propertyKey: string, _descriptor?: PropertyDescriptor) {
  const ctor = (target as { constructor: Function }).constructor;
  Reflect.defineMetadata(WS_COMMAND_ELSE_KEY, propertyKey, ctor);
}

export { WEBSOCKET_METADATA_KEY, WS_COMMANDS_KEY, WS_COMMAND_ELSE_KEY };
