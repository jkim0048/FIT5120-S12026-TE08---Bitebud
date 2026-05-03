<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  createRestaurantFromNominatim,
  searchRestaurants,
  suggestRestaurantLocations,
  type LocationSuggestion,
  type RestaurantSearchResult,
} from '../lib/restaurantsApi'
import L from 'leaflet'
import { LMap, LCircleMarker, LPopup, LTooltip } from '@vue-leaflet/vue-leaflet'
import 'maplibre-gl/dist/maplibre-gl.css'
import '@maplibre/maplibre-gl-leaflet'
import 'leaflet/dist/leaflet.css'

const GRAYSCALE_BASEMAP_STYLE_URL = 'https://tiles.versatiles.org/assets/styles/graybeard/style.json'

const comfortLegendColors = {
  great: '#4d585f',
  good: '#7a7a7a',
  mixed: '#b0b0b0',
} as const

const route = useRoute()
const router = useRouter()
const fallbackSuburb = ref('')
/** When set, area search uses this token (suburb/postcode) even if the input shows a longer formatted label. */
const areaSuburbForApi = ref<string | null>(null)
const loading = ref(false)
const error = ref('')
const areaContext = ref<string | null>(null)
const results = ref<RestaurantSearchResult[]>([])
const warningText = ref('')
const locationDistanceLabel = ref('No distance context yet')
const modeLabel = ref('Search not started')
const sourceSummary = ref('Reviewed 0 · Nearby 0')
const showReviewedSection = ref(false)
const showMapSection = ref(false)

const recommendedIds = ref<string[]>([])
const activeMapId = ref<string | null>(null)
const mapZoom = ref(13)
const mapEl = ref<InstanceType<typeof LMap> | null>(null)
let grayscaleBasemap: L.MaplibreGL | null = null

const maxResults = ref<number>(15)

const suburbForRequest = computed(() => (areaSuburbForApi.value?.trim() || fallbackSuburb.value.trim()))

const locationSuggestions = ref<LocationSuggestion[]>([])
const locationSuggestOpen = ref(false)
const locationSuggestLoading = ref(false)
const locationSuggestActiveIndex = ref<number>(-1)
let locationSuggestTimer: ReturnType<typeof setTimeout> | undefined
const locationInvalid = ref(false)
const locationHint = ref('')

function normalizeLocationQuery(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  // If the input includes our formatted label "Suburb · STATE · POSTCODE", validate/search using only the first segment.
  return trimmed.split('·')[0]?.trim() ?? trimmed
}

const filteredResults = computed(() => {
  const limit = Math.min(30, Math.max(3, Number(maxResults.value) || 15))
  return results.value
    .slice(0, limit)
})

const currentPage = ref(1)
const pageSize = computed(() => Math.min(30, Math.max(3, Number(maxResults.value) || 15)))
const totalPages = computed(() => Math.max(1, Math.ceil(filteredResults.value.length / pageSize.value)))
const pagedResults = computed(() => {
  const size = pageSize.value
  const start = (currentPage.value - 1) * size
  return filteredResults.value.slice(start, start + size)
})

watch(
  () => [pageSize.value, filteredResults.value.length],
  () => {
    currentPage.value = Math.min(Math.max(1, currentPage.value), totalPages.value)
    if (currentPage.value > totalPages.value) currentPage.value = 1
  },
)

const reviewedResults = computed(() => pagedResults.value.filter((r) => r.source === 'bitebud' && r.reviewCount > 0))
const freshResults = computed(() =>
  pagedResults.value.filter((r) => r.source === 'nominatim' || (r.source === 'bitebud' && r.reviewCount === 0)),
)
const hasAnyResult = computed(() => reviewedResults.value.length + freshResults.value.length > 0)

const closestDistanceText = computed(() => {
  const distances = pagedResults.value
    .map((r) => r.distanceKm)
    .filter((d): d is number => typeof d === 'number')
    .sort((a, b) => a - b)
  if (!distances.length) return 'Distance unavailable'
  return `${distances[0].toFixed(1)} km to closest option`
})

const mapPoints = computed(() =>
  pagedResults.value
    .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
    .slice(0, Math.min(30, Math.max(3, Number(maxResults.value) || 15))),
)

const mapCenter = computed<[number, number]>(() => {
  if (!mapPoints.value.length) return [-37.8136, 144.9631]
  const active = mapPoints.value.find((r) => r.id === activeMapId.value)
  const chosen = active ?? mapPoints.value[0]
  return [chosen.latitude, chosen.longitude]
})

function ensureGrayscaleBasemap(leafletMap: L.Map): void {
  if (grayscaleBasemap) return
  grayscaleBasemap = L.maplibreGL({
    style: GRAYSCALE_BASEMAP_STYLE_URL,
    attributionControl: {
      customAttribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · VersaTiles Graybeard',
    },
  }).addTo(leafletMap)
}

async function syncMapAfterReveal() {
  if (!showMapSection.value) return
  await nextTick()
  const leafletMap = (mapEl.value as any)?.leafletObject as L.Map | undefined
  if (!leafletMap) return
  ensureGrayscaleBasemap(leafletMap)
  // If a Leaflet map is mounted while its container is hidden (or animated),
  // it often renders at the wrong size until we invalidate.
  leafletMap.invalidateSize?.()
  leafletMap.setView?.(mapCenter.value, mapZoom.value, { animate: false })
  // Run once more after the slide-in transition completes.
  setTimeout(() => {
    const m = (mapEl.value as any)?.leafletObject
    if (!m) return
    m.invalidateSize?.()
    m.setView?.(mapCenter.value, mapZoom.value, { animate: false })
  }, 240)
}

const summaryText = computed(() => {
  if (!results.value.length) return 'No places shown yet'
  return `Reviewed ${reviewedResults.value.length} · Nearby ${freshResults.value.length} · Showing ${mapPoints.value.length} on map`
})

watch(
  () => filteredResults.value.map((r) => r.id),
  (ids) => {
    if (!ids.length) {
      activeMapId.value = null
      return
    }
    if (activeMapId.value && ids.includes(activeMapId.value)) return
    activeMapId.value = ids[0] ?? null
  },
)

async function runSearch(params?: { lat?: number; lon?: number; suburb?: string; q?: string }) {
  loading.value = true
  error.value = ''
  locationInvalid.value = false
  locationHint.value = ''
  try {
    const queryText = (params?.q ?? (params?.suburb ? '' : fallbackSuburb.value)).trim()
    const data = await searchRestaurants({
      q: queryText || undefined,
      lat: params?.lat,
      lon: params?.lon,
      suburb: params?.suburb,
    })
    areaContext.value = data.areaContext
    if (data.areaContext) {
      fallbackSuburb.value = data.areaContext
      areaSuburbForApi.value = null
    }
    results.value = data.results
    currentPage.value = 1
    // Active marker will be synced to filteredResults via watcher.
    warningText.value = data.warnings?.[0]?.error ?? ''
    modeLabel.value = data.modeUsed === 'near_me' ? 'Using your location' : data.modeUsed === 'area' ? 'Using area fallback' : 'Using typed search'
    sourceSummary.value = `Reviewed ${data.sourceCounts?.bitebud ?? reviewedResults.value.length} · Nearby ${data.sourceCounts?.nominatim ?? freshResults.value.length}`
    const near = data.results.find((r) => r.distanceKm !== null)
    const distance = near?.distanceKm
    locationDistanceLabel.value = typeof distance === 'number' ? `${distance.toFixed(1)} km to nearby places` : 'No distance context yet'

    showEasiestThree()

    // Persist search + filters into the URL so returning Back restores state.
    const nextQuery: Record<string, string> = {}
    const limit = Math.min(30, Math.max(3, Number(maxResults.value) || 15))
    if (limit !== 15) nextQuery.max = String(limit)
    if (typeof params?.lat === 'number' && typeof params?.lon === 'number') {
      nextQuery.lat = String(params.lat)
      nextQuery.lon = String(params.lon)
    }
    if (params?.suburb) nextQuery.suburb = params.suburb
    else if (queryText) nextQuery.q = queryText
    void router.replace({ query: nextQuery })
    void syncMapAfterReveal()
    return data
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Search failed'
    return null
  } finally {
    loading.value = false
  }
}

async function useNearMe() {
  if (!navigator.geolocation) {
    error.value = 'Location unavailable. Enter suburb or postcode.'
    return
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      locationDistanceLabel.value = 'Using current location'
      void runSearch({
        lat: position.coords.latitude,
        lon: position.coords.longitude,
      })
    },
    () => {
      error.value = 'Location denied. Enter suburb or postcode to continue.'
    },
    { timeout: 8000 },
  )
}

async function openResult(result: RestaurantSearchResult) {
  const returnToPath = router.currentRoute.value.fullPath
  if (result.source === 'bitebud') {
    // If a place exists in BiteBud but has no reviews yet, treat it as "unrated" and go straight to rating.
    if (result.reviewCount === 0) {
      void router.push({
        name: 'restaurantRate',
        params: { id: result.id },
        query: { returnTo: 'restaurantSearch', returnToPath },
      })
      return
    }
    void router.push({ name: 'restaurantReviewDetail', params: { id: result.id }, query: { returnToPath } })
    return
  }
  if (!result.nominatimPlaceId) return
  loading.value = true
  error.value = ''
  try {
    const created = await createRestaurantFromNominatim({
      nominatimPlaceId: result.nominatimPlaceId,
      osmType: result.osmType ?? undefined,
      osmId: result.osmId ?? undefined,
      name: result.name,
      displayName: result.displayName,
      cuisine: result.cuisine ?? undefined,
      address: result.address ?? undefined,
      suburb: result.suburb ?? undefined,
      latitude: result.latitude,
      longitude: result.longitude,
      extratags: result.extratags,
    })
    void router.push({
      name: 'restaurantRate',
      params: { id: created.placeId },
      query: { returnTo: 'restaurantSearch', returnToPath },
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not open restaurant rating'
  } finally {
    loading.value = false
  }
}

function openReviewedAction(r: RestaurantSearchResult) {
  const returnToPath = router.currentRoute.value.fullPath
  void router.push({ name: 'restaurantReviewDetail', params: { id: r.id }, query: { returnToPath } })
}

function useAreaContext() {
  if (!fallbackSuburb.value.trim() && areaContext.value) fallbackSuburb.value = areaContext.value
  void runSearch({ suburb: suburbForRequest.value })
}

function suggestionPrimaryLine(s: LocationSuggestion): string {
  return s.suburb?.trim() || s.areaSearch?.trim() || s.displayName
}

function suggestionSecondaryLine(s: LocationSuggestion): string {
  return [s.state?.trim(), s.postcode?.trim()].filter(Boolean).join(' · ')
}

async function fetchLocationSuggestions() {
  const q = normalizeLocationQuery(fallbackSuburb.value)
  if (q.length < 2) {
    locationSuggestions.value = []
    locationSuggestOpen.value = false
    locationSuggestActiveIndex.value = -1
    locationInvalid.value = false
    locationHint.value = ''
    return
  }
  locationSuggestLoading.value = true
  try {
    const res = await suggestRestaurantLocations(q, 10)
    locationSuggestions.value = res.suggestions
    locationSuggestOpen.value = true
    locationSuggestActiveIndex.value = res.suggestions.length ? 0 : -1
  } catch {
    locationSuggestions.value = []
    locationSuggestOpen.value = true
    locationSuggestActiveIndex.value = -1
  } finally {
    locationSuggestLoading.value = false
  }
}

function onLocationInput() {
  areaSuburbForApi.value = null
  locationSuggestActiveIndex.value = -1
  locationInvalid.value = false
  locationHint.value = ''
  const q = normalizeLocationQuery(fallbackSuburb.value)
  locationSuggestOpen.value = q.length >= 2
  if (locationSuggestTimer) clearTimeout(locationSuggestTimer)
  locationSuggestTimer = setTimeout(() => {
    locationSuggestTimer = undefined
    void fetchLocationSuggestions()
  }, 320)
}

function onLocationFocus() {
  if (fallbackSuburb.value.trim().length >= 2) locationSuggestOpen.value = true
}

function onLocationBlur() {
  setTimeout(() => {
    locationSuggestOpen.value = false
  }, 200)
}

function moveLocationSuggest(delta: number) {
  const n = locationSuggestions.value.length
  if (!n) {
    locationSuggestActiveIndex.value = -1
    return
  }
  if (!locationSuggestOpen.value) locationSuggestOpen.value = true
  const next = (locationSuggestActiveIndex.value < 0 ? 0 : locationSuggestActiveIndex.value + delta + n) % n
  locationSuggestActiveIndex.value = next
}

function chooseActiveLocationSuggestion() {
  const idx = locationSuggestActiveIndex.value
  if (!locationSuggestOpen.value || idx < 0 || idx >= locationSuggestions.value.length) return false
  pickLocationSuggestion(locationSuggestions.value[idx]!)
  return true
}

function onLocationKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    moveLocationSuggest(1)
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    moveLocationSuggest(-1)
    return
  }
  if (e.key === 'Escape') {
    locationSuggestOpen.value = false
    return
  }
  if (e.key === 'Enter') {
    // Prefer selecting from the list when open, otherwise run the normal search.
    if (chooseActiveLocationSuggestion()) {
      e.preventDefault()
      return
    }
    e.preventDefault()
    void attemptAreaSearch()
    return
  }
}

function pickLocationSuggestion(s: LocationSuggestion) {
  areaSuburbForApi.value = s.areaSearch
  const meta = suggestionSecondaryLine(s)
  const primary = suggestionPrimaryLine(s)
  fallbackSuburb.value = meta ? `${primary} · ${meta}` : primary
  locationSuggestOpen.value = false
  locationSuggestions.value = []
  locationSuggestActiveIndex.value = -1
  locationInvalid.value = false
  locationHint.value = ''
  void runSearch({ lat: s.latitude, lon: s.longitude, suburb: s.areaSearch })
}

async function attemptAreaSearch() {
  const q = normalizeLocationQuery(suburbForRequest.value)
  locationInvalid.value = false
  locationHint.value = ''
  if (q.length < 2) {
    locationInvalid.value = true
    locationHint.value = 'Enter a valid suburb name or postcode.'
    locationSuggestOpen.value = true
    return
  }
  // Validate against suggestions, but only show the error if the search also returns 0 results.
  let suggestionCount: number | null = null
  locationSuggestLoading.value = true
  try {
    const res = await suggestRestaurantLocations(q, 8)
    locationSuggestions.value = res.suggestions
    locationSuggestOpen.value = true
    locationSuggestActiveIndex.value = res.suggestions.length ? 0 : -1
    suggestionCount = res.suggestions.length
  } catch {
    suggestionCount = null
  } finally {
    locationSuggestLoading.value = false
  }
  const data = await runSearch({ suburb: q })
  if (suggestionCount === 0 && (data?.results?.length ?? 0) === 0) {
    locationInvalid.value = true
    locationHint.value = 'No matching suburb/postcode found. Please enter a valid suburb name or postcode.'
  }
}

watch(
  () => showMapSection.value,
  () => {
    void syncMapAfterReveal()
  },
)

watch(
  () => mapCenter.value,
  () => {
    // Keep the map aligned with the latest search/selection when visible.
    if (!showMapSection.value) return
    void syncMapAfterReveal()
  },
)

function resultMeta(r: RestaurantSearchResult): string {
  const cuisine = r.cuisine ?? 'Restaurant'
  const reviews = `${r.reviewCount} reviews`
  const comfort = `${r.comfortBadge} ${r.overallRating.toFixed(1)}/5`
  const distance = r.distanceKm === null ? '' : ` · ${r.distanceKm.toFixed(1)} km`
  return `${cuisine} · ${reviews} · ${comfort}${distance}`
}

function comfortRank(badge: string): number {
  if (badge === 'Great match') return 0
  if (badge === 'Good match') return 1
  return 2
}

function showEasiestThree() {
  const ranked = [...pagedResults.value].sort((a, b) => {
    const badgeDelta = comfortRank(a.comfortBadge) - comfortRank(b.comfortBadge)
    if (badgeDelta !== 0) return badgeDelta
    const da = typeof a.distanceKm === 'number' ? a.distanceKm : Number.MAX_SAFE_INTEGER
    const db = typeof b.distanceKm === 'number' ? b.distanceKm : Number.MAX_SAFE_INTEGER
    return da - db
  })
  recommendedIds.value = ranked.slice(0, 3).map((r) => r.id)
  if (recommendedIds.value.length) activeMapId.value = recommendedIds.value[0]
}

function markerColor(result: RestaurantSearchResult): string {
  if (result.comfortBadge === 'Great match') return comfortLegendColors.great
  if (result.comfortBadge === 'Good match') return comfortLegendColors.good
  return comfortLegendColors.mixed
}

function selectFromMap(id: string) {
  activeMapId.value = id
  const el = document.getElementById(`restaurant-card-${id}`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

onMounted(() => {
  const q = typeof route.query.q === 'string' ? route.query.q : ''
  const suburb = typeof route.query.suburb === 'string' ? route.query.suburb : ''
  const lat = typeof route.query.lat === 'string' ? Number(route.query.lat) : undefined
  const lon = typeof route.query.lon === 'string' ? Number(route.query.lon) : undefined
  const max = typeof route.query.max === 'string' ? Number(route.query.max) : undefined

  if (typeof max === 'number' && Number.isFinite(max)) maxResults.value = Math.min(30, Math.max(3, max))

  if (suburb) {
    fallbackSuburb.value = suburb
    areaSuburbForApi.value = suburb
    void runSearch({ suburb, lat, lon })
    return
  }
  if (q) {
    fallbackSuburb.value = q
    void runSearch({ q })
    return
  }
  if (typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon)) {
    void runSearch({ lat, lon })
  }
})

onBeforeUnmount(() => {
  const leafletMap = (mapEl.value as any)?.leafletObject as L.Map | undefined
  if (leafletMap && grayscaleBasemap) {
    leafletMap.removeLayer(grayscaleBasemap)
    grayscaleBasemap = null
  }
})
</script>

<template>
  <section class="page">
    <header class="hero">
      <h1>Find a restaurant.</h1>
      <p class="hint hero-hint">Search by restaurant, address, or suburb.</p>
    </header>

    <div class="page-layout" :class="{ 'page-layout--map-open': showMapSection }">
      <main class="results-column">
        <section class="top-controls" aria-label="Search controls">
          <div class="top-controls__inner">
            <div class="fallback-row fallback-row--top">
              <div class="location-field">
                <input
                  v-model="fallbackSuburb"
                  type="text"
                  placeholder="Enter a suburb name or postcode"
                  autocomplete="off"
                  aria-autocomplete="list"
                  :aria-expanded="locationSuggestOpen"
                  :class="{ 'location-input--invalid': locationInvalid }"
                  :aria-activedescendant="
                    locationSuggestOpen && locationSuggestActiveIndex >= 0
                      ? `location-suggest-${locationSuggestActiveIndex}`
                      : undefined
                  "
                  @input="onLocationInput"
                  @focus="onLocationFocus"
                  @blur="onLocationBlur"
                  @keydown="onLocationKeydown"
                />
                <ul v-show="locationSuggestOpen && locationSuggestions.length" class="location-suggest" role="listbox">
                  <li
                    v-for="(s, idx) in locationSuggestions"
                    :key="s.id"
                    role="option"
                    class="location-suggest__item"
                    :id="`location-suggest-${idx}`"
                    :aria-selected="idx === locationSuggestActiveIndex"
                    :class="{ 'location-suggest__item--active': idx === locationSuggestActiveIndex }"
                    @mousedown.prevent="pickLocationSuggestion(s)"
                  >
                    <span class="location-suggest__primary">{{ suggestionPrimaryLine(s) }}</span>
                    <span v-if="suggestionSecondaryLine(s)" class="location-suggest__meta">{{ suggestionSecondaryLine(s) }}</span>
                  </li>
                </ul>
                <div
                  v-if="locationSuggestOpen && !locationSuggestLoading && locationSuggestions.length === 0 && fallbackSuburb.trim().length >= 2"
                  class="location-suggest-empty"
                >
                  No matching suburb/postcode found.
                </div>
                <p v-if="locationSuggestLoading" class="location-suggest__loading">Looking up locations…</p>
                <p v-if="locationInvalid && locationHint" class="location-hint">{{ locationHint }}</p>
              </div>
              <button class="bb-btn bb-btn--secondary bb-btn--compact" type="button" :disabled="loading" @click="attemptAreaSearch">
                Use area
              </button>
            </div>

            <div class="top-stack">
              <div class="map-toggle-row">
                <button type="button" class="bb-btn bb-btn--secondary bb-btn--compact map-toggle-btn" @click="showMapSection = !showMapSection">
                  {{ showMapSection ? 'Hide map' : 'Show map' }}
                </button>
              </div>
              <div class="near-row">
                <button class="bb-btn bb-btn--secondary bb-btn--compact" type="button" :disabled="loading" @click="useNearMe">Near me</button>
                <label class="filter near-row__filter">
                  <span>Show</span>
                  <select v-model.number="maxResults" :disabled="loading">
                    <option v-for="n in [3, 5, 8, 10, 12, 15, 20, 25, 30]" :key="n" :value="n">{{ n }}</option>
                  </select>
                </label>
              </div>
            </div>
          </div>
        </section>

        <div v-if="areaContext || warningText || error || loading" class="status-strip">
          <p v-if="warningText" class="warning">{{ warningText }}</p>
          <p v-if="error" class="error">{{ error }}</p>
          <p v-if="loading" class="hint status-loading">Loading shortlist…</p>
        </div>

        <section class="section-card section-card--tight">
          <div class="section-head">
            <h2>Reviewed in BiteBud</h2>
            <button
              type="button"
              class="bb-btn bb-btn--secondary bb-btn--compact"
              :aria-expanded="showReviewedSection"
              @click="showReviewedSection = !showReviewedSection"
            >
              {{
                showReviewedSection
                  ? 'Hide reviewed restaurants'
                  : `Show reviewed restaurants (${reviewedResults.length})`
              }}
            </button>
          </div>

          <div v-show="showReviewedSection">
            <p v-if="!loading && reviewedResults.length === 0" class="hint section-hint">No reviewed places for this search yet.</p>
            <ul class="result-list">
              <li
                v-for="r in reviewedResults"
                :id="`restaurant-card-${r.id}`"
                :key="r.id"
                class="result-card"
                :class="{ recommended: recommendedIds.includes(r.id), selected: activeMapId === r.id }"
                @click="selectFromMap(r.id)"
              >
                <div class="result-card__body">
                  <h3>{{ r.name }}</h3>
                  <p v-if="recommendedIds.includes(r.id)" class="reco">Recommended</p>
                  <p class="result-card__addr">{{ r.address ?? r.displayName }}</p>
                  <p class="meta">{{ resultMeta(r) }}</p>
                </div>
                <div class="result-card__actions">
                  <button class="bb-btn bb-btn--primary bb-btn--compact" type="button" :disabled="loading" @click.stop="openReviewedAction(r)">
                    See details
                  </button>
                </div>
              </li>
            </ul>
          </div>
        </section>

        <section class="section-card section-card--tight">
          <h2>Found nearby</h2>
          <p v-if="!loading && freshResults.length === 0" class="hint section-hint">No unrated matches in this list. Adjust area or filters.</p>
          <ul class="result-list">
            <li
              v-for="r in freshResults"
              :id="`restaurant-card-${r.id}`"
              :key="r.id"
              class="result-card"
              :class="{ recommended: recommendedIds.includes(r.id), selected: activeMapId === r.id }"
              @click="selectFromMap(r.id)"
            >
              <div class="result-card__body">
                <h3>{{ r.name }}</h3>
                <p v-if="recommendedIds.includes(r.id)" class="reco">Recommended</p>
                <p class="result-card__addr">{{ r.address ?? r.displayName }}</p>
                <p class="meta">No BiteBud sensory reviews yet</p>
              </div>
              <button
                class="bb-btn bb-btn--secondary bb-btn--compact"
                type="button"
                :disabled="loading || !r.canRateNow"
                @click.stop="openResult(r)"
              >
                {{ r.userHasReview ? 'Edit rating' : 'Rate this place' }}
              </button>
            </li>
          </ul>
        </section>

        <nav v-if="totalPages > 1" class="pagination" aria-label="Restaurant results pages">
          <button class="bb-btn bb-btn--secondary bb-btn--compact" type="button" :disabled="currentPage <= 1" @click="currentPage -= 1">
            Prev
          </button>
          <button
            v-for="p in totalPages"
            :key="p"
            class="bb-btn bb-btn--secondary bb-btn--compact"
            type="button"
            :aria-current="p === currentPage ? 'page' : undefined"
            :class="{ 'pagination__btn--active': p === currentPage }"
            @click="currentPage = p"
          >
            {{ p }}
          </button>
          <button
            class="bb-btn bb-btn--secondary bb-btn--compact"
            type="button"
            :disabled="currentPage >= totalPages"
            @click="currentPage += 1"
          >
            Next
          </button>
        </nav>

        <section v-if="!loading && !hasAnyResult" class="empty-state empty-state--tight">
          <h2>No places in this list</h2>
          <p class="hint">Try another suburb or use Near me.</p>
          <div class="empty-actions">
            <button class="bb-btn bb-btn--secondary bb-btn--compact" type="button" @click="useAreaContext">Use area context</button>
            <button class="bb-btn bb-btn--secondary bb-btn--compact" type="button" @click="runSearch()">Typed search</button>
          </div>
        </section>

        <!-- Footer actions removed (requested). -->
      </main>

      <aside class="controls-column">
        <div v-show="showMapSection" class="map-panel" aria-label="Restaurant map view">
          <div class="map-head">
            <p class="map-title">Map</p>
            <p class="map-sub">{{ modeLabel }} · {{ closestDistanceText }}</p>
            <p class="map-sub">{{ summaryText }}</p>
          </div>
          <div class="map-body">
            <div class="map-wrap">
              <LMap ref="mapEl" v-model:zoom="mapZoom" :center="mapCenter" class="restaurant-map">
                <LCircleMarker
                  v-for="point in mapPoints"
                  :key="point.id"
                  :lat-lng="[point.latitude, point.longitude]"
                  :radius="activeMapId === point.id ? 10 : 7"
                  :color="markerColor(point)"
                  :fill-color="markerColor(point)"
                  :fill-opacity="0.86"
                  :weight="2"
                  @click="selectFromMap(point.id)"
                >
                  <LTooltip :options="{ sticky: true }">
                    <div class="tip">
                      <strong>{{ point.name }}</strong>
                      <div class="tip-sub">{{ point.comfortBadge }} · {{ point.overallRating.toFixed(1) }}/5</div>
                    </div>
                  </LTooltip>
                  <LPopup>
                    <div class="popup">
                      <strong>{{ point.name }}</strong>
                      <p>{{ point.comfortBadge }} · {{ point.overallRating.toFixed(1) }}/5</p>
                      <p>
                        {{ point.reviewCount }} reviews{{ point.distanceKm !== null ? ` · ${point.distanceKm.toFixed(1)} km` : '' }}
                      </p>
                    </div>
                  </LPopup>
                </LCircleMarker>
              </LMap>
              <div v-if="!mapPoints.length" class="map-empty map-empty--overlay">
                <p>No pins yet — search an area.</p>
              </div>
            </div>
            <div class="legend legend--tight">
              <span><i class="dot" :style="{ background: comfortLegendColors.great }"></i> Great</span>
              <span><i class="dot" :style="{ background: comfortLegendColors.good }"></i> Good</span>
              <span><i class="dot" :style="{ background: comfortLegendColors.mixed }"></i> Mixed</span>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.page {
  max-width: 92rem;
  margin: 0 auto;
  padding: 0.5rem 0.75rem 0.85rem;
  display: grid;
  gap: 0.45rem;
}
.hero h1 {
  margin: 0;
  color: var(--bb-primary);
  font-family: var(--bb-font-headline);
  font-size: 1.5rem;
  line-height: 1.2;
}
.hero-hint {
  margin: 0.12rem 0 0;
  font-size: 0.9rem;
}
.hint {
  margin: 0;
  color: var(--bb-muted);
  font-size: 0.9rem;
}
.section-hint {
  margin: 0 0 0.35rem;
}
.context {
  margin: 0;
  font-size: 0.8rem;
  color: var(--bb-accent);
  font-weight: 700;
}
.warning {
  margin: 0;
  color: #b54708;
  font-size: 0.78rem;
  font-weight: 600;
}
.error {
  margin: 0;
  color: #b42318;
  font-weight: 600;
  font-size: 0.78rem;
}
.status-strip {
  display: grid;
  gap: 0.2rem;
  margin-bottom: 0.15rem;
}
.status-loading {
  margin: 0;
}

.page-layout {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  align-items: stretch;
}

.top-controls {
  display: grid;
  justify-items: center;
}
.top-controls__inner {
  width: min(56rem, 100%);
  display: grid;
  grid-template-columns: 1fr;
  grid-template-areas:
    "search"
    "near";
  gap: 0.6rem;
  align-items: flex-start;
  justify-content: center;
  padding: 0.25rem 0;
}
.fallback-row--top {
  width: min(36rem, 100%);
  grid-area: search;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: start;
}

.top-stack {
  width: min(36rem, 100%);
  display: grid;
  gap: 0.45rem;
  justify-self: start;
}
.map-toggle-row {
  width: 100%;
}
.map-toggle-btn {
  width: 100%;
  justify-content: center;
}
.near-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(10rem, 14rem);
  gap: 0.6rem;
  align-items: end;
}
.near-row .bb-btn {
  width: 100%;
  justify-content: center;
}
.near-row__filter {
  width: 100%;
}

@media (max-width: 520px) {
  .fallback-row--top {
    grid-template-columns: 1fr;
  }
  .top-stack {
    justify-self: center;
  }
  .near-row {
    grid-template-columns: 1fr;
  }
}

.results-column {
  min-width: 0;
  display: grid;
  gap: 0.65rem;
  order: 2;
}

.controls-column {
  min-width: 0;
  display: grid;
  gap: 0.6rem;
  order: 1;
}

.search-strip {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.35rem;
}
.filter-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
}
.filter {
  display: grid;
  gap: 0.15rem;
}
.filter span {
  font-size: 0.8rem;
  color: var(--bb-muted);
  font-weight: 600;
}
.filter select {
  border: 1px solid var(--bb-border);
  border-radius: 10px;
  padding: 0.55rem 0.6rem;
  font: inherit;
  font-size: 0.95rem;
  background: var(--bb-surface-lowest);
}
.fallback-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.4rem;
  align-items: start;
}
.location-field {
  position: relative;
  min-width: 0;
}

.location-input--invalid {
  border-color: #d92d20 !important;
  box-shadow: 0 0 0 3px rgba(217, 45, 32, 0.18);
}

.location-hint {
  margin: 0.25rem 0 0;
  font-size: 0.72rem;
  color: #b42318;
  transform: rotate(-1deg);
}
.location-suggest {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  margin: 0;
  padding: 0.2rem 0;
  list-style: none;
  max-height: 12rem;
  overflow: auto;
  border: 1px solid var(--bb-border);
  border-radius: 10px;
  background: var(--bb-surface-lowest);
  box-shadow: 0 8px 24px color-mix(in srgb, #101828 12%, transparent);
  z-index: 50;
}
.location-suggest__item {
  padding: 0.4rem 0.6rem;
  cursor: pointer;
  display: grid;
  gap: 0.08rem;
}
.location-suggest__item:hover,
.location-suggest__item:focus {
  background: color-mix(in srgb, var(--bb-primary) 10%, var(--bb-surface-lowest));
}
.location-suggest__item--active {
  background: color-mix(in srgb, var(--bb-primary) 12%, var(--bb-surface-lowest));
}
.location-suggest__primary {
  font-size: 0.82rem;
  font-weight: 650;
  color: var(--bb-primary);
}
.location-suggest__meta {
  font-size: 0.72rem;
  color: var(--bb-muted);
}
.location-suggest__loading {
  margin: 0.15rem 0 0;
  font-size: 0.72rem;
  color: var(--bb-muted);
}

.location-suggest-empty {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  padding: 0.55rem 0.65rem;
  border: 1px solid var(--bb-border);
  border-radius: 10px;
  background: var(--bb-surface-lowest);
  box-shadow: 0 8px 24px color-mix(in srgb, #101828 12%, transparent);
  z-index: 50;
  font-size: 0.78rem;
  color: var(--bb-muted);
}
input {
  border: 1px solid var(--bb-border);
  border-radius: 10px;
  padding: 0.6rem 0.7rem;
  font: inherit;
  font-size: 1rem;
  width: 100%;
  box-sizing: border-box;
}
.near-btn {
  min-width: 0;
}
.bb-btn--compact {
  padding: 0.55rem 0.75rem;
  font-size: 0.9rem;
  border-radius: 10px;
}
.bb-btn--tiny {
  padding: 0.45rem 0.6rem;
  font-size: 0.82rem;
}

.map-panel {
  border: 1px solid var(--bb-border);
  background: linear-gradient(180deg, var(--bb-surface-low), var(--bb-surface-high));
  border-radius: 12px;
  padding: 0.65rem;
  display: grid;
  gap: 0.45rem;
}
.map-wrap {
  position: relative;
}
.map-head {
  display: grid;
  gap: 0.08rem;
}
.map-head__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.map-title {
  margin: 0;
  font-family: var(--bb-font-headline);
  font-weight: 800;
  font-size: 1rem;
  color: var(--bb-primary);
}
.map-sub {
  margin: 0;
  font-size: 0.82rem;
  color: var(--bb-muted);
  line-height: 1.25;
}
.restaurant-map {
  height: 240px;
  min-height: 240px;
  width: 100%;
  border-radius: 10px;
  overflow: hidden;
  background: #eef2f6;
}
.map-empty {
  border: 1px dashed var(--bb-border);
  border-radius: 10px;
  display: grid;
  place-items: center;
  color: var(--bb-muted);
  font-size: 0.78rem;
  padding: 0.45rem;
  text-align: center;
}
.map-empty--overlay {
  position: absolute;
  inset: 0;
  margin: 0;
  background: color-mix(in srgb, var(--bb-surface-low) 72%, transparent);
  backdrop-filter: blur(1px);
  pointer-events: none;
}
.legend {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
  color: var(--bb-muted);
  font-size: 0.72rem;
}
.legend--tight {
  margin: 0;
}
.dot {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 999px;
  display: inline-block;
  margin-right: 0.2rem;
}
.popup p {
  margin: 0.15rem 0 0;
  font-size: 0.78rem;
}
.tip {
  display: grid;
  gap: 0.1rem;
}
.tip-sub {
  color: #6b7280;
  font-size: 0.74rem;
}

.section-card {
  border: 1px solid var(--bb-border);
  border-radius: 12px;
  padding: 0.5rem 0.55rem;
  background: var(--bb-surface-low);
  display: grid;
  gap: 0.35rem;
}
.section-card--tight {
  padding: 0.45rem 0.5rem;
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.section-head h2 {
  margin: 0;
}
.section-card h2 {
  margin: 0;
  font-size: 0.95rem;
  font-family: var(--bb-font-headline);
  color: var(--bb-primary);
}

.empty-state {
  border: 1px solid color-mix(in srgb, var(--bb-accent) 35%, var(--bb-border));
  border-radius: 12px;
  background: color-mix(in srgb, var(--bb-accent) 8%, var(--bb-surface-low));
  padding: 0.5rem 0.55rem;
}
.empty-state--tight {
  padding: 0.45rem 0.5rem;
}
.empty-state h2 {
  margin: 0;
  font-size: 0.82rem;
  font-family: var(--bb-font-headline);
  color: var(--bb-primary);
}
.empty-state p {
  margin: 0.25rem 0 0;
}
.empty-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
  margin-top: 0.45rem;
}

.result-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.55rem;
}
.result-card {
  border: 1px solid var(--bb-border);
  border-radius: 10px;
  background: var(--bb-surface-lowest);
  padding: 0.6rem 0.65rem;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.55rem;
  align-items: start;
}
.result-card__body {
  min-width: 0;
}
.result-card__actions {
  display: grid;
  gap: 0.35rem;
  justify-items: start;
}
.result-card h3 {
  margin: 0;
  font-size: 1rem;
  line-height: 1.25;
}
.result-card__addr {
  margin: 0.2rem 0 0;
  font-size: 0.88rem;
  line-height: 1.3;
  color: color-mix(in srgb, var(--bb-primary) 55%, var(--bb-muted));
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.result-card p {
  margin: 0.2rem 0 0;
}
.meta {
  color: var(--bb-muted);
  font-size: 0.84rem;
  line-height: 1.3;
}

.pagination {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  padding: 0.25rem 0 0.05rem;
}
.pagination__btn--active {
  border-color: color-mix(in srgb, var(--bb-primary) 35%, var(--bb-border));
  background: color-mix(in srgb, var(--bb-primary) 10%, var(--bb-surface-lowest));
  color: var(--bb-primary);
  font-weight: 700;
}
.recommended {
  border-color: color-mix(in srgb, var(--bb-accent) 45%, var(--bb-border));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--bb-accent) 16%, transparent);
}
.selected {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--bb-primary) 30%, transparent);
}
.reco {
  margin: 0.15rem 0 0;
  color: var(--bb-accent);
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}


@media (min-width: 700px) {
  .page {
    padding: 0.55rem 1rem 1rem;
  }
  .page-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(360px, 480px);
    gap: 0.85rem;
    align-items: start;
  }
  .results-column {
    grid-column: 1;
    order: unset;
    max-height: none;
    overflow: visible;
    padding-right: 0;
  }
  .controls-column {
    grid-column: 2;
    order: unset;
    position: sticky;
    top: 0.5rem;
    transition: transform 200ms ease, opacity 200ms ease, max-width 200ms ease;
    transform-origin: left;
  }
  .page-layout:not(.page-layout--map-open) .controls-column {
    opacity: 0;
    transform: scaleX(0);
    max-width: 0;
    pointer-events: none;
  }
  .page-layout--map-open .controls-column {
    opacity: 1;
    transform: scaleX(1);
    max-width: 480px;
    pointer-events: auto;
  }
  .restaurant-map {
    height: 320px;
    min-height: 320px;
  }
  .result-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.45rem;
  }
  .result-card {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto;
  }
  .result-card .bb-btn--compact {
    justify-self: start;
  }
}

@media (min-width: 1200px) {
  /* Keep two columns on large screens to reduce clutter. */
}
</style>
