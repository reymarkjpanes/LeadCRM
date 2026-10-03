// Read-only release check: verify the backend reached by the browser's actual proxy.
const [origin, expectedCommit] = process.argv.slice(2);
if (!origin || !/^[a-f0-9]{40}$/i.test(expectedCommit ?? '')) {
  console.error('Usage: node scripts/verify-deployment.cjs <frontend-origin> <expected-full-git-sha>');
  process.exit(1);
}
(async () => {
  const response = await fetch(new URL('/api/proxy/health', origin), {
    cache: 'no-store', signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Proxy health returned HTTP ${response.status}`);
  const health = await response.json();
  if (health.status !== 'ok' || health.commit !== expectedCommit) {
    throw new Error(`Backend deployment mismatch: expected ${expectedCommit}, received ${health.commit ?? 'unknown'}. Check API_URL and deploy the matching backend before releasing the frontend.`);
  }
  console.log(`PASS: frontend proxy reaches backend commit ${health.commit}`);
  const session = await fetch(new URL('/api/proxy/auth/me', origin), {
    cache: 'no-store', signal: AbortSignal.timeout(30000),
  });
  if (session.status !== 401) throw new Error(`Session route check failed: expected HTTP 401 without a session, received ${session.status}.`);
  console.log('PASS: the session route requires authentication');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
