/**
 * WebSocket decorator metadata tests.
 * These test the decorator functions' metadata registration — not actual WS connections
 * (which require Bun.serve() and a real client).
 */
import '../src/core/metadata';
import { Suite, Test, BeforeEach, expect } from '../src/testing/decorators';
import { WebSocket, Command, CommandElse, WEBSOCKET_METADATA_KEY, WS_COMMANDS_KEY, WS_COMMAND_ELSE_KEY } from '../src/decorators/websocket';
import type { WsCommandDef } from '../src/decorators/websocket';

@Suite('WebSocket decorators — metadata registration')
class WebSocketMetadataTests {
  @Test('@WebSocket stores path and target on class')
  wsDecorator() {
    @WebSocket('/chat')
    class ChatWs {}

    const meta = Reflect.getMetadata(WEBSOCKET_METADATA_KEY, ChatWs);
    expect(meta).toBeDefined();
    expect(meta.path).toBe('/chat');
    expect(meta.target).toBe(ChatWs);
  }

  @Test('@Command stores command definitions')
  commandDecorator() {
    class TestWs {
      @Command('ping')
      handlePing() {}

      @Command('echo')
      handleEcho() {}
    }

    const commands: WsCommandDef[] = Reflect.getMetadata(WS_COMMANDS_KEY, TestWs);
    expect(commands).toBeDefined();
    expect(commands.length).toBe(2);
    expect(commands[0]).toEqual({ name: 'ping', method: 'handlePing' });
    expect(commands[1]).toEqual({ name: 'echo', method: 'handleEcho' });
  }

  @Test('@CommandElse stores fallback method name')
  commandElseDecorator() {
    class TestWs {
      @Command('known')
      handleKnown() {}

      @CommandElse
      fallback() {}
    }

    const fallbackMethod = Reflect.getMetadata(WS_COMMAND_ELSE_KEY, TestWs);
    expect(fallbackMethod).toBe('fallback');
  }

  @Test('multiple commands on same class accumulate')
  multipleCommands() {
    class Multi {
      @Command('a') handleA() {}
      @Command('b') handleB() {}
      @Command('c') handleC() {}
    }

    const commands: WsCommandDef[] = Reflect.getMetadata(WS_COMMANDS_KEY, Multi);
    expect(commands.length).toBe(3);
    expect(commands.map(c => c.name)).toEqual(['a', 'b', 'c']);
  }
}

@Suite('WebSocket decorators — @WebSocket path formats')
class WebSocketPathTests {
  @Test('root path /')
  rootPath() {
    @WebSocket('/')
    class RootWs {}
    const meta = Reflect.getMetadata(WEBSOCKET_METADATA_KEY, RootWs);
    expect(meta.path).toBe('/');
  }

  @Test('nested path /api/live')
  nestedPath() {
    @WebSocket('/api/live')
    class LiveWs {}
    const meta = Reflect.getMetadata(WEBSOCKET_METADATA_KEY, LiveWs);
    expect(meta.path).toBe('/api/live');
  }
}
