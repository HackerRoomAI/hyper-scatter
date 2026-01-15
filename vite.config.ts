import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // Base path for GitHub Pages - use relative paths so it works regardless of repo/org name
  base: './',
  
  build: {
    outDir: 'dist',
    // Generate source maps for debugging
    sourcemap: true,
    // Multi-page app: include both index.html and benchmark.html
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        benchmark: resolve(__dirname, 'benchmark.html'),
      },
      output: {
        manualChunks: undefined,
      },
    },
  },
  
  // Development server config
  server: {
    port: 5173,
    open: false,
  },
});
