// WebSocket to one match room: heartbeat, automatic reconnect with backoff, JSON messages.
import { HEARTBEAT, type ClientMsg, type ServerMsg } from './protocol.ts';

export type SocketStatus = 'open' | 'reconnecting' | 'failed' | 'closed';

export class GameSocket {
  private ws: WebSocket | null = null;
  private beat = 0;
  private tries = 0;
  private everOpen = false;
  private done = false;
  private code: string;
  private onMsg: (m: ServerMsg) => void;
  private onStatus: (s: SocketStatus) => void;

  constructor(code: string, onMsg: (m: ServerMsg) => void, onStatus: (s: SocketStatus) => void) {
    this.code = code;
    this.onMsg = onMsg;
    this.onStatus = onStatus;
    this.open();
  }

  private open() {
    const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws/${encodeURIComponent(this.code)}`);
    this.ws = ws;
    ws.onopen = () => {
      this.everOpen = true;
      this.tries = 0;
      this.onStatus('open');
      clearInterval(this.beat);
      this.beat = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(HEARTBEAT.ping), HEARTBEAT.everyMs);
    };
    ws.onmessage = (e) => {
      if (e.data === HEARTBEAT.pong) return;
      let m: ServerMsg;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.t === 'closed') this.done = true;
      this.onMsg(m);
    };
    ws.onclose = () => {
      clearInterval(this.beat);
      if (this.done) return this.onStatus('closed');
      // never opened: wrong code, full match or signed out; the server refuses before the upgrade
      if (!this.everOpen) return this.onStatus('failed');
      this.onStatus('reconnecting');
      const wait = Math.min(10_000, 1000 * 2 ** this.tries++);
      setTimeout(() => !this.done && this.open(), wait);
    };
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.done = true;
    clearInterval(this.beat);
    this.ws?.close(1000, 'left');
  }
}
