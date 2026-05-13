<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PasteRecipeGuide from '../components/PasteRecipeGuide.vue'
import { useSensoryProfile } from '../composables/useSensoryProfile'
import { ApiError, apiFetch } from '../lib/api'
import { biteBudUserIdHeader } from '../composables/useUserId'

const route = useRoute()
const router = useRouter()
const { hasProfile, profile, loading: profileLoading } = useSensoryProfile()

const searchQuery = ref('')
const pasteQuery = ref('')

const query = computed({
  get: () => (activeTab.value === 'describe' ? pasteQuery.value : searchQuery.value),
  set: (v: string) => {
    if (activeTab.value === 'describe') pasteQuery.value = v
    else searchQuery.value = v
  },
})
const searchComboRef = ref<HTMLElement | null>(null)
const loadingSearch = ref(false)
const loadingImport = ref(false)
const err = ref<string | null>(null)
const activeTab = ref<'forYou' | 'explore' | 'describe'>('explore')
const hasSearched = ref(false)

const MAX_SEARCH_CHARS = 120
const MIN_SEARCH_CHARS = 2
const MIN_RECIPE_PASTE_CHARS = 40
const MAX_RECIPE_PASTE_CHARS = 40_000

const catalogPage = ref(0)
const browseSkip = ref(0)
const PAGE_SIZE = 12

type SensoryMatch = 'safe' | 'sometimes'
type PrepBucket = 'under30' | '30to60' | 'over60' | 'any'

type BrowseCard = {
  id: string
  mealDbId?: string | null
  title: string
  image?: string
  minutes?: number
  tags?: string[]
  matchStatus: SensoryMatch | 'unsafe'
  profileWarnings?: string[]
  source: 'db' | 'themealdb'
}
type SuggestionItem = {
  id: string
  mealDbId?: string | null
  title: string
  minutes?: number
  matchStatus: SensoryMatch | 'unsafe'
  profileWarnings?: string[]
  source: 'db' | 'themealdb'
}

const busy = computed(() => loadingSearch.value || loadingImport.value)
/** Full-screen overlay while navigating to recipe (library / your recipes) or visualising paste */
const showRecipeOpenOverlay = computed(
  () => loadingImport.value || (activeTab.value === 'describe' && loadingSearch.value),
)
const recipeOpenOverlayTitle = computed(() =>
  activeTab.value === 'describe' ? 'Creating your recipe' : 'Opening recipe',
)
const recipeOpenOverlayHint = computed(() =>
  activeTab.value === 'describe'
    ? 'Turning your paste into steps, ingredients, and flow…'
    : 'Loading the full recipe view…',
)
const recipeOpenOverlayDisclaimer = computed(
  () =>
    'We use AI to simplify this recipe, and we cache it in our database so it loads faster next time.',
)
const results = ref<BrowseCard[]>([])

const pasteTextareaRef = ref<HTMLTextAreaElement | null>(null)

const filterMode = ref<'safeDishes' | 'showAll'>('safeDishes')

const pendingPrep = ref<PrepBucket[]>([])
const appliedPrep = ref<PrepBucket[]>([])

// Filter modal should be usable for time/prep filtering even without a sensory profile.
// Profile-based filtering (strict safe-match) only becomes available once `hasProfile` is true.
const canUseFilters = computed(
  () => activeTab.value === 'explore' || activeTab.value === 'forYou',
)
const filtersOpen = ref(false)

const hasDietaryOrCultural = computed(() => {
  const p = profile.value
  if (!p) return false
  return (p.dietaryNeeds?.length ?? 0) + (p.culturalRequirements?.length ?? 0) > 0
})
const showsProfileIndicator = computed(() => activeTab.value === 'explore' || activeTab.value === 'forYou')
const profileModeLabel = computed(() => {
  if (!hasProfile.value) return 'Filter: Prep time'
  return filterMode.value === 'safeDishes' ? 'Filter: Safe dishes only' : 'Filter: Showing all dishes'
})
const profileModeHint = computed(() => {
  if (!hasProfile.value) return 'Only prep time filters are active.'
  return filterMode.value === 'safeDishes'
    ? 'Conflicting dishes are filtered out.'
    : 'All dishes stay visible and conflicts are flagged.'
})
const canShowSuggestionsForTab = computed(() => activeTab.value === 'explore' || activeTab.value === 'forYou')
const suggestions = ref<SuggestionItem[]>([])
const loadingSuggestions = ref(false)
const suggestionsOpen = ref(false)
const activeSuggestionIndex = ref(-1)
let suggestionDebounce: ReturnType<typeof setTimeout> | null = null
let latestSuggestionRequest = 0

function tabFromRoute(): 'forYou' | 'explore' | 'describe' {
  const t = route.query.tab
  if (t === 'history') return 'forYou'
  if (t === 'paste') return 'describe'
  return 'explore'
}

function setRouteTab(tab: 'forYou' | 'explore' | 'describe') {
  const q = tab === 'forYou' ? 'history' : tab === 'describe' ? 'paste' : 'library'
  router.replace({ path: '/search', query: { ...route.query, tab: q } })
}

watch(
  () => route.query.tab,
  () => {
    activeTab.value = tabFromRoute()
    catalogPage.value = 0
    browseSkip.value = 0
    results.value = []
    err.value = null
    hasSearched.value = false
    if (activeTab.value === 'forYou') void search()
  },
  { immediate: true },
)

watch(
  () => [hasProfile.value, profileLoading.value] as const,
  ([ok, loading]) => {
    if (loading) return // wait until profile fetch completes
    if (!ok) {
      filterMode.value = 'showAll'
      if (route.query.tab === 'history') {
        router.replace({ path: '/search', query: { ...route.query, tab: 'library' } })
      }
    } else {
      // profile just loaded — default to strict mode
      filterMode.value = 'safeDishes'
    }
  },
  { immediate: true },
)

function syncLegacyFiltersFromBuckets() {
  // legacy mapping removed (filters simplified)
}

function applySidebarFilters() {
  appliedPrep.value = [...pendingPrep.value]
  syncLegacyFiltersFromBuckets()
  catalogPage.value = 0
  browseSkip.value = 0
  if (hasSearched.value) void search()
}

const filterCount = computed(() => pendingPrep.value.length)
const appliedPrepLabel = computed(() => {
  if (!appliedPrep.value.length) return ''
  return appliedPrep.value
    .map((opt) => (opt === 'under30' ? '<30 min' : opt === '30to60' ? '30-60 min' : '>60 min'))
    .join(', ')
})
const filterButtonLabel = computed(() => {
  if (!appliedPrepLabel.value) return 'Filter'
  return `Filter: ${appliedPrepLabel.value}`
})

function togglePendingPrep(p: PrepBucket) {
  if (p === 'any') {
    pendingPrep.value = []
    return
  }
  const set = new Set(pendingPrep.value)
  if (set.has(p)) set.delete(p)
  else set.add(p)
  pendingPrep.value = [...set]
}

function setFilterMode(v: 'safeDishes' | 'showAll') {
  filterMode.value = v
  if (hasProfile.value && hasSearched.value && (activeTab.value === 'forYou' || activeTab.value === 'explore')) void search()
}

function openFilters() {
  if (!canUseFilters.value || busy.value) return
  filtersOpen.value = true
}

function closeFilters() {
  filtersOpen.value = false
}

function applyFiltersAndClose() {
  applySidebarFilters()
  closeFilters()
}

function onGlobalKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (filtersOpen.value) closeFilters()
    if (suggestionsOpen.value) closeSuggestions()
  }
}

function onGlobalPointerDown(e: MouseEvent) {
  if (!suggestionsOpen.value) return
  const target = e.target
  if (!(target instanceof Node)) return
  if (searchComboRef.value?.contains(target)) return
  closeSuggestions()
}

function autosizePasteField() {
  const el = pasteTextareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(Math.max(el.scrollHeight, 52), 320)}px`
}

function onPasteSearchKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void search()
  }
}

function resetSuggestions() {
  suggestions.value = []
  activeSuggestionIndex.value = -1
  loadingSuggestions.value = false
}

function closeSuggestions() {
  suggestionsOpen.value = false
  activeSuggestionIndex.value = -1
}

function mapSuggestionCards(cards: BrowseCard[]): SuggestionItem[] {
  return cards.slice(0, 6).map((card) => ({
    id: card.id,
    mealDbId: card.mealDbId,
    title: card.title,
    minutes: card.minutes,
    matchStatus: card.matchStatus,
    profileWarnings: card.profileWarnings ?? [],
    source: card.source,
  }))
}

async function fetchSuggestions(rawText: string) {
  const text = rawText.trim()
  if (!canShowSuggestionsForTab.value || !text || busy.value) {
    resetSuggestions()
    closeSuggestions()
    return
  }
  const requestId = ++latestSuggestionRequest
  loadingSuggestions.value = true
  try {
    if (activeTab.value === 'forYou') {
      const params = new URLSearchParams()
      params.set('q', text)
      params.set('filter', hasProfile.value ? filterMode.value : 'showAll')
      params.set('limit', '6')
      params.set('skip', '0')
      params.set('sort', 'newest')
      const data = await apiFetch<{ results: Omit<BrowseCard, 'source'>[] }>(
        `/api/recipes/browse?${params.toString()}`,
        { headers: biteBudUserIdHeader() },
      )
      if (requestId !== latestSuggestionRequest) return
      suggestions.value = mapSuggestionCards(
        data.results.map((result) => ({
          ...result,
          profileWarnings: result.profileWarnings ?? [],
          source: 'db' as const,
        })),
      )
    } else if (activeTab.value === 'explore') {
      const params = new URLSearchParams()
      params.set('q', text)
      params.set('page', '0')
      params.set('limit', '6')
      params.set('filter', hasProfile.value ? filterMode.value : 'showAll')
      const data = await apiFetch<{
        results: {
          id: string
          title: string
          image?: string
          minutes?: number | null
          matchStatus?: SensoryMatch | 'unsafe'
          profileWarnings?: string[]
        }[]
      }>(`/api/recipes/search?${params.toString()}`, { headers: biteBudUserIdHeader() })
      if (requestId !== latestSuggestionRequest) return
      suggestions.value = mapSuggestionCards(
        data.results.map((result) => ({
          id: result.id,
          mealDbId: result.id,
          title: result.title,
          image: result.image,
          minutes: result.minutes ?? undefined,
          matchStatus: result.matchStatus ?? 'safe',
          profileWarnings: result.profileWarnings ?? [],
          source: 'themealdb' as const,
          tags: [],
        })),
      )
    }
    suggestionsOpen.value = suggestions.value.length > 0
    activeSuggestionIndex.value = suggestions.value.length ? 0 : -1
  } catch {
    if (requestId !== latestSuggestionRequest) return
    resetSuggestions()
    closeSuggestions()
  } finally {
    if (requestId === latestSuggestionRequest) loadingSuggestions.value = false
  }
}

function queueSuggestionFetch(rawText: string) {
  if (suggestionDebounce) clearTimeout(suggestionDebounce)
  if (!rawText.trim() || !canShowSuggestionsForTab.value) {
    resetSuggestions()
    closeSuggestions()
    return
  }
  suggestionDebounce = setTimeout(() => {
    void fetchSuggestions(rawText)
  }, 180)
}

function onSearchInputFocus() {
  if (canShowSuggestionsForTab.value && suggestions.value.length) {
    suggestionsOpen.value = true
    if (activeSuggestionIndex.value < 0) activeSuggestionIndex.value = 0
  }
}

async function selectSuggestion(item: SuggestionItem) {
  closeSuggestions()
  searchQuery.value = item.title
  await openRecipeWithConfirm(item)
}

async function onSearchInputKeydown(e: KeyboardEvent) {
  if (!canShowSuggestionsForTab.value) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (activeTab.value !== 'explore') {
        activeTab.value = 'explore'
        catalogPage.value = 0
        browseSkip.value = 0
        await router.replace({ path: '/search', query: { ...route.query, tab: 'library' } })
      }
      await search()
    }
    return
  }
  if (e.key === 'ArrowDown') {
    if (!suggestions.value.length) return
    e.preventDefault()
    suggestionsOpen.value = true
    activeSuggestionIndex.value = Math.min(activeSuggestionIndex.value + 1, suggestions.value.length - 1)
    return
  }
  if (e.key === 'ArrowUp') {
    if (!suggestions.value.length) return
    e.preventDefault()
    suggestionsOpen.value = true
    activeSuggestionIndex.value = Math.max(activeSuggestionIndex.value - 1, 0)
    return
  }
  if (e.key === 'Escape') {
    if (suggestionsOpen.value) {
      e.preventDefault()
      closeSuggestions()
    }
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    closeSuggestions()
    if (activeTab.value !== 'explore') {
      activeTab.value = 'explore'
      catalogPage.value = 0
      browseSkip.value = 0
      await router.replace({ path: '/search', query: { ...route.query, tab: 'library' } })
    }
    await search()
  }
}

watch(
  () => [query.value, activeTab.value] as const,
  () => {
    if (activeTab.value === 'describe') nextTick(() => autosizePasteField())
    else queueSuggestionFetch(query.value)
  },
)

watch(
  () => activeTab.value,
  () => {
    if (activeTab.value === 'describe') closeFilters()
    resetSuggestions()
    closeSuggestions()
  },
)

watch(
  () => hasProfile.value,
  (ok) => {
    if (!ok) closeFilters()
    queueSuggestionFetch(searchQuery.value)
  },
)

watch(
  () => filterMode.value,
  () => {
    queueSuggestionFetch(searchQuery.value)
  },
)

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown)
  window.addEventListener('mousedown', onGlobalPointerDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('mousedown', onGlobalPointerDown)
  if (suggestionDebounce) clearTimeout(suggestionDebounce)
})


async function search() {
  err.value = null
  closeSuggestions()
  hasSearched.value = true
  if (activeTab.value === 'describe' && !query.value.trim()) {
    results.value = []
    return
  }
  if (activeTab.value === 'explore' && !query.value.trim()) {
    results.value = []
    return
  }

  const qTrimmed = query.value.trim()
  if ((activeTab.value === 'explore' || activeTab.value === 'forYou') && qTrimmed) {
    if (qTrimmed.length < MIN_SEARCH_CHARS) {
      err.value = `Search must be at least ${MIN_SEARCH_CHARS} characters.`
      results.value = []
      return
    }
    if (qTrimmed.length > MAX_SEARCH_CHARS) {
      err.value = `Search is too long (max ${MAX_SEARCH_CHARS} characters).`
      results.value = []
      return
    }
  }
  if (activeTab.value === 'describe') {
    const normalizedPaste = query.value.replace(/\r\n?/g, '\n').trim()
    if (normalizedPaste.length < MIN_RECIPE_PASTE_CHARS) {
      err.value = 'Paste the full recipe text (ingredients + instructions).'
      results.value = []
      return
    }
    if (normalizedPaste.length > MAX_RECIPE_PASTE_CHARS) {
      err.value = `Recipe text is too long (max ${MAX_RECIPE_PASTE_CHARS.toLocaleString()} characters).`
      results.value = []
      return
    }
  }

  loadingSearch.value = true
  try {
    if (activeTab.value === 'forYou') {
      const params = new URLSearchParams()
      if (qTrimmed) params.set('q', qTrimmed)
      params.set('filter', hasProfile.value ? filterMode.value : 'showAll')
      params.set('limit', String(PAGE_SIZE))
      params.set('skip', String(browseSkip.value))
      params.set('sort', 'newest')
      const data = await apiFetch<{ results: Omit<BrowseCard, 'source'>[] }>(
        `/api/recipes/browse?${params.toString()}`,
        { headers: biteBudUserIdHeader() },
      )
      results.value = data.results.map((result) => ({
        ...result,
        profileWarnings: result.profileWarnings ?? [],
        source: 'db' as const,
      }))
    } else if (activeTab.value === 'explore') {
      const params = new URLSearchParams()
      if (qTrimmed) params.set('q', qTrimmed)
      params.set('page', String(catalogPage.value))
      params.set('limit', String(PAGE_SIZE))
      params.set('filter', hasProfile.value ? filterMode.value : 'showAll')
      const data = await apiFetch<{
        results: {
          id: string
          title: string
          image?: string
          minutes?: number | null
          matchStatus?: SensoryMatch | 'unsafe'
          profileWarnings?: string[]
        }[]
      }>(`/api/recipes/search?${params.toString()}`, { headers: biteBudUserIdHeader() })
      results.value = data.results.map((result) => ({
        id: result.id,
        mealDbId: result.id,
        title: result.title,
        image: result.image,
        minutes: result.minutes ?? undefined,
        matchStatus: result.matchStatus ?? 'safe',
        profileWarnings: result.profileWarnings ?? [],
        source: 'themealdb' as const,
        tags: [],
      }))
    } else {
      const text = query.value.replace(/\r\n?/g, '\n').trim()
      const data = await apiFetch<{ recipeId: string }>(
        '/api/recipes/visualise',
        {
          method: 'POST',
          headers: biteBudUserIdHeader(),
          body: JSON.stringify({ text }),
        },
      )
      await router.push({ name: 'recipe', params: { id: data.recipeId } })
      results.value = []
    }
  } catch (e) {
    if (e instanceof ApiError && e.code === 'URL_NOT_FETCHABLE') {
      err.value =
        'That link could not be opened automatically—many sites block recipe scraping. Copy the full recipe from the page and paste the text here instead.'
    } else if (e instanceof ApiError && e.code === 'NOT_RECIPE') {
      err.value =
        'That doesn’t look like a food recipe. Paste ingredients and instructions (or a recipe URL).'
    } else if (e instanceof ApiError && e.code === 'PARSE_FAILED') {
      err.value =
        'We opened the page but could not read a clear recipe. Paste the ingredients and instructions here manually for best results.'
    } else {
      err.value = e instanceof Error ? e.message : 'Search failed'
    }
  } finally {
    loadingSearch.value = false
  }
}

async function importMealDb(id: string) {
  err.value = null
  loadingImport.value = true
  try {
    const card = results.value.find((result) => result.id === id)
    if (card?.source === 'db') {
      await router.push({ name: 'recipe', params: { id } })
    } else {
      const data = await apiFetch<{ recipeId: string }>(
        '/api/recipes/import/themealdb',
        {
          method: 'POST',
          body: JSON.stringify({ mealDbId: card?.mealDbId ?? id }),
        },
      )
      await router.push({
        name: 'recipe',
        params: { id: data.recipeId },
      })
    }
  } catch (e) {
    err.value = e instanceof Error ? e.message : 'Import failed'
  } finally {
    loadingImport.value = false
  }
}

function timeLabel(mins?: number): string {
  if (mins == null) return '—'
  return `${mins}m`
}

function passesPrep(mins?: number): boolean {
  const prep = appliedPrep.value
  if (!prep.length) return true
  const m = mins ?? 0
  let ok = false
  if (prep.includes('under30') && m <= 30) ok = true
  if (prep.includes('30to60') && m > 30 && m <= 60) ok = true
  if (prep.includes('over60') && m > 60) ok = true
  return ok
}

const filteredCards = computed(() => {
  return results.value.filter((c) => {
    if (!passesPrep(c.minutes)) return false
    return true
  })
})

const matchCountLabel = computed(() => {
  const n = filteredCards.value.length
  if (activeTab.value === 'describe') return ''
  if (activeTab.value === 'forYou') return `${n} recipe${n === 1 ? '' : 's'} in your list`
  return `${n} recipe${n === 1 ? '' : 's'} found`
})

function goPage(delta: number) {
  if (activeTab.value === 'explore') {
    catalogPage.value = Math.max(0, catalogPage.value + delta)
    void search()
  } else if (activeTab.value === 'forYou') {
    browseSkip.value = Math.max(0, browseSkip.value + delta * PAGE_SIZE)
    void search()
  }
}

function splitWarnings(warnings: readonly string[] | undefined) {
  const w = warnings ?? []
  const dietary: string[] = []
  const sensory: string[] = []
  const textures: string[] = []
  for (const raw of w) {
    if (typeof raw !== 'string') continue
    if (raw.startsWith('Texture:')) textures.push(raw.replace(/^Texture:\s*/, '').trim())
    else if (raw.startsWith('Food:')) sensory.push(raw.replace(/^Food:\s*/, '').trim())
    else dietary.push(raw.trim())
  }
  return { dietary, sensory, textures }
}

const confirmOpen = ref(false)
const confirmCard = ref<BrowseCard | null>(null)
const confirmDietary = ref<string[]>([])
const confirmSensory = ref<string[]>([])
const confirmTextures = ref<string[]>([])

function closeConfirm() {
  confirmOpen.value = false
  confirmCard.value = null
  confirmDietary.value = []
  confirmSensory.value = []
  confirmTextures.value = []
}

async function proceedOpenConfirmed() {
  const c = confirmCard.value
  if (!c) return
  closeConfirm()
  await importMealDb(c.id)
}

async function openRecipeWithConfirm(c: BrowseCard) {
  if (!hasProfile.value) {
    await importMealDb(c.id)
    return
  }
  const { dietary, sensory, textures } = splitWarnings(c.profileWarnings)
  // Only confirm for dietary + sensory conflicts. Texture warnings are informational.
  if (dietary.length || sensory.length) {
    confirmCard.value = c
    confirmDietary.value = dietary
    confirmSensory.value = sensory
    confirmTextures.value = textures
    confirmOpen.value = true
    return
  }
  await importMealDb(c.id)
}

</script>

<template>
  <div class="page">
    <div
      v-if="showRecipeOpenOverlay"
      class="recipe-open-overlay"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div class="recipe-open-overlay__inner">
        <div class="recipe-open-overlay__spinner" aria-hidden="true" />
        <p class="recipe-open-overlay__title">{{ recipeOpenOverlayTitle }}</p>
        <p class="recipe-open-overlay__hint">{{ recipeOpenOverlayHint }}</p>
        <p class="recipe-open-overlay__disclaimer">{{ recipeOpenOverlayDisclaimer }}</p>
      </div>
    </div>

    <header class="page-hero">
      <h1 class="page-title">Recipes</h1>
      <p class="page-lede">Search the library, paste a recipe, or revisit recipes you’ve completed before.</p>
    </header>

    <div class="layout">
      <section class="main">
        <div class="tabs" role="tablist" aria-label="Recipe options">
          <button type="button" class="tab" :class="{ on: activeTab === 'explore' }" @click="setRouteTab('explore')">
            Browse library
          </button>
          <button type="button" class="tab" :class="{ on: activeTab === 'describe' }" @click="setRouteTab('describe')">
            Paste a recipe
          </button>
          <button type="button" class="tab" :class="{ on: activeTab === 'forYou' }" @click="setRouteTab('forYou')">
            My recipes
          </button>
        </div>
        <p v-if="activeTab === 'forYou' && hasProfile" class="tab-help" role="note">
          These are recipes you have successfully cooked in BiteBud. Search by name to find one again.
        </p>
        <details v-if="hasProfile" class="tab-details">
          <summary>More about these tabs</summary>
          <ul class="tab-details-list">
            <li><strong>Browse library</strong> — Search from our library of recipes</li>
            <li><strong>Paste a recipe</strong> — Visulise your own recipes, paste our intrusctions and ingredients for best results.</li>
            <li><strong>My recipes</strong> — Your completed recipes</li>
          </ul>
        </details>

        <div class="toolbar">
          <div
            ref="searchComboRef"
            class="toolbar-search"
            :class="{ 'toolbar-search--paste': activeTab === 'describe', 'toolbar-search--suggestions-open': suggestionsOpen }"
          >
            <span class="search-ico" aria-hidden="true">🔎</span>
            <textarea
              v-if="activeTab === 'describe'"
              id="paste-recipe-input"
              ref="pasteTextareaRef"
              v-model="query"
              class="search-input search-input--paste"
              rows="2"
              :placeholder="'Paste full recipe text here…'"
              :disabled="busy"
              @input="autosizePasteField"
              @keydown="onPasteSearchKeydown"
            />
            <input
              v-else
              v-model="query"
              class="search-input"
              type="search"
              :placeholder="
                activeTab === 'forYou'
                  ? 'Search dish name in your history…'
                  : 'Search dish name or ingredient'
              "
              :disabled="busy"
              autocomplete="off"
              @focus="onSearchInputFocus"
              @keydown="onSearchInputKeydown"
            />
            <div
              v-if="activeTab !== 'describe' && (suggestionsOpen || loadingSuggestions)"
              class="search-suggestions"
              role="listbox"
              aria-label="Recipe suggestions"
            >
              <div v-if="loadingSuggestions" class="search-suggestions__state">Searching recipes…</div>
              <template v-else-if="suggestions.length">
                <button
                  v-for="(item, idx) in suggestions"
                  :key="`${item.source}:${item.id}`"
                  type="button"
                  class="search-suggestion"
                  :class="{ 'search-suggestion--active': idx === activeSuggestionIndex }"
                  :aria-selected="idx === activeSuggestionIndex"
                  @mousedown.prevent
                  @click="selectSuggestion(item)"
                >
                  <span class="search-suggestion__title">{{ item.title }}</span>
                  <span class="search-suggestion__meta">
                    <span v-if="item.minutes != null">{{ timeLabel(item.minutes) }}</span>
                    <span>{{ item.source === 'db' ? 'Your recipe' : 'Library' }}</span>
                  </span>
                </button>
              </template>
              <div v-else class="search-suggestions__state">No matching recipes yet.</div>
            </div>
            <button
              type="button"
              class="search-btn"
              :disabled="busy || (activeTab !== 'explore' && activeTab !== 'forYou' && !query.trim())"
              @click="search"
            >
              {{
                loadingSearch
                  ? activeTab === 'describe'
                    ? 'Visualising…'
                    : 'Searching…'
                  : activeTab === 'describe'
                    ? 'Visualise'
                    : 'Search'
              }}
            </button>
            <button
              v-if="activeTab !== 'describe'"
              type="button"
              class="filter-btn"
              :disabled="busy || !canUseFilters"
              aria-haspopup="dialog"
              :aria-expanded="filtersOpen"
              @click="openFilters"
            >
              {{ filterButtonLabel }}
            </button>
          </div>
          <div class="toolbar-rest">
            <div class="count" aria-live="polite">{{ matchCountLabel }}</div>
          </div>
          <div
            v-if="showsProfileIndicator"
            class="profile-mode-chip"
            role="status"
            :aria-label="`${profileModeLabel}. ${profileModeHint}`"
          >
            <span class="profile-mode-chip__label">{{ profileModeLabel }}</span>
            <span class="profile-mode-chip__hint">{{ profileModeHint }}</span>
          </div>
        </div>

        <PasteRecipeGuide v-if="activeTab === 'describe'" />

        <template v-else>
          <div v-if="!hasSearched && !loadingSearch" class="empty">
            Type a dish or ingredient, then press Search.
          </div>
          <div v-if="loadingSearch" class="grid" aria-busy="true">
            <div v-for="n in 6" :key="n" class="card sk">
              <div class="img img-sk" />
              <div class="body">
                <div class="line line-1" />
                <div class="line line-2" />
                <div class="line line-3" />
              </div>
            </div>
          </div>

          <div v-else class="grid">
            <article v-for="c in filteredCards" :key="c.id" class="card">
              <div class="img">
                <img v-if="c.image" :src="c.image" alt="" />
                <div v-else class="img-ph" aria-hidden="true">Recipe</div>
              </div>
              <div class="body">
                <div class="title">{{ c.title }}</div>
                <div class="meta">
                  <span class="meta-item">
                    <span class="dot" aria-hidden="true">⏱</span>
                    {{ timeLabel(c.minutes) }}
                  </span>
                </div>
                <div class="badges">
                  <span v-for="t in (c.tags ?? []).slice(0, 4)" :key="t" class="badge">{{ t }}</span>
                </div>
                <template v-if="hasProfile && (activeTab === 'explore' || activeTab === 'forYou') && (c.profileWarnings?.length ?? 0) > 0">
                  <div class="profile-warn" role="status">
                    <span class="profile-warn-title">Profile check</span>
                    <template v-if="splitWarnings(c.profileWarnings).dietary.length || splitWarnings(c.profileWarnings).sensory.length">
                      <p class="profile-warn-text profile-warn-text--danger">
                        Dietary / sensory conflicts:
                        {{
                          [...splitWarnings(c.profileWarnings).dietary, ...splitWarnings(c.profileWarnings).sensory]
                            .slice(0, 5)
                            .join(' · ')
                        }}
                      </p>
                    </template>
                    <template v-if="splitWarnings(c.profileWarnings).textures.length">
                      <p class="profile-warn-text">
                        Texture note: {{ splitWarnings(c.profileWarnings).textures.slice(0, 5).join(' · ') }}
                      </p>
                    </template>
                  </div>
                </template>
                <div
                  v-else-if="hasProfile && activeTab === 'forYou' && c.matchStatus === 'safe'"
                  class="match match--ok"
                >
                  <span class="check" aria-hidden="true">✓</span>
                  <span>No profile conflicts detected in this recipe (still verify ingredients yourself).</span>
                </div>
                <div class="card-actions">
                  <button type="button" class="btn-view" :disabled="busy" @click="openRecipeWithConfirm(c)">View recipe</button>
                </div>
              </div>
            </article>

            <div v-if="hasSearched && !filteredCards.length && !err" class="empty">
              No recipes match your current filters.
            </div>
          </div>
        </template>

        <nav v-if="activeTab !== 'describe' && hasSearched && filteredCards.length" class="pager" aria-label="Pagination">
          <button type="button" class="pager-btn" :disabled="busy || (catalogPage === 0 && browseSkip === 0)" @click="goPage(-1)">
            ←
          </button>
          <span class="pager-num">{{ activeTab === 'explore' ? catalogPage + 1 : Math.floor(browseSkip / PAGE_SIZE) + 1 }}</span>
          <button type="button" class="pager-btn" :disabled="busy || filteredCards.length < PAGE_SIZE" @click="goPage(1)">
            →
          </button>
        </nav>

        <p v-if="err" class="err" role="alert">{{ err }}</p>
      </section>
    </div>
  </div>

  <div v-if="filtersOpen" class="filter-modal-backdrop" role="presentation" @click.self="closeFilters">
    <aside class="filter-modal" role="dialog" aria-modal="true" aria-label="Filters" @click.stop>
      <div class="filters-head">
        <div class="filters-title">Filters</div>
        <button type="button" class="filter-close-btn" aria-label="Close filters" @click="closeFilters">✕</button>
      </div>

      <fieldset v-if="hasProfile" class="filter-group filter-group--profile-list">
        <legend class="k">Profile match</legend>
        <p id="profile-list-help" class="filter-help">
          Checks your foods, dietary needs, and cultural settings (best effort).
        </p>
        <button
          type="button"
          class="pill pill--stacked"
          :class="{ on: filterMode === 'safeDishes' }"
          :disabled="busy"
          :aria-pressed="filterMode === 'safeDishes'"
          aria-describedby="profile-list-help profile-strict-desc"
          @click="setFilterMode('safeDishes')"
        >
          <span class="pill-ico" aria-hidden="true">✓</span>
          <span class="pill-text">
            <span class="pill-title">Only safe matches</span>
            <span id="profile-strict-desc" class="pill-sub">Hide recipes that conflict with your profile.</span>
          </span>
        </button>
        <button
          type="button"
          class="pill pill--stacked"
          :class="{ on: filterMode === 'showAll' }"
          :disabled="busy"
          :aria-pressed="filterMode === 'showAll'"
          aria-describedby="profile-list-help profile-full-desc"
          @click="setFilterMode('showAll')"
        >
          <span class="pill-ico" aria-hidden="true">＋</span>
          <span class="pill-text">
            <span class="pill-title">Show all</span>
            <span id="profile-full-desc" class="pill-sub">Keep all results and flag conflicts.</span>
          </span>
        </button>
        <details v-if="hasDietaryOrCultural" class="filter-details">
          <summary>What do we check?</summary>
          <p class="filter-details-p">
            Unsafe/unsure foods, plus dietary and cultural choices (for example No Pork or Shellfish-Free).
          </p>
        </details>
      </fieldset>
      <div v-else class="profile profile-note" role="note">
        Set up your sensory profile to enable safety filters.
      </div>

      <div class="divider" aria-hidden="true" />

      <div class="filter-group">
        <div class="k">Prep time</div>
        <label v-for="opt in (['under30', '30to60', 'over60'] as const)" :key="opt" class="check-row">
          <input
            type="checkbox"
            :checked="pendingPrep.includes(opt)"
            @change="togglePendingPrep(opt)"
          />
          <span>{{ opt === 'under30' ? '< 30 min' : opt === '30to60' ? '30–60 min' : '> 60 min' }}</span>
        </label>
      </div>

      <!-- Heat level + Complexity removed (keep filters minimal). -->

      <button type="button" class="apply-btn" :disabled="busy" @click="applyFiltersAndClose">
        {{ filterCount ? `Apply ${filterCount} filters` : 'Apply filters' }}
      </button>
    </aside>
  </div>

  <div v-if="confirmOpen" class="confirm-host" role="presentation" @click.self="closeConfirm">
    <aside class="confirm" role="dialog" aria-modal="true" aria-label="Confirm opening recipe" @click.stop>
      <h3 class="confirm-title">Before you cook</h3>
      <p class="confirm-sub">
        This recipe may conflict with your profile. Do you still want to open it?
      </p>
      <div class="confirm-body">
        <div v-if="confirmDietary.length || confirmSensory.length" class="confirm-block confirm-block--danger">
          <div class="confirm-k">Dietary / sensory conflicts ({{ confirmDietary.length + confirmSensory.length }})</div>
          <div class="confirm-v">
            {{ [...confirmDietary, ...confirmSensory].slice(0, 10).join(' · ') }}
          </div>
        </div>
        <div v-if="confirmTextures.length" class="confirm-block">
          <div class="confirm-k">Texture note ({{ confirmTextures.length }})</div>
          <div class="confirm-v">May be sensory challenging: {{ confirmTextures.slice(0, 10).join(' · ') }}</div>
        </div>
      </div>
      <div class="confirm-actions">
        <button type="button" class="bb-btn bb-btn--secondary" @click="closeConfirm">Next time</button>
        <button type="button" class="bb-btn bb-btn--primary" @click="proceedOpenConfirmed">Let’s cook 👩‍🍳</button>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.page {
  max-width: 82rem;
  margin: 0 auto;
  padding: 1.5rem 1.25rem 3rem;
  position: relative;
}
.recipe-open-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: color-mix(in srgb, var(--bb-bg) 82%, #000 18%);
  backdrop-filter: blur(6px);
}
.recipe-open-overlay__inner {
  max-width: 22rem;
  text-align: center;
  padding: 1.5rem 1.25rem;
  border-radius: 18px;
  background: var(--bb-surface-low);
  box-shadow: 0 20px 50px rgba(26, 28, 25, 0.12);
  border: 1px solid color-mix(in srgb, var(--bb-primary) 12%, transparent);
}
.recipe-open-overlay__spinner {
  width: 44px;
  height: 44px;
  margin: 0 auto;
  border: 3px solid color-mix(in srgb, var(--bb-muted) 25%, transparent);
  border-top-color: var(--bb-primary);
  border-radius: 50%;
  animation: recipe-open-spin 0.75s linear infinite;
}
@keyframes recipe-open-spin {
  to {
    transform: rotate(360deg);
  }
}
.recipe-open-overlay__title {
  margin: 1rem 0 0;
  font-family: var(--bb-font-headline);
  font-size: 1.25rem;
  font-weight: 900;
  color: var(--bb-text);
  letter-spacing: -0.02em;
}
.recipe-open-overlay__hint {
  margin: 0.5rem 0 0;
  font-size: 0.95rem;
  line-height: 1.55;
  color: var(--bb-muted);
}
.recipe-open-overlay__disclaimer {
  margin: 0.65rem 0 0;
  font-size: 0.82rem;
  line-height: 1.55;
  color: color-mix(in srgb, var(--bb-muted) 80%, transparent);
}
.page-hero {
  margin-bottom: 1.5rem;
  max-width: 48rem;
}
.page-title {
  margin: 0;
  font-family: var(--bb-font-display, var(--bb-font-headline));
  font-weight: 700;
  font-size: clamp(1.85rem, 3.5vw, 2.65rem);
  letter-spacing: -0.03em;
  color: var(--bb-text);
  line-height: 1.1;
}
.page-lede {
  margin: 0.65rem 0 0;
  color: var(--bb-muted);
  font-size: 1.05rem;
  line-height: 1.6;
  max-width: 40rem;
}
.page-hero-tabs {
  margin: 0.85rem 0 0;
  padding: 0 0 0 1.15rem;
  max-width: 44rem;
  color: var(--bb-muted);
  font-size: 0.92rem;
  line-height: 1.55;
  display: grid;
  gap: 0.45rem;
}
.page-hero-tabs li {
  margin: 0;
}
.page-hero-tabs strong {
  color: var(--bb-text);
}

.layout {
  display: block;
}
.filter-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 230;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: color-mix(in srgb, var(--bb-bg) 82%, #000 18%);
  backdrop-filter: blur(6px);
}
.filter-modal {
  width: min(36rem, 100%);
  max-height: min(85vh, 52rem);
  overflow: auto;
  background: var(--bb-surface-lowest);
  border-radius: 20px;
  padding: 1.15rem;
  box-shadow: 0 14px 40px rgba(26, 28, 25, 0.1);
  border: 1px solid color-mix(in srgb, var(--bb-primary) 12%, transparent);
}
.filters-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}
.filters-title {
  font-family: var(--bb-font-headline);
  font-weight: 900;
  color: var(--bb-text);
  letter-spacing: -0.02em;
  font-size: 1.05rem;
}
.filter-close-btn {
  border: none;
  background: var(--bb-surface-low);
  color: var(--bb-text);
  border-radius: 10px;
  width: 2rem;
  height: 2rem;
  font-size: 1rem;
  font-weight: 800;
  cursor: pointer;
}
.filter-group {
  display: grid;
  gap: 0.5rem;
  margin-top: 0.75rem;
}
.k {
  font-family: var(--bb-font-label);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-weight: 800;
  font-size: 0.7rem;
  color: color-mix(in srgb, var(--bb-muted) 88%, transparent);
}
.check-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--bb-text);
  cursor: pointer;
}
.pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}
.sense-pill {
  border: 1px solid color-mix(in srgb, var(--bb-primary) 18%, transparent);
  background: var(--bb-surface-low);
  border-radius: 999px;
  padding: 0.4rem 0.65rem;
  font-family: var(--bb-font-label);
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: var(--bb-text);
  cursor: pointer;
}
.sense-pill.on {
  background: color-mix(in srgb, var(--bb-primary) 16%, var(--bb-surface-lowest));
  border-color: var(--bb-primary);
}
.apply-btn {
  margin-top: 1rem;
  width: 100%;
  border: none;
  border-radius: 14px;
  padding: 0.75rem 1rem;
  font-family: var(--bb-font-headline);
  font-weight: 800;
  font-size: 0.95rem;
  background: var(--bb-primary);
  color: #fff;
  cursor: pointer;
  box-shadow: 0 8px 24px color-mix(in srgb, var(--bb-primary) 35%, transparent);
}
.apply-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.filter-group--profile-list {
  border: none;
  margin: 0;
  padding: 0;
  min-width: 0;
}
.filter-help {
  margin: 0 0 0.5rem;
  font-size: 0.78rem;
  line-height: 1.45;
  color: var(--bb-muted);
  font-weight: 500;
}
.filter-details {
  margin-top: 0.5rem;
  font-size: 0.78rem;
  color: var(--bb-muted);
}
.filter-details-p {
  margin: 0.35rem 0 0;
  line-height: 1.45;
}
.pill--stacked {
  align-items: flex-start;
  text-align: left;
  width: 100%;
}
.pill-text {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
.pill-title {
  font-weight: 800;
  font-size: 0.86rem;
  line-height: 1.25;
}
.pill-sub {
  font-weight: 500;
  font-size: 0.72rem;
  line-height: 1.4;
  color: color-mix(in srgb, var(--bb-muted) 92%, var(--bb-text));
}
.pill {
  border: none;
  background: var(--bb-surface-low);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--bb-primary) 10%, transparent);
  border-radius: 14px;
  padding: 0.65rem 0.75rem;
  font: inherit;
  display: flex;
  align-items: center;
  gap: 0.55rem;
  color: var(--bb-text);
  font-weight: 800;
  cursor: pointer;
  font-size: 0.88rem;
}
.pill.on {
  box-shadow:
    inset 0 0 0 2px color-mix(in srgb, var(--bb-primary) 55%, transparent),
    0 10px 22px rgba(26, 28, 25, 0.05);
  background: color-mix(in srgb, var(--bb-secondary-container) 40%, var(--bb-surface-lowest));
}
.pill:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}
.pill-ico {
  width: 18px;
  height: 18px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--bb-primary) 12%, transparent);
  font-weight: 900;
  color: var(--bb-primary);
}

.row {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.chip {
  border-radius: 999px;
  padding: 0.45rem 0.7rem;
  font-family: var(--bb-font-label);
  font-weight: 700;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--bb-text);
  background: color-mix(in srgb, var(--bb-surface-low) 85%, transparent);
  border: 1px solid color-mix(in srgb, var(--bb-primary) 10%, transparent);
  cursor: pointer;
}
.chip.on {
  background: color-mix(in srgb, var(--bb-primary) 18%, var(--bb-surface-lowest));
  border-color: color-mix(in srgb, var(--bb-primary) 34%, transparent);
  font-weight: 900;
}
.chip:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}
.chip-any {
  margin-top: 0.55rem;
}

.divider {
  height: 1px;
  width: 100%;
  background: color-mix(in srgb, var(--bb-muted) 18%, transparent);
  margin-top: 0.85rem;
}

.profile {
  margin-top: 1rem;
  padding: 0.85rem;
  background: var(--bb-surface-low);
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--bb-primary) 10%, transparent);
}
.profile-k {
  font-family: var(--bb-font-label);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-weight: 900;
  font-size: 0.64rem;
  color: var(--bb-muted);
}
.profile-v {
  margin-top: 0.35rem;
  color: var(--bb-text);
  font-size: 0.88rem;
  line-height: 1.4;
  font-weight: 700;
}
.profile-note {
  margin-top: 0.75rem;
  color: var(--bb-muted);
  font-size: 0.88rem;
  font-weight: 700;
}

.main {
  min-width: 0;
}
.tabs {
  display: inline-flex;
  gap: 0.5rem;
  margin-bottom: 0.85rem;
  flex-wrap: wrap;
}
.tab {
  border: 1px solid color-mix(in srgb, var(--bb-primary) 18%, transparent);
  background: var(--bb-surface-low);
  color: var(--bb-text);
  border-radius: 999px;
  padding: 0.5rem 1rem;
  font-family: var(--bb-font-headline);
  font-weight: 800;
  font-size: 0.92rem;
  cursor: pointer;
}
.tab:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.tab.on {
  background: var(--bb-surface-lowest);
  border-color: var(--bb-primary);
  box-shadow: 0 4px 16px rgba(26, 28, 25, 0.06);
}
.gentle-note {
  margin: -0.15rem 0 0.75rem;
  color: var(--bb-muted);
  font-size: 0.9rem;
}
.tab-help {
  margin: 0 0 0.65rem;
  padding: 0.55rem 0.7rem;
  border-radius: 10px;
  background: var(--bb-surface-low);
  color: var(--bb-text);
  font-size: 0.92rem;
  line-height: 1.45;
  max-width: 42rem;
}
.tab-details {
  margin: 0 0 0.85rem;
  max-width: 44rem;
  font-size: 0.9rem;
  color: var(--bb-muted);
}
.tab-details summary {
  cursor: pointer;
  font-weight: 700;
  color: var(--bb-accent);
}
.tab-details-list {
  margin: 0.5rem 0 0;
  padding-left: 1.2rem;
  line-height: 1.5;
}
.tab-details-list li {
  margin-bottom: 0.35rem;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.1rem;
  padding: 0.85rem 1rem;
  background: var(--bb-surface-lowest);
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--bb-primary) 8%, transparent);
  box-shadow: 0 8px 28px rgba(26, 28, 25, 0.04);
}
.toolbar-search {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex: 1 1 auto;
  min-width: min(100%, 32rem);
  max-width: 44rem;
  padding: 0.35rem 0.35rem 0.35rem 0.45rem;
  background: var(--bb-surface-low);
  border: 1px solid color-mix(in srgb, var(--bb-primary) 12%, transparent);
  border-radius: 22px;
}
.toolbar-search--paste {
  align-items: flex-start;
}
.toolbar-search--suggestions-open {
  border-bottom-left-radius: 10px;
  border-bottom-right-radius: 10px;
}
.toolbar-search--paste .search-ico {
  margin-top: 0.35rem;
}
.toolbar-rest {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
  margin-left: 0.25rem;
}
.profile-mode-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  width: 55%;
  margin-left: 0;
  padding: 0.45rem 0.8rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bb-primary) 10%, var(--bb-surface-low));
  border: 1px solid color-mix(in srgb, var(--bb-primary) 18%, transparent);
  color: var(--bb-text);
}
.profile-mode-chip__label {
  font-family: var(--bb-font-label);
  font-weight: 900;
  font-size: 0.78rem;
  letter-spacing: 0.03em;
}
.profile-mode-chip__hint {
  font-size: 0.82rem;
  color: var(--bb-muted);
}
.search-ico {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  color: var(--bb-muted);
  background: color-mix(in srgb, var(--bb-surface-low) 70%, transparent);
  flex-shrink: 0;
}
.search-input {
  width: 100%;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font: inherit;
  font-size: 1.12rem;
  line-height: 1.4;
  color: var(--bb-text);
  padding: 0.8rem 0.1rem;
}
.search-input--paste {
  min-height: 72px;
  max-height: 320px;
  overflow-y: auto;
  resize: vertical;
  field-sizing: content;
  padding: 0.7rem 0.1rem;
}
@supports not (field-sizing: content) {
  .search-input--paste {
    resize: vertical;
  }
}
.search-btn {
  border: none;
  border-radius: 999px;
  padding: 0.55rem 1rem;
  font-family: var(--bb-font-headline);
  font-weight: 800;
  background: var(--bb-primary);
  color: #fff;
  cursor: pointer;
  flex-shrink: 0;
}
.search-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.filter-btn {
  border: 1px solid color-mix(in srgb, var(--bb-primary) 20%, transparent);
  border-radius: 999px;
  padding: 0.55rem 1rem;
  font-family: var(--bb-font-headline);
  font-weight: 800;
  color: var(--bb-text);
  background: var(--bb-surface-low);
  cursor: pointer;
  flex-shrink: 0;
}
.filter-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.search-suggestions {
  position: absolute;
  top: calc(100% - 0.2rem);
  left: 0;
  right: 0;
  z-index: 12;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.45rem;
  background: var(--bb-surface-low);
  border: 1px solid color-mix(in srgb, var(--bb-primary) 12%, transparent);
  border-top: none;
  border-radius: 0 0 22px 22px;
  box-shadow: 0 20px 40px rgba(26, 28, 25, 0.12);
}
.search-suggestions__state {
  padding: 0.7rem 0.8rem;
  font-size: 0.92rem;
  color: var(--bb-muted);
}
.search-suggestion {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  padding: 0.75rem 0.85rem;
  border: none;
  border-radius: 14px;
  background: transparent;
  color: var(--bb-text);
  text-align: left;
  cursor: pointer;
}
.search-suggestion:hover,
.search-suggestion--active {
  background: color-mix(in srgb, var(--bb-primary) 10%, transparent);
}
.search-suggestion__title {
  min-width: 0;
  font-weight: 700;
}
.search-suggestion__meta {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  flex-shrink: 0;
  font-size: 0.82rem;
  color: var(--bb-muted);
}

.count {
  font-family: var(--bb-font-label);
  font-weight: 800;
  font-size: 0.8rem;
  color: var(--bb-muted);
  letter-spacing: 0.04em;
}

@media (max-width: 720px) {
  .toolbar {
    padding: 1rem;
  }
  .toolbar-search {
    width: 100%;
    min-width: 100%;
    flex-wrap: wrap;
    gap: 0.7rem;
    padding: 0.45rem 0.45rem 0.45rem 0.55rem;
    border-radius: 24px;
  }
  .search-ico {
    order: 1;
    width: 42px;
    height: 42px;
    font-size: 1.05rem;
  }
  .search-input {
    order: 2;
    flex: 1 1 calc(100% - 3.5rem);
    font-size: 1.05rem;
    padding: 0.95rem 0.1rem;
  }
  .search-btn,
  .filter-btn {
    margin-left: 0;
    padding: 0.8rem 1rem;
  }
  .search-btn {
    order: 3;
  }
  .filter-btn {
    order: 4;
  }
  .search-suggestions {
    border-radius: 0 0 24px 24px;
  }
  .search-suggestion {
    align-items: flex-start;
    flex-direction: column;
  }
  .profile-mode-chip {
    width: 100%;
    margin-left: 0;
    justify-content: space-between;
    border-radius: 16px;
  }
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1.1rem;
}

.card {
  background: var(--bb-surface-lowest);
  border-radius: 18px;
  box-shadow: 0 14px 40px rgba(26, 28, 25, 0.06);
  overflow: hidden;
  width: 100%;
  text-align: left;
  border: 1px solid color-mix(in srgb, var(--bb-primary) 6%, transparent);
}
.img {
  height: 150px;
  background: var(--bb-surface-low);
  position: relative;
  overflow: hidden;
  display: grid;
  place-items: center;
}
.img img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.img-badges {
  position: absolute;
  top: 0.55rem;
  left: 0.55rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  z-index: 1;
}
.img-badge {
  font-size: 0.58rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.25rem 0.45rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  color: var(--bb-text);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}
.img-ph {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  color: color-mix(in srgb, var(--bb-muted) 90%, transparent);
  font-family: var(--bb-font-label);
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-size: 0.66rem;
}
.body {
  padding: 0.9rem 1rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.title {
  font-family: var(--bb-font-display, var(--bb-font-headline));
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--bb-text);
  line-height: 1.25;
  font-size: 1.08rem;
}
.meta {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  color: var(--bb-muted);
  font-size: 0.86rem;
}
.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.badges {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  min-height: 22px;
}
.badge {
  display: inline-flex;
  align-items: center;
  padding: 0.3rem 0.5rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bb-surface-low) 90%, transparent);
  border: 1px solid color-mix(in srgb, var(--bb-primary) 10%, transparent);
  font-family: var(--bb-font-label);
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-size: 0.6rem;
  color: var(--bb-text);
}
.profile-warn {
  margin-top: 0.35rem;
  padding: 0.45rem 0.55rem;
  border-radius: 12px;
  background: color-mix(in srgb, #f59e0b 12%, var(--bb-surface-lowest));
  border: 1px solid color-mix(in srgb, #f59e0b 28%, transparent);
}
.profile-warn--unsafe {
  background: color-mix(in srgb, #ef4444 11%, var(--bb-surface-lowest));
  border-color: color-mix(in srgb, #ef4444 26%, transparent);
}
.profile-warn--unsafe .profile-warn-title {
  color: color-mix(in srgb, var(--bb-text) 65%, #991b1b);
}
.profile-warn--unsafe .profile-warn-text {
  color: color-mix(in srgb, var(--bb-text) 88%, #991b1b);
}
.profile-warn-title {
  display: block;
  font-family: var(--bb-font-label);
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--bb-text) 70%, #92400e);
  margin-bottom: 0.15rem;
}
.profile-warn-text {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.4;
  font-weight: 700;
  color: color-mix(in srgb, var(--bb-text) 88%, #92400e);
}
.profile-warn-text--amber {
  color: color-mix(in srgb, var(--bb-text) 82%, #b45309);
}
.match {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.5rem 0.6rem;
  border-radius: 12px;
  background: color-mix(in srgb, #22c55e 14%, var(--bb-surface-lowest));
  border: 1px solid color-mix(in srgb, #22c55e 22%, transparent);
  color: color-mix(in srgb, var(--bb-text) 90%, #065f46);
  font-size: 0.78rem;
  font-weight: 700;
  line-height: 1.35;
}
.match--ok .check {
  flex-shrink: 0;
  margin-top: 0.1rem;
}
.check {
  width: 18px;
  height: 18px;
  border-radius: 6px;
  background: color-mix(in srgb, #22c55e 25%, transparent);
  display: grid;
  place-items: center;
  color: #065f46;
  font-weight: 900;
}
.card-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.35rem;
  flex-wrap: wrap;
}
.btn-view {
  width: 100%;
  border: none;
  border-radius: 12px;
  padding: 0.55rem 0.75rem;
  font-family: var(--bb-font-headline);
  font-weight: 800;
  font-size: 0.88rem;
  background: var(--bb-primary);
  color: #fff;
  cursor: pointer;
}
.btn-view:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  margin-top: 1.5rem;
}
.pager-btn {
  width: 40px;
  height: 40px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--bb-primary) 18%, transparent);
  background: var(--bb-surface-lowest);
  cursor: pointer;
  font-size: 1rem;
  font-weight: 800;
  color: var(--bb-text);
}
.pager-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.pager-num {
  font-weight: 800;
  font-size: 0.95rem;
  min-width: 2rem;
  text-align: center;
}

.err {
  color: #b91c1c;
  margin-top: 0.85rem;
}
.empty {
  grid-column: 1 / -1;
  padding: 1.2rem 1rem;
  border-radius: 14px;
  background: var(--bb-surface-low);
  color: var(--bb-muted);
  font-weight: 800;
}

.profile-warn-text--danger {
  color: #991b1b;
}

.confirm-host {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(28, 25, 23, 0.38);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}
.confirm {
  width: min(640px, 100%);
  border-radius: 16px;
  background: var(--bb-surface-lowest);
  border: 1px solid var(--bb-border);
  padding: 1rem 1rem 0.95rem;
  box-shadow: 0 18px 60px rgba(26, 28, 25, 0.18);
}
.confirm-title {
  margin: 0;
  font-family: var(--bb-font-headline);
  font-weight: 900;
  color: var(--bb-text);
}
.confirm-sub {
  margin: 0.4rem 0 0;
  color: var(--bb-muted);
  line-height: 1.55;
}
.confirm-body {
  margin-top: 0.9rem;
  display: grid;
  gap: 0.6rem;
}
.confirm-block {
  border-radius: 12px;
  background: var(--bb-surface-low);
  border: 1px solid var(--bb-border);
  padding: 0.65rem 0.75rem;
}
.confirm-block--danger {
  background: #fef2f2;
  border-color: color-mix(in srgb, var(--bb-error) 35%, var(--bb-border));
}
.confirm-k {
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--bb-muted);
}
.confirm-v {
  margin-top: 0.25rem;
  color: var(--bb-text);
  line-height: 1.45;
  font-weight: 700;
  font-size: 0.92rem;
}
.confirm-actions {
  margin-top: 0.9rem;
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.sk {
  cursor: default;
}
.img-sk {
  background: linear-gradient(90deg, var(--bb-surface-low) 0%, var(--bb-surface-lowest) 50%, var(--bb-surface-low) 100%);
  background-size: 200% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}
.line {
  height: 12px;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--bb-surface-low) 0%, var(--bb-surface-lowest) 50%, var(--bb-surface-low) 100%);
  background-size: 200% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}
.line-1 {
  width: 80%;
}
.line-2 {
  width: 65%;
}
.line-3 {
  width: 55%;
}
@keyframes shimmer {
  0% {
    background-position: 0% 50%;
  }
  100% {
    background-position: 200% 50%;
  }
}

@media (max-width: 900px) {
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 640px) {
  .filter-modal-backdrop {
    align-items: end;
    padding: 0;
  }
  .filter-modal {
    width: 100%;
    max-height: 88vh;
    border-radius: 18px 18px 0 0;
    border-bottom: none;
    padding-bottom: max(1.15rem, env(safe-area-inset-bottom));
  }
  .grid {
    grid-template-columns: 1fr;
  }
  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
