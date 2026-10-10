import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: ['dist/**', 'node_modules/**', 'scripts/**/*.test.cjs', 'scripts/**/*.test.mjs'],
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.mjs', '.js', '.cjs', '.json'],
    alias: {
      '@leadcrm/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
});
