/** Only metadata is retained; never expose a provider response body. */
export function providerRetryAt(headers: Pick<Headers, 'get'>, now = Date.now()): number | undefined {
  const value = headers.get('retry-after');
  if (!value?.trim()) return undefined;
  const at = /^\d+(?:\.\d+)?$/.test(value.trim()) ? now + Number(value) * 1000 : Date.parse(value);
  return Number.isFinite(at) && at > now && at <= now + 30 * 86400000 ? at : undefined;
}
