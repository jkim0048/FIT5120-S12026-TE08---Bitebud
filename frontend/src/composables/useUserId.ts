const STORAGE_KEY = 'bitebud_user_id'

const USER_ID_REGEX = /^[A-Z0-9]{3}$/

/** Normalise a raw user-id string to canonical form (uppercase, 3 alphanumerics); returns null if invalid. */
export function normalizeBiteBudUserId(raw: string): string | null {
  const normalized = raw.trim().toUpperCase()
  return USER_ID_REGEX.test(normalized) ? normalized : null
}

/** Read the BiteBud user id from local storage, clearing the slot if the stored value is malformed. */
export function getBiteBudUserId(): string | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw == null || raw === '') return null
  const normalized = normalizeBiteBudUserId(raw)
  if (normalized) return normalized
  localStorage.removeItem(STORAGE_KEY)
  return null
}

/** Persist the BiteBud user id in local storage after validating it; throws on invalid input. */
export function setBiteBudUserId(id: string): void {
  const normalized = normalizeBiteBudUserId(id)
  if (!normalized) throw new Error('Invalid user id')
  localStorage.setItem(STORAGE_KEY, normalized)
}

/** Remove the stored BiteBud user id from local storage. */
export function clearBiteBudUserId(): void {
  localStorage.removeItem(STORAGE_KEY)
}

/** Composable returning the current BiteBud user id, or empty string when none is stored. */
export function useUserId(): { userId: string } {
  return { userId: getBiteBudUserId() ?? '' }
}

/** Headers for API calls that accept an optional logged-in user (e.g. icon mapping). */
export function biteBudUserIdHeader(): Record<string, string> {
  const id = getBiteBudUserId()
  return id ? { 'X-User-Id': id } : {}
}
