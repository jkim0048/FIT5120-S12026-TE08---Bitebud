const KEY = 'bitebud_user_id'

const ID_RE = /^[A-Z0-9]{3}$/

/** Uppercase A–Z and 0–9, length 3. */
export function normalizeBiteBudUserId(raw: string): string | null {
  const u = raw.trim().toUpperCase()
  return ID_RE.test(u) ? u : null
}

export function getBiteBudUserId(): string | null {
  const raw = localStorage.getItem(KEY)
  if (raw == null || raw === '') return null
  const normalized = normalizeBiteBudUserId(raw)
  if (normalized) return normalized
  localStorage.removeItem(KEY)
  return null
}

export function setBiteBudUserId(id: string): void {
  const n = normalizeBiteBudUserId(id)
  if (!n) throw new Error('Invalid user id')
  localStorage.setItem(KEY, n)
}

export function useUserId(): { userId: string } {
  return { userId: getBiteBudUserId() ?? '' }
}

/** Headers for API calls that accept an optional logged-in user (e.g. icon mapping). */
export function biteBudUserIdHeader(): Record<string, string> {
  const id = getBiteBudUserId()
  return id ? { 'X-User-Id': id } : {}
}
