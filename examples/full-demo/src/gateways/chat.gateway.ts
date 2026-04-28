import { WebSocket, Command, CommandElse } from '@velocity/framework';
import { velo } from '../../velo';

/**
 * Approach B: @Command-based dispatch.
 * Client sends JSON: { "cmd": "ping", "data": {...} }
 * Server responds:   { "ok": true, "cmd": "ping", "data": "pong", "error": null }
 *
 * Try:  wscat -c ws://localhost:5000/ws/chat
 *       > {"cmd":"ping"}
 *       < {"ok":true,"cmd":"ping","data":"pong","error":null}
 *
 *       > {"cmd":"broadcast","data":{"text":"hello"}}
 *       < {"ok":true,"cmd":"broadcast","data":{"sent":true,"text":"hello"},"error":null}
 *
 *       > {"cmd":"unknown"}
 *       < {"ok":true,"cmd":"unknown","data":{"echo":"unknown","hint":"Use ping or broadcast"},"error":null}
 */

interface BroadcastData {
  text: string;
}

@WebSocket('/ws/chat')
export class ChatGateway {
  onOpen(ws: unknown): void {
    (ws as { send(d: string): void }).send(
      JSON.stringify({ ok: true, cmd: 'connected', data: { message: 'Chat gateway ready' }, error: null }),
    );
  }

  // ── @Command handlers — data is the first param, ws is optional ───────────

  @Command('ping')
  ping(): string {
    return 'pong';
  }

  @Command('time')
  time(): { iso: string; unix: number } {
    return { iso: new Date().toISOString(), unix: Date.now() };
  }

  @Command('broadcast')
  broadcast(data: BroadcastData): { sent: boolean; text: string } {
    // In a real app, you'd iterate connected clients here
    return { sent: true, text: data?.text || '' };
  }

  @Command('echo')
  echo(data: unknown): unknown {
    return data;
  }

  // ── @CommandElse — fallback for unrecognized commands ──────────────────────

  @CommandElse
  fallback(cmd: string): { echo: string; hint: string } {
    return { echo: cmd, hint: 'Use ping or broadcast' };
  }

  onClose(_ws: unknown, code: number): void {
    console.log(`  WebSocket /ws/chat closed (code: ${code})`);
  }
}

velo.register(ChatGateway);
