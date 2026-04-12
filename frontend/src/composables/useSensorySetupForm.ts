import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { apiFetch } from '../lib/api'
import { parseSensoryFoodItemFromApi, persistSensoryCode, useSensoryProfile } from './useSensoryProfile'
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
  'Rubbery',
  'Flaky',
] as const

export const TEMPERATURE_OPTIONS = ['Cold', 'Room Temp', 'Warm', 'Hot'] as const

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
  Rubbery: { emoji: '🦑', hint: 'Bouncy or tough to tear' },
  Flaky: { emoji: '🥐', hint: 'Layers that fall apart' },
}

export const TEMPERATURE_PRESENTATION: Array<{
  value: (typeof TEMPERATURE_OPTIONS)[number]
  emoji: string
  hint: string
}> = [
  { value: 'Cold', emoji: '🧊', hint: 'Straight from the fridge' },
  { value: 'Room Temp', emoji: '🏠', hint: 'Not heated or chilled' },
  { value: 'Warm', emoji: '☀️', hint: 'Gently heated, not steaming' },
  { value: 'Hot', emoji: '🔥', hint: 'Steaming or very warm' },
]

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

function decodeUnsafeTexturePrefs(prefs: string[] | null | undefined): string[] {
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

type FoodWithExample = SensoryFoodItemDTO & { example?: boolean }

/** Shown only when the profile has no real food items. No SAFE examples. */
const EXAMPLE_FOODS: FoodWithExample[] = [
  { id: 'ex-onion', name: 'Onion', status: 'UNSAFE', notes: {}, example: true },
  { id: 'ex-egg', name: 'Scrambled Egg', status: 'UNSURE', notes: {}, example: true },
]

const selectedUnsafeTextures = ref<string[]>([])
const selectedTemperatures = ref<string[]>([])
const selectedDietary = ref<string[]>([])
const selectedCultural = ref<string[]>([])
const foodInputWickedIconId = ref('')
const foodInputStatus = ref<SensoryFoodStatus>('UNSURE')
const addFoodError = ref('')
const addFoodBusy = ref(false)
const editingFood = ref<FoodWithExample | null>(null)
const editingNotesTex = ref('')
const editingNotesSmell = ref('')
const editingNotesTemp = ref('')
const saveError = ref('')
const lastUserId = ref<string | null>(null)

function resetLocalState() {
  selectedUnsafeTextures.value = []
  selectedTemperatures.value = []
  selectedDietary.value = []
  selectedCultural.value = []
  foodInputWickedIconId.value = ''
  foodInputStatus.value = 'UNSURE'
  addFoodError.value = ''
  editingFood.value = null
  editingNotesTex.value = ''
  editingNotesSmell.value = ''
  editingNotesTemp.value = ''
  saveError.value = ''
}

export function useSensorySetupForm() {
  const router = useRouter()
  const { hasProfile, profile, loading: profileLoading, refresh } = useSensoryProfile()

  const decodedUnsafeTextures = computed(() => decodeUnsafeTexturePrefs(profile.value?.texturePrefs ?? []))
  const realFoodItems = computed(() => profile.value?.foodItems ?? [])
  const foodsForDisplay = computed<FoodWithExample[]>(() =>
    realFoodItems.value.length ? realFoodItems.value.map((f) => ({ ...f, example: false })) : EXAMPLE_FOODS,
  )
  const showingExampleFoods = computed(() => realFoodItems.value.length === 0)

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
      // Avoid wiping in-progress selections while profile is still loading on page transitions.
      if (loading) return
      if (!exists || !p) {
        if (userChanged) resetLocalState()
        return
      }
      selectedUnsafeTextures.value = decodedUnsafeTextures.value
      selectedTemperatures.value = (p.temperaturePref ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
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

  function toggleTemperature(label: string) {
    selectedTemperatures.value = selectedTemperatures.value.includes(label)
      ? selectedTemperatures.value.filter((x) => x !== label)
      : uniq([...selectedTemperatures.value, label])
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

  function onFoodRowClick(food: FoodWithExample) {
    if (food.example) return
    editingFood.value = food
    editingNotesTex.value = food.notes?.texture ?? ''
    editingNotesSmell.value = food.notes?.smell ?? ''
    editingNotesTemp.value = food.notes?.temperature ?? ''
  }

  async function ensureProfileCreated() {
    if (hasProfile.value) return
    const uid = currentUserId()
    const texturePrefsEncoded = encodeUnsafeTexturePrefs(selectedUnsafeTextures.value)
    const tempPref = selectedTemperatures.value.length ? selectedTemperatures.value.join(',') : null
    await apiFetch('/api/sensory/profile', {
      method: 'POST',
      headers: { 'X-User-Id': uid },
      body: JSON.stringify({
        texturePrefs: texturePrefsEncoded,
        temperaturePref: tempPref,
        dietaryNeeds: selectedDietary.value,
        culturalRequirements: selectedCultural.value,
      }),
    })
    persistSensoryCode(uid)
    await refresh()
    if (!hasProfile.value) {
      throw new Error('Could not create or load your profile. Check your connection and try again.')
    }
  }

  async function addFood() {
    addFoodError.value = ''
    const wickedIconId = foodInputWickedIconId.value.trim()
    if (!wickedIconId) {
      addFoodError.value = 'Choose an ingredient from the list, then tap Add.'
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
      foodInputStatus.value = 'UNSURE'
      try {
        await refresh()
      } catch {
        /* refresh failed but item may exist — merge from POST body */
      }
      const merged = parseSensoryFoodItemFromApi(data.item)
      if (merged && profile.value && !profile.value.foodItems.some((f) => f.id === merged.id)) {
        profile.value = {
          ...profile.value,
          foodItems: [...profile.value.foodItems, merged],
        }
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Could not add food.'
      try {
        const j = JSON.parse(raw) as { error?: string }
        addFoodError.value = j.error ?? raw
      } catch {
        addFoodError.value = raw
      }
    } finally {
      addFoodBusy.value = false
    }
  }

  async function saveEditingFood() {
    if (!editingFood.value) return
    const prev = { ...(editingFood.value.notes as Record<string, string>) }
    const tex = editingNotesTex.value.trim()
    const sm = editingNotesSmell.value.trim()
    const tp = editingNotesTemp.value.trim()
    if (tex) prev.texture = tex
    else delete prev.texture
    if (sm) prev.smell = sm
    else delete prev.smell
    if (tp) prev.temperature = tp
    else delete prev.temperature
    await apiFetch(`/api/sensory/items/${editingFood.value.id}`, {
      method: 'PATCH',
      headers: { 'X-User-Id': currentUserId() },
      body: JSON.stringify({
        status: editingFood.value.status,
        notes: prev,
      }),
    })
    editingFood.value = null
    await refresh()
  }

  async function deleteEditingFood() {
    if (!editingFood.value) return
    await apiFetch(`/api/sensory/items/${editingFood.value.id}`, {
      method: 'DELETE',
      headers: { 'X-User-Id': currentUserId() },
    })
    editingFood.value = null
    await refresh()
  }

  function onCloseEdit() {
    editingFood.value = null
  }

  const textureDone = computed(
    () => selectedUnsafeTextures.value.length > 0,
  )
  const temperatureDone = computed(() => selectedTemperatures.value.length > 0)
  const dietaryDone = computed(() => selectedDietary.value.length + selectedCultural.value.length > 0)
  const foodSafetyDone = computed(() => realFoodItems.value.length > 0)

  async function saveProfileOnly() {
    saveError.value = ''
    const uid = currentUserId()
    const texturePrefsEncoded = encodeUnsafeTexturePrefs(selectedUnsafeTextures.value)
    const tempPref = selectedTemperatures.value.length ? selectedTemperatures.value.join(',') : null
    await apiFetch('/api/sensory/profile', {
      method: 'POST',
      headers: { 'X-User-Id': uid },
      body: JSON.stringify({
        texturePrefs: texturePrefsEncoded,
        temperaturePref: tempPref,
        dietaryNeeds: selectedDietary.value,
        culturalRequirements: selectedCultural.value,
      }),
    })
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

  return {
    profileLoading,
    saveError,
    selectedUnsafeTextures,
    selectedTemperatures,
    selectedDietary,
    selectedCultural,
    foodInputWickedIconId,
    foodInputStatus,
    addFoodError,
    addFoodBusy,
    editingFood,
    editingNotesTex,
    editingNotesSmell,
    editingNotesTemp,
    foodsForDisplay,
    showingExampleFoods,
    textureDone,
    temperatureDone,
    dietaryDone,
    foodSafetyDone,
    toggleUnsafeTexture,
    toggleTemperature,
    toggleDietary,
    toggleCultural,
    statusPillClasses,
    statusLabel,
    onFoodRowClick,
    addFood,
    saveEditingFood,
    deleteEditingFood,
    onCloseEdit,
    saveProfileOnly,
    saveAndViewSummary,
  }
}
