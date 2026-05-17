const STORAGE_KEY = 'bitebud_site_unlock'

/** Client-side gate only; set in `frontend/.env` as `VITE_SITE_ACCESS_PASSWORD`. */
export function getSiteAccessPassword(): string {
  const v = import.meta.env.VITE_SITE_ACCESS_PASSWORD
  return typeof v === 'string' ? v.trim() : ''
}

export function isSitePasswordConfigured(): boolean {
  return getSiteAccessPassword().length > 0
}

export function isSiteUnlocked(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function setSiteUnlocked(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, '1')
  } catch {
    /* private mode */
  }
}

/** Same-origin path only; prevents open redirects. */
export function safeUnlockRedirect(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) return '/'
  if (raw.startsWith('/unlock')) return '/'
  return raw
}
