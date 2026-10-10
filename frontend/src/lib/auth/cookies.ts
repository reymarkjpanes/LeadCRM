/** Scope backend cookies to this origin without extending their lifetime. */
export function rewriteSetCookie(raw: string): string {
  const [nameValue, ...attributes] = raw.split(/;\s*/);
  const kept = attributes.filter(attribute =>
    !/^(domain|path|samesite)=/i.test(attribute) && !/^httponly$/i.test(attribute),
  );
  if (process.env.NODE_ENV === 'production' && !kept.some(a => /^secure$/i.test(a))) {
    kept.push('Secure');
  }
  return [nameValue, ...kept, 'Path=/', 'HttpOnly', 'SameSite=Lax'].join('; ');
}

export function forwardAuthCookies(source: Headers, destination: Headers): void {
  for (const cookie of source.getSetCookie()) {
    if (cookie.startsWith('leadcrm_token=')) {
      destination.append('Set-Cookie', rewriteSetCookie(cookie));
    }
  }
}
