import { defineConfig } from 'vite';

export default defineConfig({
  base: '/ui/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:4500',
      '/admin': 'http://localhost:4500',
      '/mcp': 'http://localhost:4500',
      '/metrics': 'http://localhost:4500',
      '/health': 'http://localhost:4500',
    },
  },
});
