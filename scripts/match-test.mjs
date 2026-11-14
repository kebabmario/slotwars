// Two scripted players over real WebSockets against the local stack: lobby, full matches with fog,
// portal and Portal Surge, rejected and duplicate messages, raw-frame fog leak checks, reconnect,
// forfeit, resign, abandon, and the result rows in D1.
import { setTimeout as sleep } from 'node:timers/promises';
import * as E from '../src/game/engine.ts';
import { STRUCTURES, DIMENSION } from '../src/game/config.ts';
import { API, check, post, req, startStack, TURNSTILE_TEST_TOKEN as T } from './harness.mjs';

const GRACE = 3000, ABANDON = 6000;
const stack = await startStack({ roomVars: { GRACE_MS: GRACE, ABANDON_MS: ABANDON } });
const WS = API.replace('http', 'ws');

function connect(code, cookie, origin = API) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WS}/ws/${code}`, { headers: { Cookie: cookie ?? '', Origin: origin } });
    const c = { ws, msgs: [], raw: [], open: false, seq: 0 };
    c.send = (o) => ws.send(typeof o === 'string' ? o : JSON.stringify(o));
    c.next = (pred, ms = 8000) =>
      new Promise((res) => {
        const t0 = Date.now();
        const tick = () => {
          const i = c.msgs.findIndex(pred);
          if (i >= 0) return res(c.msgs.splice(0, i + 1).at(-1));
          if (Date.now() - t0 > ms) return res(null);
          setTimeout(tick, 15);
        };
        tick();
      });
    ws.onmessage = (e) => {
      if (e.data === 'pong') return void (c.pongs = (c.pongs ?? 0) + 1);
      c.raw.push(e.data);
      const m = JSON.parse(e.data);
      if (m.t === 'state') c.last = m;
      c.msgs.push(m);
    };
    ws.onopen = () => ((c.open = true), resolve(c));
    ws.onclose = () => ((c.closed = true), resolve(c));
  });
}
const lastOf = (rows) => JSON.parse(rows).at(-1).results;

// ---------- fog leak check on one raw frame, from the receiver's point of view ----------
let leaks = 0, framesChecked = 0;
function leakCheck(msg, prevView) {
  if (msg.t !== 'state' || !msg.view.fog) return;
  framesChecked++;
  const v = msg.view, me = msg.you, opp = 1 - me;
  const seen = new Set([...E.visibleQuadrants(v, me), ...(prevView ? E.visibleQuadrants(prevView, me) : [])]);
  const ok = (dim, p) => (dim === 1 && !DIMENSION.fog) || seen.has(E.quadrantOf(p));
  for (const m of v.machines) if (m.owner === opp && !ok(m.dim, m.pos)) leaks++;
  for (const st of v.structures) if (st.owner === opp && STRUCTURES[st.kind].hidden && !(v.players[me].revealThrough >= v.turn)) leaks++;
  for (const l of v.log) if (l.player === opp && /^Deployed a /.test(l.text)) leaks++;
  for (const e of msg.events) {
    if ((e.type === 'spawn' || e.type === 'ability') && e.owner === me) continue;
    if (e.type === 'spawn' && STRUCTURES[e.kind]?.hidden) leaks++;
    const cells = e.type === 'ability' ? [e.from, e.to, ...e.cells] : e.type === 'area' ? e.cells : e.type === 'shot' || e.type === 'push' ? [e.from, e.to] : [e.pos];
    for (const p of cells) if (!ok(e.type === 'ability' && p === e.to ? e.toDim : e.dim, p)) leaks++;
  }
}

// ---------- a legal action chosen from the player's own (redacted) view ----------
function rng(seed) {
  return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}
function choose(v, rand) {
  const me = v.current, pick = (xs) => xs[Math.floor(rand() * xs.length)];
  if (v.pendingSummon === me) {
    const pool = E.getSummonCandidates(v);
    return { t: 'summon', ids: pool.slice(0, Math.min(2, pool.length)).map((m) => m.id) };
  }
  const opts = [];
  if (!v.actionUsed) {
    for (const m of v.machines.filter((x) => x.owner === me)) {
      const moves = E.getMoveTargets(v, m.id);
      // bias towards the portal so matches reach the Industrial Dimension and the Portal Surge
      const portal = E.portalOf(m.dim);
      const best = moves.slice().sort((a, b) => Math.abs(a.pos.r - portal.r) + Math.abs(a.pos.c - portal.c) - (Math.abs(b.pos.r - portal.r) + Math.abs(b.pos.c - portal.c)))[0];
      if (best && m.dim === 0) opts.push({ t: 'move', id: m.id, to: best.pos }, { t: 'move', id: m.id, to: best.pos });
      for (const o of moves) opts.push({ t: 'move', id: m.id, to: o.pos });
      for (const o of E.getAttackTargets(v, m.id)) opts.push({ t: 'attack', id: m.id, at: o.pos }, { t: 'attack', id: m.id, at: o.pos });
    }
  }
  for (const kind of ['scout', 'striker', 'trap', 'turret', 'mine']) {
    const tiles = E.getSpawnTiles(v, kind);
    if (tiles.length && rand() < 0.5) opts.push({ t: 'spawn', kind, at: pick(tiles) });
  }
  if (!opts.length || rand() < 0.25) return { t: 'endTurn' };
  return pick(opts);
}

async function lobbyToStart(a, b) {
  await a.next((m) => m.t === 'lobby' && m.seats[1]);
  b.send({ t: 'lobby', king: 'phantom', kingName: 'Bolt' });
  a.send({ t: 'lobby', ready: true });
  b.send({ t: 'lobby', ready: true });
  const sa = await a.next((m) => m.t === 'state'), sb = await b.next((m) => m.t === 'state');
  return { sa, sb };
}

let crashed = null;
try {
  const A = await post('/api/register', { username: 'alice', password: 'first player secret 1', turnstile: T });
  const B = await post('/api/register', { username: 'bruno', password: 'second player secret 2', turnstile: T });
  const C = await post('/api/register', { username: 'carla', password: 'third player secret 3', turnstile: T });

  // ---------- creating and joining ----------
  check('create needs a session', (await post('/api/rooms', {})).status === 401);
  check('create needs our Origin', (await post('/api/rooms', {}, { cookie: A.cookie, origin: 'https://evil.example' })).status === 403);
  const room = await post('/api/rooms', {}, { cookie: A.cookie });
  const code = room.body?.code;
  check('create returns an invite code', room.status === 201 && /^[A-HJ-NP-Z2-9]{6}$/.test(code ?? ''), code);
  check('unknown code refused', !(await connect('ZZZZZZ', A.cookie)).open);
  check('socket without session refused', !(await connect(code, null)).open);
  check('socket from foreign Origin refused', !(await connect(code, A.cookie, 'https://evil.example')).open);
  const a = await connect(code, A.cookie), b = await connect(code.toLowerCase(), B.cookie);
  check('host and guest connect (code is case-insensitive)', a.open && b.open);
  check('a third player is refused', !(await connect(code, C.cookie)).open);
  const lob = await a.next((m) => m.t === 'lobby' && m.seats[1]?.username === 'bruno');
  check('lobby shows both players', !!lob && lob.seats[0].username === 'alice' && lob.you === 0 && lob.host === 0);
  b.send({ t: 'lobby', fog: false }); // guest: ignored
  a.send({ t: 'lobby', ready: true });
  const readyMsg = await b.next((m) => m.t === 'lobby' && m.seats[0].ready);
  check('guest cannot change fog', readyMsg?.fog === true);
  a.send({ t: 'lobby', fog: false });
  const reset = await b.next((m) => m.t === 'lobby' && m.fog === false);
  check('host changes fog; the change clears ready', !!reset && !reset.seats[0].ready);
  a.send({ t: 'lobby', fog: true });
  await b.next((m) => m.t === 'lobby' && m.fog === true);
  const { sa, sb } = await lobbyToStart(a, b);
  check('both ready: match starts for both', sa?.view && sb?.view && sa.you !== sb.you, `alice is seat ${sa?.you}`);
  check('guest King choice applied', [sa, sb].some((s) => s.view.players.some((p) => p.kingName === 'Bolt')));

  // ---------- protocol rules ----------
  const byTurn = () => (a.last.view.current === a.last.you ? [a, b] : [b, a]);
  let [mover, waiter] = byTurn();
  waiter.send({ t: 'action', clientSeq: 1, action: { t: 'endTurn' } });
  check('out-of-turn action rejected', (await waiter.next((m) => m.t === 'rejected'))?.reason === 'Not your turn.');
  mover.send({ t: 'action', clientSeq: 1, action: { t: 'nuke' } });
  check('malformed action rejected', (await mover.next((m) => m.t === 'rejected'))?.reason === 'Malformed action.');
  mover.send('{not json');
  mover.send({ t: 'action', clientSeq: 2, action: { t: 'endTurn' } });
  const ended = await waiter.next((m) => m.t === 'state' && m.actor !== null);
  check('legal action broadcast to the opponent, ack only to the sender', !!ended && !ended.ack && !!(await mover.next((m) => m.t === 'state' && m.ack?.clientSeq === 2)));
  const seqBefore = ended.seq;
  mover.send({ t: 'action', clientSeq: 2, action: { t: 'endTurn' } });
  const dup = await mover.next((m) => m.t === 'state');
  check('duplicate clientSeq ignored', dup?.seq === seqBefore && dup.actor === null);

  // ---------- full random match with fog, biased into the portal ----------
  const rand = rng(7);
  const seqs = { [a.last.you]: 10, [b.last.you]: 10 };
  const prevView = new Map();
  let actions = 0, warps = 0, summons = 0, rejected = 0;
  for (let i = 0; i < 600 && !a.last.result; i++) {
    [mover, waiter] = byTurn();
    const v = mover.last.view;
    const act = choose(v, rand);
    const cs = ++seqs[mover.last.you];
    mover.send({ t: 'action', clientSeq: cs, action: act });
    const reply = await mover.next((m) => (m.t === 'state' && m.ack?.clientSeq === cs) || (m.t === 'rejected' && m.clientSeq === cs));
    if (!reply) throw new Error(`no reply to ${JSON.stringify(act)}`);
    if (reply.t === 'rejected') { rejected++; if (act.t !== 'endTurn') { mover.send({ t: 'action', clientSeq: ++seqs[mover.last.you], action: { t: 'endTurn' } }); await mover.next((m) => m.t === 'state' && m.ack); } continue; }
    actions++;
    if (act.t === 'summon') summons++;
    await waiter.next((m) => m.t === 'state' && m.seq === reply.seq);
    for (const c of [a, b]) {
      for (const raw of c.raw.splice(0)) {
        const msg = JSON.parse(raw);
        if (msg.t !== 'state') continue;
        if (msg.events.some((e) => e.type === 'warp')) warps++;
        leakCheck(msg, prevView.get(c));
        prevView.set(c, msg.view);
      }
    }
  }
  check('random fog match: no hidden machine, trap, mine, event or log line in any raw frame', leaks === 0 && framesChecked > 200, `${framesChecked} frames, ${actions} actions, ${rejected} rejected`);
  check('match reached the Industrial Dimension', a.last.view.machines.some((m) => m.dim === 1) || warps > 0, `${warps} warp events`);
  check('Portal Surge summon played over the network', summons > 0, `${summons} summons`);
  if (!a.last.result) {
    mover.send({ t: 'resign' });
    await a.next((m) => m.t === 'state' && m.result);
  }
  const res1 = a.last.result;
  check('match finished with a result', !!res1, JSON.stringify(res1));
  await sleep(500);
  const m1 = lastOf(stack.d1(`SELECT result, winner_seat, rated, turns, length(action_log) AS log FROM matches`));
  check('result written to D1 once, unrated, with the action log', m1.length === 1 && m1[0].result === res1.reason && m1[0].rated === 0 && m1[0].log > 100, JSON.stringify(m1[0]));
  check('both players recorded', lastOf(stack.d1('SELECT COUNT(*) AS n FROM match_players'))[0].n === 2);
  a.ws.close(); b.ws.close();

  // ---------- reconnect within grace, then forfeit ----------
  const code2 = (await post('/api/rooms', {}, { cookie: A.cookie })).body.code;
  let a2 = await connect(code2, A.cookie), b2 = await connect(code2, B.cookie);
  await lobbyToStart(a2, b2);
  b2.ws.close();
  const away = await a2.next((m) => m.t === 'presence' && m.away.some((x) => x !== null));
  check('opponent disconnect announced with grace', !!away && Math.max(...away.away.filter((x) => x !== null)) <= GRACE);
  b2 = await connect(code2, B.cookie);
  const snap = await b2.next((m) => m.t === 'state');
  check('reconnect within grace gets a snapshot', !!snap?.view && snap.actor === null);
  check('presence cleared on return', !!(await a2.next((m) => m.t === 'presence' && m.away.every((x) => x === null))));
  b2.ws.close();
  await a2.next((m) => m.t === 'presence' && m.away.some((x) => x !== null));
  a2.send({ t: 'claim' });
  check('forfeit claim before grace ends refused', !!(await a2.next((m) => m.t === 'rejected')));
  await sleep(GRACE + 300);
  a2.send({ t: 'claim' });
  const forfeit = await a2.next((m) => m.t === 'state' && m.result);
  check('forfeit claim after grace wins', forfeit?.result?.reason === 'forfeit' && forfeit.result.winner === forfeit.you);
  a2.ws.close();

  // ---------- both leave: abandoned ----------
  const code3 = (await post('/api/rooms', {}, { cookie: A.cookie })).body.code;
  const a3 = await connect(code3, A.cookie), b3 = await connect(code3, B.cookie);
  await lobbyToStart(a3, b3);
  a3.ws.close(); b3.ws.close();
  await sleep(ABANDON + 2000);
  const rows = lastOf(stack.d1(`SELECT result FROM matches ORDER BY finished_at`)).map((r) => r.result);
  check('forfeit and abandoned matches recorded', rows.includes('forfeit') && rows.at(-1) === 'abandoned', rows.join(','));
  const back = await connect(code3, A.cookie);
  const after = await back.next((m) => m.t === 'state');
  check('rejoining an abandoned match shows the result', after?.result?.reason === 'abandoned');
  back.ws.close();

  // ---------- heartbeat ----------
  const code4 = (await post('/api/rooms', {}, { cookie: A.cookie })).body.code;
  const h = await connect(code4, A.cookie);
  h.send('ping');
  await sleep(300);
  check('heartbeat ping answered with pong', h.pongs === 1);
  h.ws.close();
} catch (e) {
  crashed = e;
} finally {
  await stack.stop(crashed);
}
