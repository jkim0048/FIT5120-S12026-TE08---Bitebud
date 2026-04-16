import { persistSensoryCode } from '../composables/useSensoryProfile'
import { apiFetch } from './api'
import { persistSensoryProfileSnapshot } from './sensorySnapshot'

const MINIMAL_BODY = {
  texturePrefs: [] as string[],
  dietaryNeeds: [] as string[],
  culturalRequirements: [] as string[],
}

/** Creates/updates a profile row with empty preferences (user ID registered in DB). */
export async function persistMinimalSensoryProfile(userId: string): Promise<void> {
  await apiFetch('/api/sensory/profile', {
    method: 'POST',
    headers: { 'X-User-Id': userId },
    body: JSON.stringify(MINIMAL_BODY),
  })
  persistSensoryProfileSnapshot(MINIMAL_BODY as Record<string, unknown>)
  persistSensoryCode(userId)
}
