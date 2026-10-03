// Local-only component QA. Uses production Role UI/CSS with in-memory fixtures.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
const root = resolve('frontend');
const fixture = resolve(root, 'qa/roles/fixtures.tsx');
const server = await createServer({
  root,
  plugins: [react()],
  resolve: { extensions: ['.ts', '.tsx', '.mjs', '.js', '.jsx', '.json'], alias: [
    { find: '@/store/AuthContext', replacement: fixture },
    { find: '@/store/DataContext', replacement: fixture },
    { find: '@leadcrm/shared', replacement: resolve('shared/src/index.ts') },
    { find: '@', replacement: resolve(root, 'src') },
  ] },
  server: { host: '127.0.0.1', port: 4318, strictPort: true },
});
await server.listen();
console.log('Role editor QA: http://127.0.0.1:4318/qa/roles/index.html');
