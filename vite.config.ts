import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages (/ferry-port/) and any static host.
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1000 },
});
