import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { apiFetch } from '../lib/api'
import { fetchWickedPickerItems, type WickedPickerItem } from '../lib/wickedIconPicker'
import { parseSensoryFoodItemFromApi, persistSensoryCode, useSensoryProfile } from './useSensoryProfile'
import { persistSensoryProfileSnapshot } from '../lib/sensorySnapshot'
import { getBiteBudUserId } from './useUserId'
import type { SensoryFoodItemDTO, SensoryFoodStatus } from '../types/sensory'

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

export function decodeUnsafeTexturePrefs(prefs: string[] | null | undefined): string[] {
  const unsafe: string[] = []
  for (const raw of prefs ?? []) {
    if (typeof raw !== 'string') continue
    if (raw.startsWith(TEXTURE_UNSAFE_PREFIX)) unsafe.push(raw.slice(TEXTURE_UNSAFE_PREFIX.length))
  }
  return uniq(unsafe)
}

function encodeUnsafeTexturePrefs(unsafe: string[]): string[] {
  return uniq(unsafe).map((t) => `${TEXTURE_UNSAFE_PREFIX}${t}`)
}

const selectedUnsafeTextures = ref<string[]>([])
const selectedDietary = ref<string[]>([])
const selectedCultural = ref<string[]>([])
const foodInputWickedIconId = ref('')
const foodInputStatus = ref<SensoryFoodStatus>('UNSURE')
const foodQuery = ref('')
const pickerItems = ref<WickedPickerItem[]>([])
const pickerLoading = ref(false)
const pickerError = ref('')
const addFoodError = ref('')
const addFoodBusy = ref(false)
const editingFood = ref<SensoryFoodItemDTO | null>(null)
const saveError = ref('')
const lastUserId = ref<string | null>(null)

function resetLocalState() {
  selectedUnsafeTextures.value = []
  selectedDietary.value = []
  selectedCultural.value = []
  foodInputWickedIconId.value = ''
  foodInputStatus.value = 'UNSURE'
  foodQuery.value = ''
  addFoodError.value = ''
  editingFood.value = null
  saveError.value = ''
}

export function useSensorySetupForm() {
  const router = useRouter()
  const { hasProfile, profile, loading: profileLoading, refresh } = useSensoryProfile()

  const decodedUnsafeTextures = computed(() => decodeUnsafeTexturePrefs(profile.value?.texturePrefs ?? []))
  const realFoodItems = computed(() => profile.value?.foodItems ?? [])
  const foodsForDisplay = computed<SensoryFoodItemDTO[]>(() => realFoodItems.value)
  const filteredPickerItems = computed(() => {
    const q = foodQuery.value.trim().toLowerCase()
    if (!q) return pickerItems.value.slice(0, 15)
    return pickerItems.value
      .filter((it) => it.label.toLowerCase().includes(q) || it.hint.toLowerCase().includes(q))
      .slice(0, 15)
  })

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
    },
    { immediate: true },
  )

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

  function statusPillClasses(status: SensoryFoodStatus): string {
    if (status === 'SAFE') return 'pill pill--safe'
    if (status === 'UNSAFE') return 'pill pill--unsafe'
    return 'pill pill--sometimes'
  }

  function statusLabel(status: SensoryFoodStatus): string {
    if (status === 'SAFE') return 'SAFE'
    if (status === 'UNSAFE') return 'UNSAFE'
    return 'SOMETIMES'
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

  async function loadFoodPickerItems() {
    if (pickerItems.value.length || pickerLoading.value) return
    pickerLoading.value = true
    pickerError.value = ''
    try {
      pickerItems.value = await fetchWickedPickerItems()
    } catch {
      pickerError.value = 'Could not load food tags. You can still type a known icon id.'
    } finally {
      pickerLoading.value = false
    }
  }

  async function onFoodRowClick(food: SensoryFoodItemDTO) {
    editFoodError.value = ''
    await loadFoodPickerItems()
    let displayName = food.name
    const wid = food.notes?.wickedIconId?.trim()
    if (wid) {
      const match = pickerItems.value.find((i) => i.wickedIconId === wid)
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
    foodInputWickedIconId.value = item.wickedIconId
    foodQuery.value = item.label
    addFoodError.value = ''
  }

  function resolveWickedImage(iconId: string | undefined | null): string | null {
    if (!iconId?.trim()) return null
    // Prefer backend proxy endpoint; fallback handled in the UI on image error.
    return `/api/icons/wicked/${iconId}`
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
      const match = pickerItems.value.find((x) => x.label.toLowerCase() === foodQuery.value.trim().toLowerCase())
      if (match) foodInputWickedIconId.value = match.wickedIconId
    }

    const wickedIconId = foodInputWickedIconId.value.trim()
    if (!wickedIconId) {
      addFoodError.value = 'Search and choose a food tag, then tap Add.'
      return
    }
    addFoodBusy.value = true
    try {
      await ensureProfileCreated()
      const data = await apiFetch<{ item: unknown }>('/api/sensory/items', {
        method: 'POST',
        headers: { 'X-User-Id': currentUserId() },
        body: JSON.stringify({ wickedIconId, status: foodInputStatus.value }),
      })
      foodInputWickedIconId.value = ''
      foodQuery.value = ''
      foodInputStatus.value = 'UNSURE'
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
    foodInputStatus,
    foodQuery,
    pickerLoading,
    pickerError,
    filteredPickerItems,
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
    statusPillClasses,
    statusLabel,
    onFoodRowClick,
    loadFoodPickerItems,
    choosePickerItem,
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
