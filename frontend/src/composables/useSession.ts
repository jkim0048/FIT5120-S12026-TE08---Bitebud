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

export function syncSessionFromStorage(): void {
  userId.value = getBiteBudUserId()
}

export function loginSession(id: string): void {
  setBiteBudUserId(id)
  userId.value = normalizeBiteBudUserId(id)
}

export function logoutSession(): void {
  clearBiteBudUserId()
  localStorage.removeItem(SENSORY_CODE_STORAGE_KEY)
  clearSensoryProfileSnapshot()
  userId.value = null
}

export function useSession() {
  return {
    userId,
    isSignedIn: computed(() => !!userId.value),
    login: loginSession,
    logout: logoutSession,
    syncSessionFromStorage,
  }
}
