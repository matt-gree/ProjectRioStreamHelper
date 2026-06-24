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
    rollupOptions: {
      input: './src/main.jsx'
    }
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
    include: ['src/**/*.test.{js,jsx}'],
  },
});