// Messages between the browser and a MatchRoom over the WebSocket. Shared by both sides.
import type { GameEvent, GameState, KingAbility, PlayerId } from '../game/types.ts';
import type { Action } from '../game/actions.ts';

export const HEARTBEAT = { ping: 'ping', pong: 'pong', everyMs: 30_000 } as const; // proxied domains drop idle sockets after ~100 s

/** Invite codes: 6 characters without look-alikes (32^6 ≈ 1 billion). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

export interface LobbySeat {
  username: string;
  king: KingAbility;
  kingName: string;
  ready: boolean;
  online: boolean;
}

export type ResultReason = 'king' | 'draw' | 'resign' | 'forfeit' | 'abandoned';
export interface MatchResult {
  winner: PlayerId | null;
  reason: ResultReason;
}

export type ClientMsg =
  | { t: 'lobby'; king?: KingAbility; kingName?: string; ready?: boolean; fog?: boolean }
  | { t: 'action'; clientSeq: number; action: Action }
  | { t: 'resign' }
  | { t: 'claim' }
  | { t: 'snapshot' };

export type ServerMsg =
  | { t: 'lobby'; code: string; you: PlayerId; host: PlayerId; fog: boolean; seats: (LobbySeat | null)[] }
  | {
      t: 'state';
      seq: number;
      you: PlayerId;
      actor: PlayerId | null; // who caused this update (null for a snapshot)
      view: GameState; // already redacted for `you`
      events: GameEvent[]; // already filtered for `you`
      ack?: { clientSeq: number; action: Action['t'] }; // only to the sender of the action
      result: MatchResult | null;
      away: [number | null, number | null]; // ms of grace left for each seat, null = connected
      paused: boolean;
    }
  | { t: 'presence'; away: [number | null, number | null] }
  | { t: 'rejected'; clientSeq?: number; reason: string }
  | { t: 'paused'; reason: string }
  | { t: 'closed'; reason: string };
