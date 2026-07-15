import { defineConfig } from 'vitest/config';
import path from 'node:path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './src/shared'),
      '@main': path.resolve(__dirname, './src/main'),
      '@renderer': path.resolve(__dirname, './src/renderer'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['tests/component/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['tests/component/setup.ts'],
  },
});
