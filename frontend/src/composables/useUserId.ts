const STORAGE_KEY = 'bitebud_user_id'

const USER_ID_REGEX = /^[A-Z0-9]{3}$/

/** Normalise a raw user-id string to canonical form (uppercase, 3 alphanumerics); returns null if invalid. */
export function normalizeBiteBudUserId(raw: string): string | null {
  const normalized = raw.trim().toUpperCase()
  return USER_ID_REGEX.test(normalized) ? normalized : null
}

function readSessionUserRaw(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function readLocalUserRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/**
 * Session is stored in sessionStorage so a normal refresh keeps the user signed in,
 * while closing the tab or browser clears the id. Legacy values in localStorage are migrated once.
 */
export function getBiteBudUserId(): string | null {
  const rawSession = readSessionUserRaw()
  if (rawSession != null && rawSession !== '') {
    const normalized = normalizeBiteBudUserId(rawSession)
    if (normalized) return normalized
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }

  const rawLocal = readLocalUserRaw()
  if (rawLocal == null || rawLocal === '') return null
  const normalized = normalizeBiteBudUserId(rawLocal)
  if (!normalized) {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    return null
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, normalized)
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
  return normalized
}

/** Persist the BiteBud user id after validating it; throws on invalid input. */
export function setBiteBudUserId(id: string): void {
  const normalized = normalizeBiteBudUserId(id)
  if (!normalized) throw new Error('Invalid user id')
  try {
    sessionStorage.setItem(STORAGE_KEY, normalized)
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    throw new Error('Could not save session')
  }
}

/** Remove the stored BiteBud user id from session and legacy local storage. */
export function clearBiteBudUserId(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
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
