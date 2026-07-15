import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './src/shared'),
      '@renderer': path.resolve(__dirname, './src/renderer'),
    },
  },
  build: {
    sourcemap: true,
    minify: false,
    rollupOptions: {
      input: path.resolve(__dirname, './src/renderer/index.html'),
    },
  },
});
