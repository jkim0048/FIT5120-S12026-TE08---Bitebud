<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PasteRecipeGuide from '../components/PasteRecipeGuide.vue'
import { useSensoryProfile } from '../composables/useSensoryProfile'
import { ApiError, apiFetch } from '../lib/api'
import { biteBudUserIdHeader } from '../composables/useUserId'

const route = useRoute()
const router = useRouter()
const { hasProfile, profile, loading: profileLoading } = useSensoryProfile()

const query = ref('')
const loadingSearch = ref(false)
const loadingImport = ref(false)
const err = ref<string | null>(null)
const activeTab = ref<'forYou' | 'explore' | 'describe'>('explore')

const catalogPage = ref(0)
const browseSkip = ref(0)
const pageSize = 12

type SensoryMatch = 'safe' | 'sometimes'
type HeatLevel = 'none' | 'low' | 'medium'
type Complexity = 'low' | 'medium' | 'any'
type PrepBucket = 'under30' | '30to60' | 'over60' | 'any'

type BrowseCard = {
  id: string
  mealDbId?: string | null
  title: string
  image?: string
  minutes?: number
  heatLevel?: HeatLevel
  complexity?: Exclude<Complexity, 'any'>
  tags?: string[]
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
const results = ref<BrowseCard[]>([])

const pasteTextareaRef = ref<HTMLTextAreaElement | null>(null)

const includeSometimes = ref(false)

const pendingPrep = ref<PrepBucket[]>([])
const pendingComplexity = ref<('beginner' | 'intermediate')[]>([])
const appliedPrep = ref<PrepBucket[]>([])
const appliedComplexity = ref<('beginner' | 'intermediate')[]>([])

const cookTime = ref<'under_15' | 'under_30' | 'any'>('any')
const complexity = ref<Complexity>('any')
const heatLevel = ref<HeatLevel | 'any'>('any')

const showFiltersSidebar = computed(() => activeTab.value === 'explore' || activeTab.value === 'forYou')

const hasDietaryOrCultural = computed(() => {
  const p = profile.value
  if (!p) return false
  return (p.dietaryNeeds?.length ?? 0) + (p.culturalRequirements?.length ?? 0) > 0
})

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
    void search()
  },
  { immediate: true },
)

watch(
  () => hasProfile.value,
  (ok) => {
    if (!ok) {
      includeSometimes.value = true
      if (route.query.tab === 'history') {
        router.replace({ path: '/search', query: { ...route.query, tab: 'library' } })
      }
    }
  },
  { immediate: true },
)

function syncLegacyFiltersFromBuckets() {
  const prep = appliedPrep.value
  if (prep.length === 0) {
    cookTime.value = 'any'
  } else if (prep.includes('under30') && prep.length === 1) {
    cookTime.value = 'under_30'
  } else if (prep.includes('under30') && !prep.includes('30to60') && !prep.includes('over60')) {
    cookTime.value = 'under_30'
  } else {
    cookTime.value = 'any'
  }
  const cx = appliedComplexity.value
  if (cx.length === 1 && cx[0] === 'beginner') complexity.value = 'low'
  else if (cx.length === 1 && cx[0] === 'intermediate') complexity.value = 'medium'
  else complexity.value = 'any'
}

function applySidebarFilters() {
  appliedPrep.value = [...pendingPrep.value]
  appliedComplexity.value = [...pendingComplexity.value]
  syncLegacyFiltersFromBuckets()
  catalogPage.value = 0
  browseSkip.value = 0
  void search()
}

const filterCount = computed(() => pendingPrep.value.length + pendingComplexity.value.length)

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

function togglePendingCx(c: 'beginner' | 'intermediate') {
  const set = new Set(pendingComplexity.value)
  if (set.has(c)) set.delete(c)
  else set.add(c)
  pendingComplexity.value = [...set]
}

function setIncludeSometimes(v: boolean) {
  includeSometimes.value = v
  if (hasProfile.value && (activeTab.value === 'forYou' || activeTab.value === 'explore')) void search()
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

watch(
  () => [query.value, activeTab.value] as const,
  () => {
    if (activeTab.value === 'describe') nextTick(() => autosizePasteField())
  },
)


async function search() {
  err.value = null
  if (activeTab.value === 'describe' && !query.value.trim()) {
    results.value = []
    return
  }
  loadingSearch.value = true
  try {
    if (activeTab.value === 'forYou') {
      const params = new URLSearchParams()
      if (query.value.trim()) params.set('q', query.value.trim())
      if (cookTime.value === 'under_15') params.set('maxMinutes', '15')
      else if (cookTime.value === 'under_30') params.set('maxMinutes', '30')
      if (complexity.value !== 'any') params.set('complexity', complexity.value)
      if (heatLevel.value !== 'any') params.set('heatLevel', heatLevel.value)
      params.set('includeSometimes', String(hasProfile.value ? includeSometimes.value : true))
      params.set('limit', String(pageSize))
      params.set('skip', String(browseSkip.value))
      params.set('sort', 'newest')
      const data = await apiFetch<{ results: Omit<BrowseCard, 'source'>[] }>(
        `/api/recipes/browse?${params.toString()}`,
        { headers: biteBudUserIdHeader() },
      )
      results.value = data.results.map((r) => ({
        ...r,
        profileWarnings: r.profileWarnings ?? [],
        source: 'db' as const,
      }))
    } else if (activeTab.value === 'explore') {
      const params = new URLSearchParams()
      const q = query.value.trim()
      if (q) params.set('q', q)
      params.set('page', String(catalogPage.value))
      params.set('limit', String(pageSize))
      if (cookTime.value === 'under_15') params.set('maxMinutes', '15')
      else if (cookTime.value === 'under_30') params.set('maxMinutes', '30')
      if (complexity.value !== 'any') params.set('complexity', complexity.value)
      if (heatLevel.value !== 'any') params.set('heatLevel', heatLevel.value)
      params.set('includeSometimes', String(hasProfile.value ? includeSometimes.value : true))
      const data = await apiFetch<{
        results: {
          id: string
          title: string
          image?: string
          minutes?: number | null
          complexity?: Exclude<Complexity, 'any'>
          heatLevel?: HeatLevel
          matchStatus?: SensoryMatch | 'unsafe'
          profileWarnings?: string[]
        }[]
      }>(`/api/recipes/search?${params.toString()}`, { headers: biteBudUserIdHeader() })
      results.value = data.results.map((r) => ({
        id: r.id,
        mealDbId: r.id,
        title: r.title,
        image: r.image,
        minutes: r.minutes ?? undefined,
        complexity: r.complexity,
        heatLevel: r.heatLevel,
        matchStatus: r.matchStatus ?? 'safe',
        profileWarnings: r.profileWarnings ?? [],
        source: 'themealdb' as const,
        tags: [],
      }))
    } else {
      const text = query.value.trim()
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
    const card = results.value.find((r) => r.id === id)
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

function difficultyLabel(c?: Exclude<Complexity, 'any'>): string {
  if (c === 'low') return 'Easy'
  if (c === 'medium') return 'Medium'
  return '—'
}

function cornerBadges(c: BrowseCard): string[] {
  const out: string[] = []
  if (c.heatLevel === 'none') out.push('QUIET')
  else if (c.heatLevel === 'low') out.push('MILD')
  if (out.length < 2 && (c.tags?.length ?? 0) > 0) {
    out.push(String(c.tags![0]).toUpperCase().slice(0, 12))
  }
  return out.slice(0, 2)
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

function passesCx(c?: Exclude<Complexity, 'any'>): boolean {
  const cx = appliedComplexity.value
  if (!cx.length) return true
  if (cx.includes('beginner') && c === 'low') return true
  if (cx.includes('intermediate') && c === 'medium') return true
  return false
}

const filteredCards = computed(() => {
  return results.value.filter((c) => {
    if (!passesPrep(c.minutes)) return false
    if (!passesCx(c.complexity)) return false
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
    browseSkip.value = Math.max(0, browseSkip.value + delta * pageSize)
    void search()
  }
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
      </div>
    </div>

    <header class="page-hero">
      <h1 class="page-title">Find or add a recipe</h1>
      <p class="page-lede">
        A sensory-friendly way to cook—clear steps, gentle layout, and optional profile-aware picks.
      </p>
      <ul class="page-hero-tabs" aria-label="What each tab is for">
        <li>
          <strong>Browse library</strong>
          — Search the public catalog by dish, ingredient, or texture. Open any card to cook.
        </li>
        <li>
          <strong>Paste a recipe</strong>
          — Paste full text from a site or note. We turn it into ingredients, a roadmap, and a visual flow.
        </li>
        <li>
          <strong>Your recipes</strong>
          — Dishes you have already opened in BiteBud. Search here to find them again. Available when you link a sensory profile.
        </li>
      </ul>
    </header>

    <div class="layout" :class="{ 'layout--no-filters': !showFiltersSidebar }">
      <aside v-if="showFiltersSidebar" class="filters" aria-label="Filter recipes">
        <div class="filters-head">
          <div class="filters-title">Filters</div>
        </div>

        <fieldset v-if="hasProfile" class="filter-group filter-group--profile-list">
          <legend class="k">Matches your profile</legend>
          <p id="profile-list-help" class="filter-help">
            We compare catalog ingredients to your saved foods, dietary choices, and cultural preferences (best
            effort—not medical advice).
          </p>
          <button
            type="button"
            class="pill pill--stacked"
            :class="{ on: !includeSometimes }"
            :disabled="busy"
            :aria-pressed="!includeSometimes"
            aria-describedby="profile-list-help profile-strict-desc"
            @click="setIncludeSometimes(false)"
          >
            <span class="pill-ico" aria-hidden="true">✓</span>
            <span class="pill-text">
              <span class="pill-title">Only show likely OK recipes</span>
              <span id="profile-strict-desc" class="pill-sub"
                >Hides dishes that may include foods you avoid, your “unsafe” items, or ingredients that clash with your
                dietary or cultural settings.</span
              >
            </span>
          </button>
          <button
            type="button"
            class="pill pill--stacked"
            :class="{ on: includeSometimes }"
            :disabled="busy"
            :aria-pressed="includeSometimes"
            aria-describedby="profile-list-help profile-full-desc"
            @click="setIncludeSometimes(true)"
          >
            <span class="pill-ico" aria-hidden="true">＋</span>
            <span class="pill-text">
              <span class="pill-title">Show all results; flag conflicts</span>
              <span id="profile-full-desc" class="pill-sub"
                >Keeps every match visible and adds warnings when a recipe may not fit your profile.</span
              >
            </span>
          </button>
          <details v-if="hasDietaryOrCultural" class="filter-details">
            <summary>What do we check?</summary>
            <p class="filter-details-p">
              Unsafe and “unsure” foods from your list, plus your dietary and cultural selections (for example No Pork
              or Shellfish-Free), matched against ingredient names.
            </p>
          </details>
        </fieldset>
        <div v-else class="profile profile-note" role="note">
          Set up your sensory profile to enable safety filters.
        </div>

        <div class="divider" aria-hidden="true" />

        <div class="filter-group">
          <div class="k">Preparation time</div>
          <label v-for="opt in (['under30', '30to60', 'over60'] as const)" :key="opt" class="check-row">
            <input
              type="checkbox"
              :checked="pendingPrep.includes(opt)"
              @change="togglePendingPrep(opt)"
            />
            <span>{{
              opt === 'under30' ? 'Under 30 minutes' : opt === '30to60' ? '30 to 60 minutes' : 'More than 1 hour'
            }}</span>
          </label>
        </div>

        <div class="divider" aria-hidden="true" />

        <div class="filter-group">
          <div class="k">Complexity</div>
          <label class="check-row">
            <input
              type="checkbox"
              :checked="pendingComplexity.includes('beginner')"
              @change="togglePendingCx('beginner')"
            />
            <span>Beginner (1–2 steps)</span>
          </label>
          <label class="check-row">
            <input
              type="checkbox"
              :checked="pendingComplexity.includes('intermediate')"
              @change="togglePendingCx('intermediate')"
            />
            <span>Intermediate (3–5 steps)</span>
          </label>
        </div>

        <div class="divider" aria-hidden="true" />

        <div class="filter-group">
          <div class="k">Heat level</div>
          <div class="row">
            <button type="button" class="chip" :class="{ on: heatLevel === 'none' }" :disabled="busy" @click="heatLevel = 'none'">
              No heat
            </button>
            <button type="button" class="chip" :class="{ on: heatLevel === 'low' }" :disabled="busy" @click="heatLevel = 'low'">
              Low heat
            </button>
            <button type="button" class="chip" :class="{ on: heatLevel === 'medium' }" :disabled="busy" @click="heatLevel = 'medium'">
              Medium
            </button>
          </div>
          <button type="button" class="chip chip-any" :class="{ on: heatLevel === 'any' }" :disabled="busy" @click="heatLevel = 'any'">
            Any
          </button>
        </div>

        <button type="button" class="apply-btn" :disabled="busy" @click="applySidebarFilters">
          {{ filterCount ? `Apply ${filterCount} filters` : 'Apply filters' }}
        </button>

        <div v-if="!profileLoading && hasProfile && profile" class="profile" role="status">
          <div class="profile-k">Sensory profile</div>
          <div v-if="profile.safeFoods.length" class="profile-v">Safe: {{ profile.safeFoods.slice(0, 4).join(', ') }}</div>
          <div v-else class="profile-v">Set preferences to refine safety.</div>
        </div>
      </aside>

      <section class="main">
        <div class="tabs" role="tablist" aria-label="Browse mode">
          <button type="button" class="tab" :class="{ on: activeTab === 'explore' }" @click="setRouteTab('explore')">
            Browse library
          </button>
          <button type="button" class="tab" :class="{ on: activeTab === 'describe' }" @click="setRouteTab('describe')">
            Paste a recipe
          </button>
          <button
            type="button"
            class="tab"
            :class="{ on: activeTab === 'forYou' }"
            :disabled="!hasProfile"
            @click="setRouteTab('forYou')"
          >
            Your recipes
          </button>
        </div>
        <p v-if="!hasProfile" class="gentle-note">
          Set up your sensory profile to use the Your recipes tab.
        </p>
        <p v-if="activeTab === 'forYou' && hasProfile" class="tab-help" role="note">
          These are dishes you have already opened in BiteBud. Search by name to find one again.
        </p>
        <details v-if="hasProfile" class="tab-details">
          <summary>More about these tabs</summary>
          <ul class="tab-details-list">
            <li><strong>Browse library</strong> — The public catalog; filters on the left apply here and on Your recipes.</li>
            <li><strong>Paste a recipe</strong> — No catalog needed; paste ingredients and instructions together for best results.</li>
            <li><strong>Your recipes</strong> — Linked to your profile when you open a recipe here. Newest first.</li>
          </ul>
        </details>

        <div class="toolbar">
          <div class="toolbar-search" :class="{ 'toolbar-search--paste': activeTab === 'describe' }">
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
              @keydown.enter="search"
            />
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
          </div>
          <div class="toolbar-rest">
            <div class="count" aria-live="polite">{{ matchCountLabel }}</div>
          </div>
        </div>

        <PasteRecipeGuide v-if="activeTab === 'describe'" />

        <template v-else>
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
                <div class="img-badges">
                  <span v-for="b in cornerBadges(c)" :key="b" class="img-badge">{{ b }}</span>
                </div>
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
                  <span class="meta-item">
                    <span class="dot" aria-hidden="true">✦</span>
                    {{ difficultyLabel(c.complexity) }}
                  </span>
                </div>
                <div class="badges">
                  <span v-for="t in (c.tags ?? []).slice(0, 4)" :key="t" class="badge">{{ t }}</span>
                </div>
                <div
                  v-if="hasProfile && (activeTab === 'explore' || activeTab === 'forYou') && c.matchStatus !== 'safe'"
                  class="profile-warn"
                  :class="{ 'profile-warn--unsafe': c.matchStatus === 'unsafe' }"
                  role="status"
                >
                  <span class="profile-warn-title">Profile check</span>
                  <p v-if="c.matchStatus === 'unsafe'" class="profile-warn-text">
                    May not fit your profile
                    <template v-if="(c.profileWarnings?.length ?? 0) > 0"
                      >— {{ (c.profileWarnings ?? []).slice(0, 4).join(' · ') }}</template
                    >
                  </p>
                  <p v-else class="profile-warn-text profile-warn-text--amber">
                    Contains foods marked “sometimes” for you—review before cooking.
                    <template v-if="(c.profileWarnings?.length ?? 0) > 0"
                      >— {{ (c.profileWarnings ?? []).slice(0, 4).join(' · ') }}</template
                    >
                  </p>
                </div>
                <div
                  v-else-if="hasProfile && activeTab === 'forYou' && c.matchStatus === 'safe'"
                  class="match match--ok"
                >
                  <span class="check" aria-hidden="true">✓</span>
                  <span>No profile conflicts detected in this recipe (still verify ingredients yourself).</span>
                </div>
                <div class="card-actions">
                  <button type="button" class="btn-view" :disabled="busy" @click="importMealDb(c.id)">View recipe</button>
                </div>
              </div>
            </article>

            <div v-if="!filteredCards.length" class="empty">
              No recipes match your current filters.
            </div>
          </div>
        </template>

        <nav v-if="activeTab !== 'describe' && filteredCards.length" class="pager" aria-label="Pagination">
          <button type="button" class="pager-btn" :disabled="busy || (catalogPage === 0 && browseSkip === 0)" @click="goPage(-1)">
            ←
          </button>
          <span class="pager-num">{{ activeTab === 'explore' ? catalogPage + 1 : Math.floor(browseSkip / pageSize) + 1 }}</span>
          <button type="button" class="pager-btn" :disabled="busy || filteredCards.length < pageSize" @click="goPage(1)">
            →
          </button>
        </nav>

        <p v-if="err" class="err" role="alert">{{ err }}</p>
      </section>
    </div>
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
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 1.5rem;
  align-items: start;
}
.layout--no-filters {
  grid-template-columns: 1fr;
}

.filters {
  position: sticky;
  top: 5.2rem;
  background: var(--bb-surface-lowest);
  border-radius: 20px;
  padding: 1.15rem;
  box-shadow: 0 14px 40px rgba(26, 28, 25, 0.06);
  border: 1px solid color-mix(in srgb, var(--bb-primary) 8%, transparent);
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
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex: 1 1 auto;
  min-width: min(100%, 32rem);
}
.toolbar-search--paste {
  align-items: flex-start;
}
.toolbar-search--paste .search-ico {
  margin-top: 0.35rem;
}
.toolbar-rest {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
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
  font-size: 1.08rem;
  line-height: 1.4;
  color: var(--bb-text);
  padding: 0.4rem 0;
}
.search-input--paste {
  min-height: 52px;
  max-height: 320px;
  overflow-y: auto;
  resize: vertical;
  field-sizing: content;
  padding: 0.45rem 0;
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

.count {
  font-family: var(--bb-font-label);
  font-weight: 800;
  font-size: 0.8rem;
  color: var(--bb-muted);
  letter-spacing: 0.04em;
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
  .layout {
    grid-template-columns: 1fr;
  }
  .filters {
    position: relative;
    top: 0;
  }
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 640px) {
  .grid {
    grid-template-columns: 1fr;
  }
  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
