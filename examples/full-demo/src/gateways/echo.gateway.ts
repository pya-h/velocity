import { WebSocket } from '@velocity/framework';
import { velo } from '../../velo';

/**
 * Approach A: manual onMessage handler.
 * Full control — developer handles raw messages directly.
 * All @Command decorators are ignored when onMessage exists.
 *
 * Try:  wscat -c ws://localhost:5000/ws/echo
 *       > hello
 *       < {"type":"echo","original":"hello","timestamp":"..."}
 */
@WebSocket('/ws/echo')
export class EchoGateway {
  onOpen(ws: unknown): void {
    (ws as { send(d: string): void }).send(
      JSON.stringify({ type: 'connected', message: 'Welcome to Velocity WebSocket' }),
    );
  }

  onMessage(ws: unknown, message: string | Buffer): void {
    const text = typeof message === 'string' ? message : message.toString();
    (ws as { send(d: string): void }).send(
      JSON.stringify({ type: 'echo', original: text, timestamp: new Date().toISOString() }),
    );
  }

  onClose(_ws: unknown, code: number): void {
    console.log(`  WebSocket /ws/echo closed (code: ${code})`);
  }
}

velo.register(EchoGateway);
