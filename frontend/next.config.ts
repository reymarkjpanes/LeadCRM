import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import { getBackendUrl } from './src/lib/server/backend-url';

export default function nextConfig(phase: string): NextConfig {
  // Validate at build/start. The route handler is the sole forwarding layer so
  // cookie handling and the runtime API_URL cannot be bypassed by a rewrite.
  getBackendUrl();

  return {
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
    async headers() {
      return [{ source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }] }];
    },
  };
}
