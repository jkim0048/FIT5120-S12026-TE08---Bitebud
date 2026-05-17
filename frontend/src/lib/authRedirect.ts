/** Same-origin path only (may include query); avoids open redirects and post-login loops via /auth. */
export function safePostAuthRedirect(raw: unknown, fallback = '/start'): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) return fallback
  const pathOnly = raw.split(/[?#]/)[0] ?? ''
  if (!pathOnly || pathOnly.startsWith('/unlock')) return fallback
  if (pathOnly === '/auth' || pathOnly.startsWith('/auth/')) return fallback
  return raw
}
