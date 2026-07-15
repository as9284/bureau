import { defineConfig } from 'vite';
import path from 'node:path';
import { forgeRestartOnRebuild } from './vite.hot-restart';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [forgeRestartOnRebuild('main')],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './src/shared'),
      '@main': path.resolve(__dirname, './src/main'),
    },
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, './src/main/main.ts'),
      formats: ['cjs'],
      fileName: () => 'main.js',
    },
    rollupOptions: {
      external: ['electron', 'node:*', 'node-pty'],
    },
    sourcemap: true,
    minify: false,
  },
});
