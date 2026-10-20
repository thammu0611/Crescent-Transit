import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = `http://localhost:${process.env.PORT ?? 4000}`;

export default defineConfig({
  root: 'client',
  envDir: '..', // VITE_ variables (e.g. the Google Maps key) live in the project-root .env
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    fs: { allow: ['..'] }, // the client imports ../shared (geo + freshness)
    proxy: {
      '/api': API,
      '/socket.io': { target: API, ws: true },
    },
  },
});
