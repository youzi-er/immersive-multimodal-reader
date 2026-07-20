import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        officialStudio: fileURLToPath(new URL('./official-studio.html', import.meta.url)),
        officialClueStudio: fileURLToPath(new URL('./official-clue-studio.html', import.meta.url))
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/media': 'http://localhost:3001'
    }
  }
});

