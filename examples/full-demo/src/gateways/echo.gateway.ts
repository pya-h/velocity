import { WebSocket } from '@velocity/framework';

@WebSocket('/ws/echo')
export class EchoGateway {
  onOpen(ws: any) {
    ws.send(JSON.stringify({ type: 'connected', message: 'Welcome to Velocity WebSocket' }));
  }

  onMessage(ws: any, message: string | Buffer) {
    const text = typeof message === 'string' ? message : message.toString();
    ws.send(JSON.stringify({ type: 'echo', original: text, timestamp: new Date().toISOString() }));
  }

  onClose(_ws: any, code: number, _reason: string) {
    console.log(`  WebSocket closed (code: ${code})`);
  }
}
