import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = `http://localhost:${process.env.PORT ?? 4000}`;

export default defineConfig({
  root: 'client',
  envDir: '..', // VITE_ variables (e.g. the Google Maps key) live in the project-root .env
  plugins: [react()],
  // Oldest browsers served: the first versions with :has(), which the styles rely on.
  build: { outDir: 'dist', emptyOutDir: true, target: ['es2020', 'chrome105', 'edge105', 'firefox121', 'safari15.4', 'ios15.4'] },
  server: {
    port: 5173,
    fs: { allow: ['..'] }, // the client imports ../shared (geo + freshness)
    proxy: {
      '/api': API,
      '/ocr': API, // the document reader's OCR engine (server/app.js)
      '/socket.io': { target: API, ws: true },
    },
  },
});
