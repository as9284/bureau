import { defineConfig } from 'vite';
import path from 'node:path';
import { forgeRestartOnRebuild } from './vite.hot-restart';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [forgeRestartOnRebuild('preload')],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, './src/preload/index.ts'),
      formats: ['cjs'],
      fileName: () => 'preload.js',
    },
    rollupOptions: {
      external: ['electron'],
    },
    sourcemap: true,
    minify: false,
  },
});
