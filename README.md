# Slot Wars

A local, hot-seat, retro pixel-art tactics prototype. Frontend only: no backend, accounts, or online play.

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # rules engine + sprite validation (node --test)
npm run build
```

## Layout

- `src/game/` holds the rules engine. It is pure TypeScript with no DOM. `config.ts` stores every number, and each one is tagged CONFIRMED or PROVISIONAL.
- `src/assets/` holds the hand-made pixel art. There is one file per sprite, each a 16x16 grid of palette letters, so any piece can be swapped on its own.
  - `palette.ts` defines the shared colors. Team colors fill the `T/t/L` letters.
  - `sprites/machines`, `sprites/structures`, `sprites/environment`, `sprites/ui`.
  - `sprites/environment/city-tiles.ts` and `maps.ts` hold the main battlefield's tileset and 12x12 layout.
  - `sprites/environment/industrial-map.ts` paints the Industrial Dimension as one connected facility in 4 animation frames, laid out by zone (the zones are listed at the top of the file).
  - `src/assets/map.ts` turns both boards into images and animation sheets.
- `src/ui/portal-fx.ts` holds the portal transition animation (about 1.1s). Board input is locked while it plays.
  - Settings → Asset Viewer previews everything.
- `src/ui/` holds the screens (menu, setup, how-to, settings, game), the animated city backdrop, the logo, and the LCD counters.

## Settings & match setup

- `src/settings.ts` holds preferences under `slotwars.settings`. The last match setup is stored separately under `slotwars.match`.
  - Everything loaded from storage is validated field by field.
  - Version-1 data migrates automatically ("animations off" becomes Reduced motion).
  - Settings → Restore Defaults resets preferences only and keeps the saved match setup.
- `src/ui/motion.ts` is the single source of animation preferences: quality, speed, reduced motion and decorative effects. It only affects presentation, never rules or timing.

## Tutorial

- Main menu → Tutorial. There are six guided lessons in `src/ui/tutorial-lessons.ts`; the controller and coach window are in `src/ui/tutorial.ts`.
- Each lesson builds its own practice battlefield on the real engine. Steps gate every action through `GameScreen` hooks, so only the requested move is allowed.
- Progress is saved under `slotwars.tutorial`. The tutorial never touches match setup or preferences.

## Audio

Every sound is synthesized by code in this repo. There are no samples or downloaded packs.

```bash
npm run audio   # re-renders public/audio/*.m4a and src/audio/manifest.ts (needs macOS afconvert)
```

- `scripts/audio/dsp.ts`: oscillators, FM, biquad filters, drive and bitcrush, echo, a Freeverb-style reverb, seamless loop wrapping, and a WAV writer.
- `scripts/audio/sfx.ts`: 28 effect recipes. `scripts/audio/music.ts`: 3 music loops and 2 ambience beds.
- Output: AAC `.m4a` files. Effects are mono at 64 kbps, music is stereo at 128 kbps, ambience is stereo at 96 kbps. The total is about 2.6 MB.
- `src/audio/audio.ts` is the single audio manager:
  - Music, sfx and ambience buses feed a master compressor.
  - Nothing plays until the first user gesture.
  - Each sound has a cooldown and a voice cap, and there is also a global voice cap.
  - Loops are sample-accurate, and tracks crossfade when the scene changes.
- Volume controls are in Settings → Audio.

## Provisional rules (not in the brief, all in `src/game/config.ts`)

- Fog of war: you see your home quadrant plus any quadrant one of your machines occupies. Spotter reveals one more. Enemy traps stay hidden.
- SP abilities don't use the turn action. Medic Repair does.
- Area abilities (2x2, 3x3, 4x4) must include the caster's tile. Hulk Smash spares the caster.
- Guardian blocks attacks and turret shots, not ability damage. Fortify and Shield Wall reduce all damage.
- Overcharge powers the player's next attack with any machine.
- Machines can attack enemy turrets and repair stations. Only Breachers can hit barricades.
- Structure costs and HP, turret range and damage, repair station range and heal, and trap damage.
- Turrets fire at the end of their owner's turn. Only enemy barricades block their bullets.
- Portal: the dimension-side portal sits at A12, and summoned machines arrive near L1.
- The dimension has no fog. Spawning, turrets, repair stations and traps exist only on the main battlefield.
- The 3-turn counter only runs while the opponent has no machines in the dimension. It resets once a summon fires.
- Phantom always lands in the home quadrant of the main battlefield.
- Industrial research: +1 research for each own turn that ends with a machine in the dimension. Unlock thresholds: Welder/Conveyor 1, Mine/Tesla 2, Juggernaut/Drone Dock 3, Crusher 4. Unlocks last for the current match only.
- Industrial machines: Juggernaut (cost 6, 60 HP, Plating −8, Barrier −8 in a 3x3 area for 6 SP), Welder (cost 4, Repair +8 to an orthogonally adjacent ally using the action, Reconstruction for 5 SP from the main battlefield), Crusher (cost 7, +15 damage against structures, Groundbreaker 15 damage to enemies in a 3x3 area for 6 SP, no friendly fire).
- Industrial spawnables: Conveyor (cost 1, pushes the machine on it at the end of every turn), Tesla (cost 4, 30 HP, +1 SP per turn), Drone Dock (cost 4, 30 HP, drone heals +5 per turn and follows into the dimension), Overload Mine (cost 3, hidden, 15 damage plus 1-turn jam).
- All of these values live in `INDUSTRIAL`, `INDUSTRIAL_VALUES`, `MACHINES`, `STRUCTURES`, `TESLA`, `DRONE`, `OVERLOAD_MINE` and `CONVEYOR` in `src/game/config.ts`.

## Online (in progress, Cloudflare free plan)

Local hot-seat, the tutorial and settings never need the server.

- `src/game/actions.ts`: the only way to change a match (`applyAction`), plus fog-of-war redaction (`redactFor`, `eventsFor`). Shared by local play and the future match server.
- `functions/api/*`: Pages Functions for `register`, `login`, `logout`, `me`, `profile`, `recover`. Accounts need no email. Each one gets a one-time recovery code, stored hashed.
- `workers/rooms`: the `slotwars-rooms` Worker, with no public URL.
  - `AuthGate` hashes passwords (Argon2id with a secret pepper) and throttles failed logins.
  - `MatchRoom` runs one private match: lobby, then the authoritative game loop. Fog of war is applied before anything is sent. It also handles the 120 s reconnect grace with forfeit claims, abandons a match after 10 min when both players are gone, and writes the result to D1.
- `functions/api/rooms.ts` creates an invite code. `functions/ws/[code].ts` checks the session and Origin, then hands the WebSocket to the room.
- `src/net/`: the protocol, the socket (heartbeat and reconnect), `OnlineController`. `src/ui/lobby.ts` is the lobby. `GameScreen` takes an optional `OnlineSession`; without one it is the same hot-seat game.
- `migrations/`: D1 schema (`slotwars-db`).

Local development (no Cloudflare account needed):

```bash
npm run db:migrate:local   # once
npm run dev:rooms          # Durable Objects on :8790
npm run dev:api            # built game + API on :8788 (or `npm run dev`; Vite forwards /api)
npm run test:api           # end-to-end account checks against local D1
npm run test:match         # two scripted players over WebSockets: lobby, fog leaks, portal, reconnect, forfeit, abandon
```

Local secrets live in `.dev.vars` and `workers/rooms/.dev.vars`. They are never deployed. Production secrets are `PEPPER` on `slotwars-rooms` and, optionally, `TURNSTILE_SECRET` on the Pages project. Turnstile is enforced only when that secret is set. The browser side needs `VITE_TURNSTILE_SITE_KEY` at build time.

**Do not delete or rotate the `PEPPER` secret.** Every stored password depends on it. If it is lost, players can only get back in with their recovery codes.
