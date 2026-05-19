import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { apiFetch, apiUrl } from '../lib/api'
import {
  fetchWickedPickerItemById,
  searchWickedPickerItems,
  type WickedPickerItem,
} from '../lib/wickedIconPicker'
import { parseSensoryFoodItemFromApi, persistSensoryCode, useSensoryProfile } from './useSensoryProfile'
import { persistSensoryProfileSnapshot } from '../lib/sensorySnapshot'
import { getBiteBudUserId } from './useUserId'
import type { SensoryFoodItemDTO, SensoryFoodStatus } from '../types/sensory'

/** Texture labels users can mark as safe, unsure, or unsafe during sensory setup. */
export const TEXTURE_OPTIONS = [
  'Soft',
  'Smooth',
  'Crunchy',
  'Crispy',
  'Chewy',
  'Slimy',
  'Mushy',
  'Lumpy',
  'Sticky',
  'Grainy',
  'Powdery',
  'Rubbery',
  'Flaky',
] as const

export type TextureOption = (typeof TEXTURE_OPTIONS)[number]

export const TEXTURE_OPTION_PRESENTATION: Record<TextureOption, { emoji: string; hint: string }> = {
  Soft: { emoji: '🤲', hint: 'Easy to mash, like yogurt or banana' },
  Smooth: { emoji: '✨', hint: 'Even and silky on the tongue' },
  Crunchy: { emoji: '🥕', hint: 'Loud bite, like raw carrot' },
  Crispy: { emoji: '🍟', hint: 'Thin crackle, like chips or toast' },
  Chewy: { emoji: '🍞', hint: 'Needs a lot of chewing' },
  Slimy: { emoji: '🐌', hint: 'Slippery or gooey feeling' },
  Mushy: { emoji: '🥔', hint: 'Soft and wet, like overcooked veg' },
  Lumpy: { emoji: '🫘', hint: 'Uneven bits mixed in' },
  Sticky: { emoji: '🍯', hint: 'Clings to fingers or teeth' },
  Grainy: { emoji: '🌾', hint: 'Sandy or gritty between teeth' },
  Powdery: { emoji: '🍚', hint: 'Dry and dusty, like flour or icing sugar' },
  Rubbery: { emoji: '🦑', hint: 'Bouncy or tough to tear' },
  Flaky: { emoji: '🥐', hint: 'Layers that fall apart' },
}

export type SensoryChip = { label: string; kind: 'dietary' | 'cultural'; emoji: string; hint: string }

export const DIETARY_CHIPS: SensoryChip[] = [
  { label: 'Vegetarian', kind: 'dietary', emoji: '🥗', hint: 'No meat or fish' },
  { label: 'Vegan', kind: 'dietary', emoji: '🌱', hint: 'No animal products' },
  { label: 'Gluten-Free', kind: 'dietary', emoji: '🍚', hint: 'No wheat, barley, or rye' },
  { label: 'Dairy-Free', kind: 'dietary', emoji: '🧀', hint: 'No milk or cheese' },
  { label: 'No Beef', kind: 'dietary', emoji: '🐄', hint: 'Avoid beef dishes' },
  { label: 'Nut Free', kind: 'dietary', emoji: '🥜', hint: 'No tree nuts or peanuts' },
  { label: 'Shellfish-Free', kind: 'dietary', emoji: '🦐', hint: 'No shrimp, crab, etc.' },
  { label: 'No Pork', kind: 'dietary', emoji: '🐷', hint: 'Avoid pork products' },
]

export const CULTURAL_CHIPS: SensoryChip[] = [
  { label: 'Halal', kind: 'cultural', emoji: '☪️', hint: 'Prepared following Islamic rules' },
  { label: 'Kosher', kind: 'cultural', emoji: '✡️', hint: 'Prepared following Jewish dietary law' },
]

const TEXTURE_UNSAFE_PREFIX = 'unsafe:'

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr))
}

function currentUserId(): string {
  const id = getBiteBudUserId()
  if (!id) throw new Error('Missing user id')
  return id
}

/** Decode the stored `unsafe:<Texture>` strings into a de-duplicated list of texture labels. */
export function decodeUnsafeTexturePrefs(prefs: string[] | null | undefined): string[] {
  const unsafeTextures: string[] = []
  for (const rawPref of prefs ?? []) {
    if (typeof rawPref !== 'string') continue
    if (rawPref.startsWith(TEXTURE_UNSAFE_PREFIX)) {
      unsafeTextures.push(rawPref.slice(TEXTURE_UNSAFE_PREFIX.length))
    }
  }
  return uniq(unsafeTextures)
}

function encodeUnsafeTexturePrefs(unsafe: string[]): string[] {
  return uniq(unsafe).map((texture) => `${TEXTURE_UNSAFE_PREFIX}${texture}`)
}

const selectedUnsafeTextures = ref<string[]>([])
const selectedDietary = ref<string[]>([])
const selectedCultural = ref<string[]>([])
const foodInputWickedIconId = ref('')
const foodQuery = ref('')
const foodPickerOpen = ref(false)
const pickerItems = ref<WickedPickerItem[]>([])
const pickerLabelCache = ref(new Map<string, WickedPickerItem>())
const pickerLoading = ref(false)
const pickerError = ref('')
let pickerSearchTimer: ReturnType<typeof setTimeout> | null = null
let pickerSearchSeq = 0
const addFoodError = ref('')
const addFoodBusy = ref(false)
const pendingAddPickerItem = ref<WickedPickerItem | null>(null)
const editingFood = ref<SensoryFoodItemDTO | null>(null)
const saveError = ref('')
const lastUserId = ref<string | null>(null)

function resetLocalState() {
  selectedUnsafeTextures.value = []
  selectedDietary.value = []
  selectedCultural.value = []
  foodInputWickedIconId.value = ''
  foodQuery.value = ''
  foodPickerOpen.value = false
  addFoodError.value = ''
  pendingAddPickerItem.value = null
  editingFood.value = null
  saveError.value = ''
  pickerLabelCache.value = new Map()
  pickerItems.value = []
}

function cachePickerItems(items: WickedPickerItem[]) {
  if (!items.length) return
  const next = new Map(pickerLabelCache.value)
  for (const item of items) next.set(item.wickedIconId, item)
  pickerLabelCache.value = next
}

function pickerItemForId(wickedIconId: string | undefined | null): WickedPickerItem | null {
  const id = wickedIconId?.trim()
  if (!id) return null
  return pickerLabelCache.value.get(id) ?? pickerItems.value.find((p) => p.wickedIconId === id) ?? null
}

/**
 * Composable powering the multi-step Sensory Setup form. Returns reactive state plus action helpers for the
 * underlying screens — chip toggles, profile save, food-item CRUD, and Wicked icon picker integration.
 */
export function useSensorySetupForm() {
  const router = useRouter()
  const { hasProfile, profile, loading: profileLoading, refresh } = useSensoryProfile()

  const decodedUnsafeTextures = computed(() => decodeUnsafeTexturePrefs(profile.value?.texturePrefs ?? []))
  const realFoodItems = computed(() => profile.value?.foodItems ?? [])
  const foodsForDisplay = computed<SensoryFoodItemDTO[]>(() => {
    return realFoodItems.value.map((it) => {
      const baseName = (it.name ?? '').trim()
      if (baseName) return it
      const wid = it.notes?.wickedIconId?.trim()
      const match = pickerItemForId(wid)
      const label = match?.label?.trim() || (wid ? wid.replace(/[-_]/g, ' ').trim() : '')
      const parts = label.replace(/\s+/g, ' ').split(' ').filter(Boolean)
      const short = parts.length <= 4 ? parts.join(' ') : `${parts.slice(0, 4).join(' ')}…`
      return { ...it, name: short || 'Food item' }
    })
  })

  function shortPickerLabel(item: WickedPickerItem): string {
    const raw = (item.label || '').trim()
    const base = raw || item.wickedIconId.replace(/[-_]/g, ' ').trim()
    // Keep the label compact in the suggestion list.
    // Examples:
    // - "apple cider vinegar" -> "apple cider vinegar"
    // - "chicken thighs boneless" -> "chicken thighs boneless"
    // - very long labels -> first 4 words + "…"
    const cleaned = base.replace(/\s+/g, ' ')
    const parts = cleaned.split(' ').filter(Boolean)
    if (parts.length <= 4) return cleaned
    return `${parts.slice(0, 4).join(' ')}…`
  }

  function foodDisplayName(it: SensoryFoodItemDTO): string {
    const baseName = (it.name ?? '').trim()
    if (baseName) return baseName
    const wid = it.notes?.wickedIconId?.trim()
    const match = pickerItemForId(wid)
    const label = (match?.label ?? '').trim() || (wid ? wid.replace(/[-_]/g, ' ').trim() : '')
    const parts = label.replace(/\s+/g, ' ').split(' ').filter(Boolean)
    if (!parts.length) return 'Food item'
    return parts.length <= 4 ? parts.join(' ') : `${parts.slice(0, 4).join(' ')}…`
  }

  const filteredPickerItems = computed(() => pickerItems.value)

  const selectedPickerItem = computed(() => {
    const wickedIconId = foodInputWickedIconId.value.trim()
    if (wickedIconId) return pickerItemForId(wickedIconId)
    const query = foodQuery.value.trim().toLowerCase()
    if (!query) return null
    return pickerItems.value.find((item) => item.label.toLowerCase() === query) ?? null
  })

  async function hydratePickerLabelsForFoods(items: SensoryFoodItemDTO[]) {
    const ids = [
      ...new Set(
        items
          .filter((it) => !(it.name ?? '').trim())
          .map((it) => it.notes?.wickedIconId?.trim())
          .filter((id): id is string => Boolean(id)),
      ),
    ].filter((id) => !pickerLabelCache.value.has(id))
    if (!ids.length) return
    await Promise.all(
      ids.map(async (id) => {
        const item = await fetchWickedPickerItemById(id)
        if (item) cachePickerItems([item])
      }),
    )
  }

  watch(
    () => [profile.value, hasProfile.value, profileLoading.value, getBiteBudUserId() ?? ''] as const,
    ([p, exists, loading, uid]) => {
      if (!uid) {
        resetLocalState()
        lastUserId.value = null
        return
      }
      const userChanged = lastUserId.value !== uid
      if (userChanged) {
        resetLocalState()
        lastUserId.value = uid
      }
      if (loading) return
      if (!exists || !p) {
        if (userChanged) resetLocalState()
        return
      }
      selectedUnsafeTextures.value = decodedUnsafeTextures.value
      selectedDietary.value = p.dietaryNeeds ?? []
      selectedCultural.value = p.culturalRequirements ?? []
      if (p?.foodItems?.length) void hydratePickerLabelsForFoods(p.foodItems)
    },
    { immediate: true },
  )

  watch(foodQuery, (q) => {
    if (pickerSearchTimer) clearTimeout(pickerSearchTimer)
    const trimmed = q.trim()
    if (!trimmed) {
      pickerItems.value = []
      pickerLoading.value = false
      return
    }
    pickerSearchTimer = setTimeout(() => {
      void runFoodPickerSearch(trimmed)
    }, 220)
  })

  function toggleUnsafeTexture(label: string) {
    selectedUnsafeTextures.value = selectedUnsafeTextures.value.includes(label)
      ? selectedUnsafeTextures.value.filter((x) => x !== label)
      : uniq([...selectedUnsafeTextures.value, label])
  }

  function toggleDietary(label: string) {
    selectedDietary.value = selectedDietary.value.includes(label)
      ? selectedDietary.value.filter((x) => x !== label)
      : uniq([...selectedDietary.value, label])
  }

  function toggleCultural(label: string) {
    selectedCultural.value = selectedCultural.value.includes(label)
      ? selectedCultural.value.filter((x) => x !== label)
      : uniq([...selectedCultural.value, label])
  }

  const editFoodError = ref('')
  const editFoodBusy = ref(false)

  /** Notes sent on save: keep icon/ingredient mapping only (no texture/smell/temperature UI). */
  function notesForFoodEditPatch(notes: SensoryFoodItemDTO['notes'] | undefined): Record<string, unknown> {
    const src = (notes ?? {}) as Record<string, unknown>
    const out: Record<string, unknown> = {}
    if (typeof src.wickedIconId === 'string' && src.wickedIconId.trim()) out.wickedIconId = src.wickedIconId.trim()
    if (typeof src.ingredientKey === 'string' && src.ingredientKey.trim()) out.ingredientKey = src.ingredientKey.trim()
    return out
  }

  async function runFoodPickerSearch(query: string) {
    const seq = ++pickerSearchSeq
    pickerLoading.value = true
    pickerError.value = ''
    try {
      const items = await searchWickedPickerItems(query, 15)
      if (seq !== pickerSearchSeq) return
      pickerItems.value = items
      cachePickerItems(items)
    } catch {
      if (seq !== pickerSearchSeq) return
      pickerError.value = 'Could not search food tags. Try again in a moment.'
      pickerItems.value = []
    } finally {
      if (seq === pickerSearchSeq) pickerLoading.value = false
    }
  }

  function loadFoodPickerItems() {
    const q = foodQuery.value.trim()
    if (q) void runFoodPickerSearch(q)
  }

  async function onFoodRowClick(food: SensoryFoodItemDTO) {
    editFoodError.value = ''
    let displayName = food.name
    const wid = food.notes?.wickedIconId?.trim()
    if (wid) {
      let match = pickerItemForId(wid)
      if (!match?.label) {
        match = await fetchWickedPickerItemById(wid)
        if (match) cachePickerItems([match])
      }
      if (match?.label) displayName = match.label
    }
    editingFood.value = {
      id: food.id,
      name: displayName,
      status: food.status,
      notes: { ...(food.notes ?? {}) },
    }
  }

  function choosePickerItem(item: WickedPickerItem) {
    foodPickerOpen.value = false
    addFoodError.value = ''
    cachePickerItems([item])
    pendingAddPickerItem.value = item
  }

  function cancelPendingAddFood() {
    pendingAddPickerItem.value = null
    addFoodError.value = ''
  }

  async function confirmPendingAddFood() {
    const item = pendingAddPickerItem.value
    if (!item || addFoodBusy.value) return
    foodInputWickedIconId.value = item.wickedIconId
    foodQuery.value = item.label
    await addFood()
    if (!addFoodError.value) pendingAddPickerItem.value = null
  }

  function openFoodPicker() {
    foodPickerOpen.value = true
  }

  function closeFoodPickerSoon() {
    // Defer close slightly so clicks on picker items can register after input blur.
    window.setTimeout(() => {
      foodPickerOpen.value = false
    }, 120)
  }

  function resolveWickedImage(iconId: string | undefined | null): string | null {
    if (!iconId?.trim()) return null
    // Prefer backend proxy endpoint; fallback handled in the UI on image error.
    return apiUrl(`/api/icons/wicked/${iconId}`)
  }

  async function ensureProfileCreated() {
    if (hasProfile.value) return
    const uid = currentUserId()
    const texturePrefsEncoded = encodeUnsafeTexturePrefs(selectedUnsafeTextures.value)
    const profileBody = {
      texturePrefs: texturePrefsEncoded,
      dietaryNeeds: selectedDietary.value,
      culturalRequirements: selectedCultural.value,
    }
    await apiFetch('/api/sensory/profile', {
      method: 'POST',
      headers: { 'X-User-Id': uid },
      body: JSON.stringify(profileBody),
    })
    persistSensoryProfileSnapshot(profileBody)
    persistSensoryCode(uid)
    await refresh()
    if (!hasProfile.value) {
      throw new Error('Could not create or load your profile. Check your connection and try again.')
    }
  }

  async function addFood() {
    addFoodError.value = ''
    if (!foodInputWickedIconId.value.trim() && foodQuery.value.trim()) {
      let match = pickerItems.value.find(
        (x) => x.label.toLowerCase() === foodQuery.value.trim().toLowerCase(),
      )
      if (!match) {
        const found = await searchWickedPickerItems(foodQuery.value.trim(), 8)
        cachePickerItems(found)
        match = found.find((x) => x.label.toLowerCase() === foodQuery.value.trim().toLowerCase())
      }
      if (match) foodInputWickedIconId.value = match.wickedIconId
    }

    const wickedIconId = foodInputWickedIconId.value.trim()
    if (!wickedIconId) {
      addFoodError.value = 'Search and choose a food tag.'
      return
    }
    addFoodBusy.value = true
    try {
      await ensureProfileCreated()
      const data = await apiFetch<{ item: unknown }>('/api/sensory/items', {
        method: 'POST',
        headers: { 'X-User-Id': currentUserId() },
        body: JSON.stringify({ wickedIconId, status: 'UNSAFE' satisfies SensoryFoodStatus }),
      })
      foodInputWickedIconId.value = ''
      foodQuery.value = ''
      try {
        await refresh()
      } catch {
        /* refresh failed but item may exist */
      }
      const merged = parseSensoryFoodItemFromApi(data.item)
      if (merged && profile.value && !profile.value.foodItems.some((f) => f.id === merged.id)) {
        profile.value = {
          ...profile.value,
          foodItems: [...profile.value.foodItems, merged],
        }
      }
    } catch (e) {
      addFoodError.value = e instanceof Error ? e.message : 'Could not add food.'
    } finally {
      addFoodBusy.value = false
    }
  }

  async function saveEditingFood() {
    if (!editingFood.value) return
    editFoodError.value = ''
    const name = editingFood.value.name.trim()
    if (!name) {
      editFoodError.value = 'Food name is required.'
      return
    }
    if (name.length > 200) {
      editFoodError.value = 'Food name is too long (max 200 characters).'
      return
    }
    const notesPayload = notesForFoodEditPatch(editingFood.value.notes)
    editFoodBusy.value = true
    try {
      await apiFetch(`/api/sensory/items/${editingFood.value.id}`, {
        method: 'PATCH',
        headers: { 'X-User-Id': currentUserId() },
        body: JSON.stringify({
          name,
          status: editingFood.value.status,
          notes: notesPayload,
        }),
      })
      editingFood.value = null
      await refresh()
    } catch (e) {
      editFoodError.value = e instanceof Error ? e.message : 'Could not save changes.'
    } finally {
      editFoodBusy.value = false
    }
  }

  async function deleteEditingFood() {
    if (!editingFood.value) return
    editFoodError.value = ''
    editFoodBusy.value = true
    try {
      await apiFetch(`/api/sensory/items/${editingFood.value.id}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': currentUserId() },
      })
      editingFood.value = null
      await refresh()
    } catch (e) {
      editFoodError.value = e instanceof Error ? e.message : 'Could not remove item.'
    } finally {
      editFoodBusy.value = false
    }
  }

  function onCloseEdit() {
    editFoodError.value = ''
    editingFood.value = null
  }

  const textureDone = computed(() => selectedUnsafeTextures.value.length > 0)
  const dietaryDone = computed(() => selectedDietary.value.length + selectedCultural.value.length > 0)
  const foodSafetyDone = computed(() => realFoodItems.value.length > 0)

  async function saveProfileOnly() {
    saveError.value = ''
    const uid = currentUserId()
    const texturePrefsEncoded = encodeUnsafeTexturePrefs(selectedUnsafeTextures.value)
    const profileBody = {
      texturePrefs: texturePrefsEncoded,
      dietaryNeeds: selectedDietary.value,
      culturalRequirements: selectedCultural.value,
    }
    await apiFetch('/api/sensory/profile', {
      method: 'POST',
      headers: { 'X-User-Id': uid },
      body: JSON.stringify(profileBody),
    })
    persistSensoryProfileSnapshot(profileBody)
    persistSensoryCode(uid)
    await refresh()
  }

  async function saveAndViewSummary() {
    saveError.value = ''
    try {
      await saveProfileOnly()
      router.push({ name: 'sensorySummary' })
    } catch (e) {
      saveError.value = e instanceof Error ? e.message : 'Could not save your profile. Please try again.'
    }
  }

  async function saveTexturesSection() {
    await saveProfileOnly()
  }

  async function saveDietaryCulturalSection() {
    await saveProfileOnly()
  }

  async function saveFoodSafetySection() {
    await ensureProfileCreated()
  }

  return {
    profileLoading,
    saveError,
    selectedUnsafeTextures,
    selectedDietary,
    selectedCultural,
    foodInputWickedIconId,
    foodQuery,
    foodPickerOpen,
    selectedPickerItem,
    pickerLoading,
    pickerError,
    filteredPickerItems,
    shortPickerLabel,
    foodDisplayName,
    resolveWickedImage,
    addFoodError,
    addFoodBusy,
    editingFood,
    editFoodError,
    editFoodBusy,
    foodsForDisplay,
    textureDone,
    dietaryDone,
    foodSafetyDone,
    toggleUnsafeTexture,
    toggleDietary,
    toggleCultural,
    onFoodRowClick,
    loadFoodPickerItems,
    choosePickerItem,
    pendingAddPickerItem,
    confirmPendingAddFood,
    cancelPendingAddFood,
    openFoodPicker,
    closeFoodPickerSoon,
    addFood,
    saveEditingFood,
    deleteEditingFood,
    onCloseEdit,
    saveProfileOnly,
    saveAndViewSummary,
    saveTexturesSection,
    saveDietaryCulturalSection,
    saveFoodSafetySection,
  }
}
