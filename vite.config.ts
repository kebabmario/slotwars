import { defineConfig } from 'vite';

// `npm run dev` serves the game; /api is forwarded to the local Pages Functions (`npm run dev:api`).
export default defineConfig({
  server: { proxy: { '/api': 'http://localhost:8788' } },
});
