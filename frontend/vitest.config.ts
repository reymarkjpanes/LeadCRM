import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.mjs', '.js', '.cjs', '.json'],
    alias: {
      '@/features/tenant': path.resolve(__dirname, './src/features/tenant'),
      '@/shared': path.resolve(__dirname, './src/shared'),
      '@/store': path.resolve(__dirname, './src/store'),
      '@/lib': path.resolve(__dirname, './src/lib'),
      '@leadcrm/shared': path.resolve(__dirname, '../shared/src/index.ts'),
      '@': path.resolve(__dirname, '.'),
    },
  },
});
