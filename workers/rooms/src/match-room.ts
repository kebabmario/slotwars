import { DurableObject } from 'cloudflare:workers';
import * as E from '../../../src/game/engine.ts';
import { KING_ABILITIES } from '../../../src/game/config.ts';
import { applyAction, eventsFor, redactFor, RULES_VERSION, type Action } from '../../../src/game/actions.ts';
import type { GameEvent, GameState, KingAbility, PlayerId } from '../../../src/game/types.ts';
import { HEARTBEAT, type LobbySeat, type MatchResult, type ServerMsg } from '../../../src/net/protocol.ts';

export interface Env {
  DB: D1Database;
  GRACE_MS?: string; // reconnect grace before the opponent may claim a forfeit (decision D: 120 s)
  ABANDON_MS?: string; // both players gone: abandon, unrated (decision D: 10 min)
}

interface Seat { userId: number; username: string; king: KingAbility; kingName: string; ready: boolean }
interface Room {
  code: string;
  status: 'lobby' | 'active' | 'finished' | 'abandoned';
  createdAt: number;
  host: PlayerId; // seat of the player who created the room
  fog: boolean;
  seats: [Seat | null, Seat | null];
  matchId: string | null;
  startedAt: number | null;
  state: GameState | null;
  seq: number;
  lastClientSeq: [number, number];
  actions: [PlayerId, Action][]; // the whole match, for history and replays
  awaySince: [number | null, number | null];
  abandonAt: number | null;
  result: MatchResult | null;
  interrupted: boolean; // a free-tier limit paused the match at some point (decision G: unrated)
  saved: boolean; // result written to D1
  retryAt: number | null;
  cleanupAt: number | null;
}
interface Attachment { userId: number; username: string; seat: PlayerId }

const LOBBY_MS = 30 * 60_000; // an unstarted room disappears after 30 minutes
const CLEANUP_MS = 10 * 60_000; // finished rooms stay 10 minutes so players can see the result or reconnect
const RETRY_MS = 60_000;
const KINGS = Object.keys(KING_ABILITIES) as KingAbility[];
const other = (p: PlayerId) => (1 - p) as PlayerId;

/** One private match: lobby, then the authoritative game loop. Fog of war is applied before anything leaves. */
export class MatchRoom extends DurableObject<Env> {
  private room: Room | null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(HEARTBEAT.ping, HEARTBEAT.pong)); // answered without waking the object
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)');
    const row = ctx.storage.sql.exec<{ data: string }>('SELECT data FROM room WHERE id = 1').toArray()[0];
    this.room = row ? JSON.parse(row.data) : null;
  }

  private get grace() { return Number(this.env.GRACE_MS ?? 120_000); }
  private get abandonMs() { return Number(this.env.ABANDON_MS ?? 600_000); }

  /** Persists the room (one row write). Throws when storage refuses, e.g. a free-tier daily limit. */
  private save() {
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO room (id, data) VALUES (1, ?)', JSON.stringify(this.room));
  }

  // ---------- creation (RPC from the Pages Function) ----------
  async create(code: string, host: { userId: number; username: string }): Promise<boolean> {
    if (this.room) return false;
    const now = Date.now();
    this.room = {
      code, status: 'lobby', createdAt: now, host: 0, fog: true,
      seats: [{ userId: host.userId, username: host.username, king: 'guardian', kingName: E.sanitizeKingName(undefined), ready: false }, null],
      matchId: null, startedAt: null, state: null, seq: 0, lastClientSeq: [0, 0], actions: [], awaySince: [null, null], abandonAt: null,
      result: null, interrupted: false, saved: false, retryAt: null, cleanupAt: null,
    };
    this.save();
    await this.schedule();
    return true;
  }

  // ---------- connections ----------
  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const userId = Number(req.headers.get('X-User-Id')), username = req.headers.get('X-Username') ?? '';
    const r = this.room;
    if (!r || r.status === 'abandoned') return new Response('No such match', { status: 404 });
    const found = r.seats.findIndex((x) => x?.userId === userId);
    let seat: PlayerId;
    if (found >= 0) seat = found as PlayerId;
    else {
      if (r.status !== 'lobby' || r.seats[1]) return new Response('Match is full', { status: 403 });
      r.seats[1] = { userId, username, king: 'overcharge', kingName: E.sanitizeKingName(undefined), ready: false };
      seat = 1;
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ userId, username, seat } satisfies Attachment);
    r.awaySince[seat] = null;
    r.abandonAt = null;
    this.trySave();
    await this.schedule();
    if (r.status === 'lobby') this.broadcastLobby();
    else {
      this.send(pair[1], this.stateMsg(seat, null, [], undefined));
      this.broadcastPresence();
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketClose(ws: WebSocket) {
    await this.left(ws);
  }
  async webSocketError(ws: WebSocket) {
    await this.left(ws);
  }

  private async left(ws: WebSocket) {
    const r = this.room;
    if (!r) return;
    const { seat } = ws.deserializeAttachment() as Attachment;
    if (this.socketsOf(seat).some((s) => s !== ws)) return; // still connected in another tab
    if (r.status === 'lobby') {
      if (seat !== r.host) r.seats[seat] = null; // a guest who leaves the lobby frees the seat
      else if (r.seats[seat]) r.seats[seat]!.ready = false;
      this.trySave();
      this.broadcastLobby(ws);
      return;
    }
    if (r.status !== 'active') return;
    r.awaySince[seat] = Date.now();
    if (r.awaySince[other(seat)] !== null) r.abandonAt = Date.now() + this.abandonMs;
    this.trySave();
    await this.schedule();
    this.broadcastPresence(ws);
  }

  // ---------- messages ----------
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const r = this.room;
    if (!r || typeof raw !== 'string' || raw.length > 4096) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
      if (typeof msg !== 'object' || msg === null) return;
    } catch {
      return;
    }
    const { seat } = ws.deserializeAttachment() as Attachment;
    switch (msg.t) {
      case 'lobby': return this.onLobby(seat, msg);
      case 'action': return this.onAction(ws, seat, msg);
      case 'resign':
        if (r.status === 'active') return this.finish({ winner: other(seat), reason: 'resign' }, `${r.seats[seat]!.username} resigned.`);
        return;
      case 'claim': {
        const gone = r.awaySince[other(seat)];
        if (r.status !== 'active' || gone === null || Date.now() - gone < this.grace) return this.send(ws, { t: 'rejected', reason: 'Your opponent can still reconnect.' });
        return this.finish({ winner: seat, reason: 'forfeit' }, `${r.seats[other(seat)]!.username} did not return. Forfeit.`);
      }
      case 'snapshot':
        if (r.status === 'lobby') return this.broadcastLobby();
        return this.send(ws, this.stateMsg(seat, null, [], undefined));
    }
  }

  private async onLobby(seat: PlayerId, msg: Record<string, unknown>) {
    const r = this.room!, me = r.seats[seat];
    if (r.status !== 'lobby' || !me) return;
    if (typeof msg.king === 'string' && (KINGS as string[]).includes(msg.king)) me.king = msg.king as KingAbility;
    if (typeof msg.kingName === 'string') me.kingName = E.sanitizeKingName(msg.kingName);
    if (typeof msg.ready === 'boolean') me.ready = msg.ready;
    if (typeof msg.fog === 'boolean' && seat === r.host) {
      r.fog = msg.fog;
      for (const s of r.seats) if (s) s.ready = false; // a settings change needs everyone to confirm again
    }
    if (r.seats[0]?.ready && r.seats[1]?.ready && this.socketsOf(0).length && this.socketsOf(1).length) return this.start();
    this.trySave();
    this.broadcastLobby();
  }

  private async start() {
    const r = this.room!;
    // random first player: swap seats half the time (seat 0 moves first)
    if (crypto.getRandomValues(new Uint8Array(1))[0] & 1) {
      r.seats.reverse();
      r.host = other(r.host);
      for (const ws of this.ctx.getWebSockets()) {
        const a = ws.deserializeAttachment() as Attachment;
        ws.serializeAttachment({ ...a, seat: other(a.seat) });
      }
    }
    const [a, b] = r.seats as [Seat, Seat];
    // decision E: starting points fixed at the standard value; fog chosen by the host
    r.state = E.createGame([a.king, b.king], r.fog, [a.kingName, b.kingName], { playerNames: [a.username, b.username] });
    r.state.events = [];
    r.status = 'active';
    r.matchId = crypto.randomUUID();
    r.startedAt = Date.now();
    r.seq = 1;
    this.trySave();
    await this.schedule();
    for (const ws of this.ctx.getWebSockets()) {
      const { seat } = ws.deserializeAttachment() as Attachment;
      this.send(ws, this.stateMsg(seat, null, [], undefined));
    }
  }

  private async onAction(ws: WebSocket, seat: PlayerId, msg: Record<string, unknown>) {
    const r = this.room!;
    const clientSeq = Number(msg.clientSeq);
    if (r.status !== 'active' || !r.state) return this.send(ws, { t: 'rejected', clientSeq, reason: 'The match is not running.' });
    if (!Number.isInteger(clientSeq) || clientSeq <= r.lastClientSeq[seat]) return this.send(ws, this.stateMsg(seat, null, [], undefined)); // duplicate or replay: resend state
    const before = JSON.stringify(r.state); // rollback point if storage refuses the write
    const res = applyAction(r.state, seat, msg.action);
    const events = r.state.events.splice(0);
    if (!res.ok) return this.send(ws, { t: 'rejected', clientSeq, reason: res.error });
    r.lastClientSeq[seat] = clientSeq;
    r.actions.push([seat, msg.action as Action]);
    r.seq++;
    if (r.state.winner !== null) {
      r.result = r.state.winner === 'draw' ? { winner: null, reason: 'draw' } : { winner: r.state.winner, reason: 'king' };
      r.status = 'finished';
    }
    try {
      this.save(); // saved before anyone hears about it
    } catch (e) {
      // decision G: a free-tier limit pauses the match; it resumes when storage accepts writes again
      r.state = JSON.parse(before);
      r.actions.pop();
      r.seq--;
      r.lastClientSeq[seat] = clientSeq - 1;
      r.status = 'active';
      r.result = null;
      r.interrupted = true;
      this.broadcast({ t: 'paused', reason: 'Server capacity for today is used up. The match is paused and resumes after 08:00 PHT (00:00 UTC). It will not be rated.' });
      console.warn('room save failed', String(e));
      return;
    }
    const action = (msg.action as Action).t;
    for (const s of this.ctx.getWebSockets()) {
      const a = s.deserializeAttachment() as Attachment;
      this.send(s, this.stateMsg(a.seat, seat, eventsFor(r.state, a.seat, events, res.seen[a.seat]), s === ws || a.seat === seat ? { clientSeq, action } : undefined));
    }
    if (r.status === 'finished') await this.afterFinish();
  }

  private async finish(result: MatchResult, line: string) {
    const r = this.room!;
    r.status = 'finished';
    r.result = result;
    r.state!.winner = result.winner ?? 'draw';
    r.state!.log.push({ turn: r.state!.turn, player: null, text: line });
    r.seq++;
    this.trySave();
    for (const ws of this.ctx.getWebSockets()) this.send(ws, this.stateMsg((ws.deserializeAttachment() as Attachment).seat, null, [], undefined));
    await this.afterFinish();
  }

  private async afterFinish() {
    const r = this.room!;
    r.cleanupAt = Date.now() + CLEANUP_MS;
    await this.persistResult();
    await this.schedule();
  }

  /** Writes the finished match to D1 once (idempotent on match id); retried by alarm if D1 refuses. */
  private async persistResult() {
    const r = this.room!;
    if (r.saved || !r.result || !r.matchId) return;
    const [a, b] = r.seats as [Seat, Seat];
    try {
      await this.env.DB.batch([
        this.env.DB.prepare(
          `INSERT OR IGNORE INTO matches (id, mode, invite_code, config, rules_version, started_at, finished_at, winner_seat, result, rated, turns, action_log)
           VALUES (?, 'private', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        ).bind(r.matchId, r.code, JSON.stringify({ fog: r.fog, interrupted: r.interrupted }), RULES_VERSION, r.startedAt, Date.now(),
          r.result.winner, r.result.reason, r.state?.turn ?? 0, JSON.stringify(r.actions)),
        ...[a, b].map((s, i) =>
          this.env.DB.prepare('INSERT OR IGNORE INTO match_players (match_id, seat, user_id, king_ability, king_name) VALUES (?, ?, ?, ?, ?)')
            .bind(r.matchId, i, s.userId, s.king, s.kingName)),
      ]);
      r.saved = true;
      r.retryAt = null;
    } catch (e) {
      r.retryAt = Date.now() + RETRY_MS;
      console.warn('result write failed, will retry', String(e));
    }
    this.trySave();
  }

  // ---------- alarms: abandon, lobby expiry, result retry, cleanup ----------
  private async schedule() {
    const r = this.room;
    if (!r) return;
    const times = [r.abandonAt, r.retryAt, r.cleanupAt, r.status === 'lobby' ? r.createdAt + LOBBY_MS : null].filter((t): t is number => t !== null);
    if (times.length) await this.ctx.storage.setAlarm(Math.min(...times));
    else await this.ctx.storage.deleteAlarm();
  }

  async alarm() {
    const r = this.room;
    if (!r) return;
    const now = Date.now();
    if ((r.cleanupAt !== null && now >= r.cleanupAt && (r.saved || !r.result)) || (r.status === 'lobby' && now >= r.createdAt + LOBBY_MS)) {
      for (const ws of this.ctx.getWebSockets()) {
        this.send(ws, { t: 'closed', reason: r.status === 'lobby' ? 'The invite expired.' : 'The match room has closed.' });
        ws.close(1000, 'closed');
      }
      await this.ctx.storage.deleteAll();
      this.room = null;
      return;
    }
    if (r.abandonAt !== null && now >= r.abandonAt && r.status === 'active') {
      r.abandonAt = null;
      return this.finish({ winner: null, reason: 'abandoned' }, 'Both players left. The match was abandoned (unrated).');
    }
    if (r.retryAt !== null && now >= r.retryAt) await this.persistResult();
    if (r.cleanupAt !== null && now >= r.cleanupAt) r.cleanupAt = now + RETRY_MS; // waiting for the result write first
    this.trySave();
    await this.schedule();
  }

  // ---------- output ----------
  private trySave() {
    try {
      this.save();
    } catch (e) {
      this.room!.interrupted = true;
      console.warn('room save failed', String(e));
    }
  }
  private socketsOf(seat: PlayerId) {
    return this.ctx.getWebSockets().filter((ws) => (ws.deserializeAttachment() as Attachment).seat === seat);
  }
  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket already closing */
    }
  }
  private broadcast(msg: ServerMsg, except?: WebSocket) {
    for (const ws of this.ctx.getWebSockets()) if (ws !== except) this.send(ws, msg);
  }
  private awayLeft(): [number | null, number | null] {
    const r = this.room!, now = Date.now();
    return r.awaySince.map((t) => (t === null ? null : Math.max(0, this.grace - (now - t)))) as [number | null, number | null];
  }
  private broadcastPresence(except?: WebSocket) {
    this.broadcast({ t: 'presence', away: this.awayLeft() }, except);
  }
  private broadcastLobby(except?: WebSocket) {
    const r = this.room!;
    const seats = r.seats.map((s, i): LobbySeat | null =>
      s && { username: s.username, king: s.king, kingName: s.kingName, ready: s.ready, online: this.socketsOf(i as PlayerId).some((w) => w !== except) });
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      this.send(ws, { t: 'lobby', code: r.code, you: (ws.deserializeAttachment() as Attachment).seat, host: r.host, fog: r.fog, seats });
    }
  }
  private stateMsg(you: PlayerId, actor: PlayerId | null, events: GameEvent[], ack: { clientSeq: number; action: Action['t'] } | undefined): ServerMsg {
    const r = this.room!;
    return { t: 'state', seq: r.seq, you, actor, view: redactFor(r.state!, you), events, ack, result: r.result, away: this.awayLeft(), paused: false };
  }
}
