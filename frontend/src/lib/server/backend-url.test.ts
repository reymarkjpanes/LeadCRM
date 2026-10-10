// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getBackendUrl } from './backend-url';

describe('server API_URL authority', () => {
  it('accepts explicit local configuration and normalizes whitespace and trailing slashes', () => {
    expect(getBackendUrl({ NODE_ENV: 'development', API_URL: ' http://localhost:4000/api/v1/ ' })).toBe('http://localhost:4000/api/v1');
  });
  it('uses the explicit HTTPS production backend', () => {
    expect(getBackendUrl({ NODE_ENV: 'production', API_URL: 'https://api.example.com/api/v1' })).toBe('https://api.example.com/api/v1');
  });
  it.each([undefined, '', '   ', 'http://api.example.com/api/v1', 'https://localhost/api/v1', 'https://api.example.com', 'https://api.example.com/api/v1?token=private', 'https://user:private@api.example.com/api/v1', 'not-a-url'])('rejects unsafe or missing production configuration', API_URL => {
    expect(() => getBackendUrl({ NODE_ENV: 'production', API_URL, NEXT_PUBLIC_API_URL: 'https://legacy.example.com/api/v1' })).toThrow('API_URL must be an explicit');
  });
});
