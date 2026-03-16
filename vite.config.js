import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
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
    react()
  ],
});