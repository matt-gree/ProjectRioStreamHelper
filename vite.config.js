import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    manifest: true,
    /*
     * Raised from Rollup's 500kB default to sit just above the vendor chunk.
     *
     * This is not the warning being silenced — its advice has been taken. The
     * app IS code-split now (four lazy routes, vendor separated), and what is
     * left over the default is one deliberate dependency bundle at ~510kB
     * that a three-way split cannot safely reduce (see manualChunks below).
     * Left at 500 the build warned on every single run about a state with no
     * action attached, which is how a team stops reading its own build output
     * — the condition that let the original 1MB single chunk sit unnoticed.
     *
     * Kept deliberately TIGHT rather than set to some round number well clear
     * of today's size: at 600 this still fires if vendor grows ~18%, which is
     * the point of having it at all.
     */
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      input: './src/main.jsx',
      output: {
        /*
         * ONE vendor chunk, split from app code — and deliberately NOT split
         * any finer than that.
         *
         * The win is caching on a clock, not byte count: PRSH ships often and
         * its dependencies essentially never, so a single combined bundle made
         * every release re-download ~500kB of unchanged library code. That
         * matters here because an OBS machine is often a second PC on a
         * venue's network.
         *
         * A three-way split (react / ui / vendor) was tried and REVERTED: it
         * builds clean and then throws `Cannot read properties of undefined
         * (reading 'useLayoutEffect')` at runtime, because pulling React into
         * its own chunk leaves packages that reach for the React namespace
         * executing before that chunk has initialised. Rollup cannot order
         * the pair when the dependency runs both ways. The blank page is the
         * only symptom, so this is not something a green build will catch —
         * if you split this further, LOAD THE APP.
         *
         * Lazy routes are left alone: Rollup already gives each one its own
         * chunk (routes/root.jsx), and naming them here would pull them back
         * into the eager graph.
         */
        manualChunks(id) {
          return id.includes('node_modules') ? 'vendor' : undefined;
        },
      },
    },
  },
  server: {
    host: true,   // Listen on 0.0.0.0 so other devices can connect
    cors: true,   // Allow cross-origin requests (page served from :5260, Vite on :5173)
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
  // Vitest config — read by `vitest` from this same file.
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    // The overlay runtime's tests live beside the Python suite: public/ is
    // served as-is, so a test there would be a page anyone could load.
    include: ['src/**/*.test.{js,jsx}', 'tests/overlay/**/*.test.js'],
  },
});