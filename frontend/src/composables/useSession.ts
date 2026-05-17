import { computed, ref } from 'vue'
import {
  clearBiteBudUserId,
  getBiteBudUserId,
  normalizeBiteBudUserId,
  setBiteBudUserId,
} from './useUserId'
import { clearSensoryProfileSnapshot } from '../lib/sensorySnapshot'
import { SENSORY_CODE_STORAGE_KEY } from './useSensoryProfile'

const userId = ref<string | null>(getBiteBudUserId())

/** Re-read the user id from storage (call after another tab updates it). */
export function syncSessionFromStorage(): void {
  userId.value = getBiteBudUserId()
}

/** Persist the user id as signed-in for the current session. */
export function loginSession(id: string): void {
  setBiteBudUserId(id)
  userId.value = normalizeBiteBudUserId(id)
}

/** Clear all per-user state for the active session (user id + sensory snapshots). */
export function logoutSession(): void {
  clearBiteBudUserId()
  localStorage.removeItem(SENSORY_CODE_STORAGE_KEY)
  clearSensoryProfileSnapshot()
  userId.value = null
}

/** Composable returning the active session state plus login/logout helpers. */
export function useSession() {
  return {
    userId,
    isSignedIn: computed(() => !!userId.value),
    login: loginSession,
    logout: logoutSession,
    syncSessionFromStorage,
  }
}
