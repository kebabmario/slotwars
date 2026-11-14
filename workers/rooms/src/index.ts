// slotwars-rooms: Durable Objects for Slot Wars online play. Reached only through bindings from the
// Pages Functions (workers_dev is off), so nothing here is directly exposed to the internet.
export { AuthGate } from './auth-gate.ts';
export { MatchRoom } from './match-room.ts';

export default {
  fetch: () => new Response('Not found', { status: 404 }),
} satisfies ExportedHandler;
