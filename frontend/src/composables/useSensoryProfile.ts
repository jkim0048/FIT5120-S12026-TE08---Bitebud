import { onMounted, ref } from 'vue'
import { apiFetch } from '../lib/api'
import type { SensoryFoodItemDTO, SensoryProfileFields } from '../types/sensory'
import { getBiteBudUserId } from './useUserId'

/** Local storage key for the user's saved sensory profile code. */
export const SENSORY_CODE_STORAGE_KEY = 'bitebud_sensory_code'

/** Save the user's 3-char sensory code to local storage so it survives reloads. */
export function persistSensoryCode(code: string) {
  localStorage.setItem(SENSORY_CODE_STORAGE_KEY, code)
}

/** Read the persisted sensory code (returns empty string when no code has been stored). */
export function readStoredSensoryCode(): string {
  return localStorage.getItem(SENSORY_CODE_STORAGE_KEY) ?? ''
}

function strings(key: string, raw: Record<string, unknown>): string[] {
  const fieldValue = raw[key]
  return Array.isArray(fieldValue)
    ? fieldValue.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function parseNotes(rawNotes: unknown): SensoryFoodItemDTO['notes'] {
  if (!rawNotes || typeof rawNotes !== 'object') return {}
  const notesFields = rawNotes as Record<string, unknown>
  const parsedNotes: SensoryFoodItemDTO['notes'] = {}
  if (typeof notesFields.texture === 'string') parsedNotes.texture = notesFields.texture
  if (typeof notesFields.smell === 'string') parsedNotes.smell = notesFields.smell
  if (typeof notesFields.temperature === 'string') parsedNotes.temperature = notesFields.temperature
  if (typeof notesFields.ingredientKey === 'string') parsedNotes.ingredientKey = notesFields.ingredientKey
  if (typeof notesFields.wickedIconId === 'string') parsedNotes.wickedIconId = notesFields.wickedIconId
  return parsedNotes
}

/** Normalize one food row from API/Prisma JSON (ids may arrive as strings). */
export function parseSensoryFoodItemFromApi(rawItem: unknown): SensoryFoodItemDTO | null {
  if (!rawItem || typeof rawItem !== 'object') return null
  const row = rawItem as Record<string, unknown>
  const idRaw = row.id
  const id = idRaw != null && String(idRaw).trim() !== '' ? String(idRaw) : ''
  const name = typeof row.name === 'string' ? row.name : null
  const status = row.status
  if (!id || !name || (status !== 'SAFE' && status !== 'UNSURE' && status !== 'UNSAFE')) {
    return null
  }
  return {
    id,
    name,
    status,
    notes: parseNotes(row.notes),
  }
}

function parseFoodItems(raw: Record<string, unknown>): SensoryFoodItemDTO[] {
  const rawItems = raw.foodItems
  if (!Array.isArray(rawItems)) return []
  const parsedItems: SensoryFoodItemDTO[] = []
  for (const rawItem of rawItems) {
    const parsedItem = parseSensoryFoodItemFromApi(rawItem)
    if (parsedItem) parsedItems.push(parsedItem)
  }
  return parsedItems
}

function parseProfile(raw: Record<string, unknown> | null): SensoryProfileFields | null {
  if (!raw) return null

  const foodItems = parseFoodItems(raw)
  const legacySafe = strings('safeFoods', raw)
  const legacyUnsafe = strings('unsafeFoods', raw)
  const legacySometimes = strings('sometimesFoods', raw)

  let safeFoods: string[]
  let unsafeFoods: string[]
  let sometimesFoods: string[]
  if (foodItems.length > 0) {
    safeFoods = foodItems.filter((item) => item.status === 'SAFE').map((item) => item.name)
    unsafeFoods = foodItems.filter((item) => item.status === 'UNSAFE').map((item) => item.name)
    sometimesFoods = foodItems.filter((item) => item.status === 'UNSURE').map((item) => item.name)
  } else {
    safeFoods = legacySafe
    unsafeFoods = legacyUnsafe
    sometimesFoods = legacySometimes
  }

  return {
    texturePrefs: strings('texturePrefs', raw),
    dietaryNeeds: strings('dietaryNeeds', raw),
    culturalRequirements: strings('culturalRequirements', raw),
    safeFoods,
    unsafeFoods,
    sometimesFoods,
    foodItems,
  }
}

/** One shared store so every caller of `useSensoryProfile()` sees the same `hasProfile` after `refresh()` (fixes Add food when another view already loaded the profile). */
const loading = ref(true)
const hasProfile = ref(false)
const profile = ref<SensoryProfileFields | null>(null)
const rawProfile = ref<Record<string, unknown> | null>(null)
const userId = ref('')

/** Reload the active user's sensory profile from the API and update the shared reactive store. */
export async function refreshSensoryProfile(): Promise<void> {
  loading.value = true
  const currentUserId = getBiteBudUserId()
  userId.value = currentUserId ?? ''
  if (!currentUserId) {
    hasProfile.value = false
    profile.value = null
    rawProfile.value = null
    loading.value = false
    return
  }
  try {
    const data = await apiFetch<{
      hasProfile: boolean
      profile: Record<string, unknown> | null
    }>('/api/sensory/me', { headers: { 'X-User-Id': currentUserId } })
    hasProfile.value = data.hasProfile
    rawProfile.value = data.profile
    profile.value = parseProfile(data.profile)
  } catch {
    hasProfile.value = false
    profile.value = null
    rawProfile.value = null
  } finally {
    loading.value = false
  }
}

/** Composable returning the shared sensory profile store; triggers a refresh on mount. */
export function useSensoryProfile() {
  onMounted(() => {
    void refreshSensoryProfile()
  })

  return {
    loading,
    hasProfile,
    profile,
    rawProfile,
    refresh: refreshSensoryProfile,
    userId,
  }
}
