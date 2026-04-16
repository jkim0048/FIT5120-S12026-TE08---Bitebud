/** Last saved sensory profile body for keepalive flush on tab close. */
export const SENSORY_PROFILE_SNAPSHOT_KEY = 'bitebud_sensory_snapshot'

export function persistSensoryProfileSnapshot(body: Record<string, unknown>): void {
  try {
    sessionStorage.setItem(SENSORY_PROFILE_SNAPSHOT_KEY, JSON.stringify(body))
  } catch {
    /* quota / private mode */
  }
}

export function clearSensoryProfileSnapshot(): void {
  try {
    sessionStorage.removeItem(SENSORY_PROFILE_SNAPSHOT_KEY)
  } catch {
    /* ignore */
  }
}
