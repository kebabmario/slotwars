import type { Action, MatchController, Pending } from '../game/actions.ts';
import type { PlayerId } from '../game/types.ts';
import type { GameSocket } from './socket.ts';

/** Sends actions to the match server. Results come back as new views, handled by GameScreen.receive. */
export class OnlineController implements MatchController {
  readonly seat: PlayerId;
  private sock: GameSocket;
  // starts at the clock so a reloaded page never reuses a sequence number the server has already seen
  private clientSeq = Date.now();

  constructor(sock: GameSocket, seat: PlayerId) {
    this.sock = sock;
    this.seat = seat;
  }

  apply(action: Action): Pending {
    this.sock.send({ t: 'action', clientSeq: ++this.clientSeq, action });
    return { ok: true, pending: true };
  }
}
