/** Last saved sensory profile body for keepalive flush on tab close. */
export const SENSORY_PROFILE_SNAPSHOT_KEY = 'bitebud_sensory_snapshot'

/** Snapshot the user's sensory profile payload to session storage so it can be re-flushed on tab close. */
export function persistSensoryProfileSnapshot(body: Record<string, unknown>): void {
  try {
    sessionStorage.setItem(SENSORY_PROFILE_SNAPSHOT_KEY, JSON.stringify(body))
  } catch {
    /* quota / private mode */
  }
}

/** Clear the sensory profile snapshot once it has been successfully synced to the server. */
export function clearSensoryProfileSnapshot(): void {
  try {
    sessionStorage.removeItem(SENSORY_PROFILE_SNAPSHOT_KEY)
  } catch {
    /* ignore */
  }
}
