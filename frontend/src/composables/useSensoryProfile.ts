import { onMounted, ref } from 'vue'
import { apiFetch } from '../lib/api'
import type { SensoryFoodItemDTO, SensoryProfileFields } from '../types/sensory'
import { getBiteBudUserId } from './useUserId'

export const SENSORY_CODE_STORAGE_KEY = 'bitebud_sensory_code'

export function persistSensoryCode(code: string) {
  localStorage.setItem(SENSORY_CODE_STORAGE_KEY, code)
}

export function readStoredSensoryCode(): string {
  return localStorage.getItem(SENSORY_CODE_STORAGE_KEY) ?? ''
}

function strings(key: string, raw: Record<string, unknown>): string[] {
  const v = raw[key]
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function parseNotes(v: unknown): SensoryFoodItemDTO['notes'] {
  if (!v || typeof v !== 'object') return {}
  const o = v as Record<string, unknown>
  const out: SensoryFoodItemDTO['notes'] = {}
  if (typeof o.texture === 'string') out.texture = o.texture
  if (typeof o.smell === 'string') out.smell = o.smell
  if (typeof o.temperature === 'string') out.temperature = o.temperature
  if (typeof o.ingredientKey === 'string') out.ingredientKey = o.ingredientKey
  if (typeof o.wickedIconId === 'string') out.wickedIconId = o.wickedIconId
  return out
}

/** Normalize one food row from API/Prisma JSON (ids may arrive as strings). */
export function parseSensoryFoodItemFromApi(o: unknown): SensoryFoodItemDTO | null {
  if (!o || typeof o !== 'object') return null
  const row = o as Record<string, unknown>
  const idRaw = row.id
  const id = idRaw != null && String(idRaw).trim() !== '' ? String(idRaw) : ''
  const name = typeof row.name === 'string' ? row.name : null
  const st = row.status
  if (!id || !name || (st !== 'SAFE' && st !== 'UNSURE' && st !== 'UNSAFE')) {
    return null
  }
  return {
    id,
    name,
    status: st,
    notes: parseNotes(row.notes),
  }
}

function parseFoodItems(raw: Record<string, unknown>): SensoryFoodItemDTO[] {
  const v = raw.foodItems
  if (!Array.isArray(v)) return []
  const out: SensoryFoodItemDTO[] = []
  for (const x of v) {
    const item = parseSensoryFoodItemFromApi(x)
    if (item) out.push(item)
  }
  return out
}

function parseProfile(raw: Record<string, unknown> | null): SensoryProfileFields | null {
  if (!raw) return null
  const tp = raw.temperaturePref
  const temperaturePref =
    typeof tp === 'string' && tp.trim() ? tp : tp == null ? null : String(tp)

  const foodItems = parseFoodItems(raw)
  const legacySafe = strings('safeFoods', raw)
  const legacyUnsafe = strings('unsafeFoods', raw)
  const legacySometimes = strings('sometimesFoods', raw)

  let safeFoods: string[]
  let unsafeFoods: string[]
  let sometimesFoods: string[]
  if (foodItems.length > 0) {
    safeFoods = foodItems.filter((i) => i.status === 'SAFE').map((i) => i.name)
    unsafeFoods = foodItems.filter((i) => i.status === 'UNSAFE').map((i) => i.name)
    sometimesFoods = foodItems.filter((i) => i.status === 'UNSURE').map((i) => i.name)
  } else {
    safeFoods = legacySafe
    unsafeFoods = legacyUnsafe
    sometimesFoods = legacySometimes
  }

  return {
    texturePrefs: strings('texturePrefs', raw),
    temperaturePref,
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

export async function refreshSensoryProfile(): Promise<void> {
  loading.value = true
  const uid = getBiteBudUserId()
  userId.value = uid ?? ''
  if (!uid) {
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
    }>('/api/sensory/me', { headers: { 'X-User-Id': uid } })
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
