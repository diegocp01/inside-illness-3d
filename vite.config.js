import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    // three.js alone is ~800 kB; the illness scenes are split into their own small chunks.
    chunkSizeWarningLimit: 1000,
  },
});
