// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from 'next/constants';
import nextConfig from '../../next.config';

afterEach(() => vi.unstubAllEnvs());

it('keeps dev artifacts separate while build and production start share the standard output', () => {
  vi.stubEnv('API_URL', 'https://api.example.com/api/v1');
  expect(nextConfig(PHASE_DEVELOPMENT_SERVER).distDir).toBe('.next-dev');
  expect(nextConfig(PHASE_PRODUCTION_BUILD).distDir).toBe('.next');
  expect(nextConfig(PHASE_PRODUCTION_SERVER).distDir).toBe('.next');
});
