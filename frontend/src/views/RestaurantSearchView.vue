<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { ApiError } from '../lib/api'
import {
  createRestaurantFromNominatim,
  searchRestaurants,
  suggestRestaurantLocations,
  suggestRestaurantUnified,
  type LocationSuggestion,
  type PlaceSuggestion,
  type RestaurantSearchResult,
} from '../lib/restaurantsApi'
import L from 'leaflet'
import { LMap, LCircleMarker, LPopup, LTooltip } from '@vue-leaflet/vue-leaflet'
import 'leaflet/dist/leaflet.css'

/** Carto light raster tiles — loads much faster than a remote MapLibre style bundle. */
const RASTER_BASEMAP_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'

const comfortLegendColors = {
  great: '#22c55e',
  good: '#3b82f6',
  mixed: '#eab308',
} as const

/** Static prop for vue-leaflet; pan/zoom are driven only by syncMapAfterReveal so results updates are not overwritten. */
const INITIAL_MAP_CENTER = [-37.8136, 144.9631] as [number, number]

const route = useRoute()
const router = useRouter()
/** Single search bar text (suburb, postcode, or restaurant name). */
const searchQuery = ref('')
/** When set, area search uses this token even if the input shows a longer formatted label. */
const areaSuburbForApi = ref<string | null>(null)
const loading = ref(false)
/** True after any restaurant search has finished (success or error). Hides empty-state copy on first visit. */
const hasCompletedSearch = ref(false)
const error = ref('')
const areaContext = ref<string | null>(null)
const results = ref<RestaurantSearchResult[]>([])
const warningText = ref('')
const locationDistanceLabel = ref('No distance context yet')
const distanceAnchorLabel = ref('Distances from your selected search anchor')
const modeLabel = ref('Search not started')
const sourceSummary = ref('Reviewed 0 · Nearby 0')
const showNearbySection = ref(true)
const showMapSection = ref(false)
const currentDistanceLat = ref<number | null>(null)
const currentDistanceLon = ref<number | null>(null)

const recommendedIds = ref<string[]>([])
const activeMapId = ref<string | null>(null)
const mapZoom = ref(13)
const mapEl = ref<InstanceType<typeof LMap> | null>(null)
/** Last place the user aimed the search (suggestion pick, GPS, or first result) — pans the map even with zero pins. */
const searchFocusLat = ref<number | null>(null)
const searchFocusLon = ref<number | null>(null)
let baseRasterLayer: L.TileLayer | null = null

const maxResults = ref<number>(15)

const suburbForRequest = computed(
  () => areaSuburbForApi.value?.trim() || normalizeLocationQuery(searchQuery.value),
)

type UnifiedSuggestEntry =
  | { kind: 'area'; key: string; area: LocationSuggestion }
  | { kind: 'place'; key: string; place: PlaceSuggestion }

const areaSuggestions = ref<LocationSuggestion[]>([])
const placeSuggestions = ref<PlaceSuggestion[]>([])
const suggestOpen = ref(false)
const suggestLoading = ref(false)
const suggestActiveIndex = ref(-1)
let suggestTimer: ReturnType<typeof setTimeout> | undefined
let latestSuggestRequest = 0
const searchInvalid = ref(false)
const searchHint = ref('')

const unifiedSuggestEntries = computed((): UnifiedSuggestEntry[] => {
  const entries: UnifiedSuggestEntry[] = []
  for (const area of areaSuggestions.value) {
    entries.push({ kind: 'area', key: `area:${area.id}`, area })
  }
  for (const place of placeSuggestions.value) {
    entries.push({ kind: 'place', key: `place:${place.id}`, place })
  }
  return entries
})

const hasSuggestResults = computed(
  () => areaSuggestions.value.length > 0 || placeSuggestions.value.length > 0,
)

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

/** Full shortlist split by type — do not use a page slice here: API merges locals first then Nominatim, so paging hid all "nearby" rows on page 1. */
const reviewedResults = computed(() =>
  filteredResults.value.filter((restaurant) => restaurant.source === 'bitebud' && restaurant.reviewCount > 0),
)
const freshResults = computed(() =>
  filteredResults.value.filter(
    (restaurant) =>
      restaurant.source === 'nominatim' || (restaurant.source === 'bitebud' && restaurant.reviewCount === 0),
  ),
)
const hasAnyResult = computed(() => reviewedResults.value.length + freshResults.value.length > 0)
const showNearbyEffective = computed(() => reviewedResults.value.length === 0 || showNearbySection.value)

const closestDistanceText = computed(() => {
  const distances = filteredResults.value
    .map((restaurant) => restaurant.distanceKm)
    .filter((distance): distance is number => typeof distance === 'number')
    .sort((a, b) => a - b)
  if (!distances.length) return 'Distance unavailable'
  return `${distances[0].toFixed(1)} km to closest option`
})

const mapPoints = computed(() =>
  filteredResults.value.filter(
    (restaurant) => Number.isFinite(restaurant.latitude) && Number.isFinite(restaurant.longitude),
  ),
)

const mapCenter = computed<[number, number]>(() => {
  if (mapPoints.value.length) {
    const active = mapPoints.value.find((restaurant) => restaurant.id === activeMapId.value)
    const chosen = active ?? mapPoints.value[0]
    return [chosen.latitude, chosen.longitude]
  }
  if (
    searchFocusLat.value != null &&
    searchFocusLon.value != null &&
    Number.isFinite(searchFocusLat.value) &&
    Number.isFinite(searchFocusLon.value)
  ) {
    return [searchFocusLat.value, searchFocusLon.value]
  }
  return INITIAL_MAP_CENTER
})

function ensureRasterBasemap(leafletMap: L.Map): void {
  if (baseRasterLayer) return
  baseRasterLayer = L.tileLayer(RASTER_BASEMAP_URL, {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © CARTO',
    subdomains: 'abcd',
    maxZoom: 20,
  }).addTo(leafletMap)
}

/** Fit all pins or fall back to mapCenter (Melbourne when empty). */
function applySearchResultsToMap(leafletMap: L.Map): void {
  const validPoints = mapPoints.value.filter(
    (restaurant) => Number.isFinite(restaurant.latitude) && Number.isFinite(restaurant.longitude),
  )
  if (validPoints.length >= 2) {
    const bounds = L.latLngBounds(
      validPoints.map((restaurant) => [restaurant.latitude, restaurant.longitude] as [number, number]),
    )
    if (bounds.isValid()) {
      leafletMap.fitBounds(bounds, { padding: [44, 44], maxZoom: 16, animate: false })
      return
    }
  }
  if (validPoints.length === 1) {
    leafletMap.setView(
      [validPoints[0].latitude, validPoints[0].longitude],
      Math.min(16, Math.max(mapZoom.value, 13)),
      { animate: false },
    )
    return
  }
  if (
    searchFocusLat.value != null &&
    searchFocusLon.value != null &&
    Number.isFinite(searchFocusLat.value) &&
    Number.isFinite(searchFocusLon.value)
  ) {
    leafletMap.setView([searchFocusLat.value, searchFocusLon.value], Math.min(15, Math.max(mapZoom.value, 12)), {
      animate: false,
    })
    return
  }
  leafletMap.setView(mapCenter.value, mapZoom.value, { animate: false })
}

async function syncMapAfterReveal() {
  await nextTick()
  const leafletMap = (mapEl.value as any)?.leafletObject as L.Map | undefined
  if (!leafletMap) return
  ensureRasterBasemap(leafletMap)

  if (showMapSection.value) {
    leafletMap.invalidateSize?.()
  }
  applySearchResultsToMap(leafletMap)

  if (!showMapSection.value) return

  setTimeout(() => {
    const refreshedMap = (mapEl.value as any)?.leafletObject as L.Map | undefined
    if (!refreshedMap) return
    refreshedMap.invalidateSize?.()
    applySearchResultsToMap(refreshedMap)
  }, 80)
}

const summaryText = computed(() => {
  if (!hasCompletedSearch.value) return 'Search an area or use Near me to see places'
  if (!results.value.length) return 'No places shown yet'
  return `Reviewed ${reviewedResults.value.length} · Nearby ${freshResults.value.length} · ${mapPoints.value.length} pins on map`
})

watch(
  () => filteredResults.value.map((restaurant) => restaurant.id),
  (restaurantIds) => {
    if (!restaurantIds.length) {
      activeMapId.value = null
      return
    }
    if (activeMapId.value && restaurantIds.includes(activeMapId.value)) return
    activeMapId.value = restaurantIds[0] ?? null
  },
)

async function runSearch(params?: { lat?: number; lon?: number; suburb?: string; q?: string }) {
  loading.value = true
  error.value = ''
  searchInvalid.value = false
  searchHint.value = ''
  try {
    const queryText = (params?.q ?? '').trim()
    const data = await searchRestaurants({
      q: queryText || undefined,
      lat: params?.lat,
      lon: params?.lon,
      suburb: params?.suburb,
    })
    areaContext.value = data.areaContext
    if (data.areaContext && !queryText) {
      searchQuery.value = data.areaContext
      areaSuburbForApi.value = null
    }
    results.value = Array.isArray(data.results) ? data.results : []
    // Active marker will be synced to filteredResults via watcher.
    warningText.value =
      Array.isArray(data.warnings) && data.warnings.length
        ? data.warnings.map((warning) => warning.error).filter(Boolean).join(' · ')
        : ''
    modeLabel.value = data.modeUsed === 'near_me' ? 'Using your location' : data.modeUsed === 'area' ? 'Using area fallback' : 'Using typed search'
    sourceSummary.value = `Reviewed ${data.sourceCounts?.bitebud ?? reviewedResults.value.length} · Nearby ${data.sourceCounts?.nominatim ?? freshResults.value.length}`
    const nearestRestaurant = data.results.find((restaurant) => restaurant.distanceKm !== null)
    const distance = nearestRestaurant?.distanceKm
    locationDistanceLabel.value = typeof distance === 'number' ? `${distance.toFixed(1)} km to nearby places` : 'No distance context yet'
    if (data.modeUsed === 'near_me') {
      distanceAnchorLabel.value = 'Distances from your current location'
    } else if (params?.suburb?.trim()) {
      distanceAnchorLabel.value = `Distances from ${params.suburb.trim()}`
    } else if (data.areaContext?.trim()) {
      distanceAnchorLabel.value = `Distances from ${data.areaContext.trim()}`
    } else if (queryText) {
      distanceAnchorLabel.value = `Distances from search: ${queryText}`
    } else {
      distanceAnchorLabel.value = 'Distances from your selected search anchor'
    }

    showEasiestThree()

    if (typeof params?.lat === 'number' && typeof params?.lon === 'number' && Number.isFinite(params.lat) && Number.isFinite(params.lon)) {
      searchFocusLat.value = params.lat
      searchFocusLon.value = params.lon
    } else {
      const firstGeo = data.results.find(
        (restaurant) => Number.isFinite(restaurant.latitude) && Number.isFinite(restaurant.longitude),
      )
      if (firstGeo) {
        searchFocusLat.value = firstGeo.latitude
        searchFocusLon.value = firstGeo.longitude
      }
    }

    // Persist search + filters into the URL so returning Back restores state.
    const nextQuery: Record<string, string> = {}
    const limit = Math.min(30, Math.max(3, Number(maxResults.value) || 15))
    if (limit !== 15) nextQuery.max = String(limit)
    if (typeof params?.lat === 'number' && typeof params?.lon === 'number') {
      nextQuery.lat = String(params.lat)
      nextQuery.lon = String(params.lon)
    }
    if (params?.suburb) nextQuery.suburb = params.suburb
    else if (areaSuburbForApi.value?.trim()) nextQuery.suburb = areaSuburbForApi.value.trim()
    if (queryText) nextQuery.q = queryText
    void router.replace({ query: nextQuery })
    void syncMapAfterReveal()
    return data
  } catch (e) {
    results.value = []
    if (e instanceof ApiError) {
      if (e.status === 404) {
        const msg = e.message ?? ''
        const looksLikeFastifyMissingRoute =
          msg.includes('Route GET:') && msg.includes('not found')
        error.value = looksLikeFastifyMissingRoute
          ? 'Restaurant API on port 3001 is out of date (route missing). From the backend folder run npm run build, restart the server, or use npm run dev instead of npm start.'
          : 'Restaurant API returned 404. Check that the backend is running on port 3001 with a current build.'
      } else if (e.status === 502 || e.status === 503) {
        error.value =
          'Cannot reach the restaurant API. Start the backend (port 3001) and ensure the Vite dev proxy is enabled for /api.'
      } else {
        error.value = e.message || `Search failed (${e.status})`
      }
    } else {
      error.value = e instanceof Error ? e.message : 'Search failed'
    }
    return null
  } finally {
    loading.value = false
    hasCompletedSearch.value = true
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
      currentDistanceLat.value = position.coords.latitude
      currentDistanceLon.value = position.coords.longitude
      areaSuburbForApi.value = null
      searchFocusLat.value = position.coords.latitude
      searchFocusLon.value = position.coords.longitude
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
  if (!searchQuery.value.trim() && areaContext.value) searchQuery.value = areaContext.value
  void runAreaSearchFromText(suburbForRequest.value)
}

function suggestionPrimaryLine(s: LocationSuggestion): string {
  return s.suburb?.trim() || s.areaSearch?.trim() || s.displayName
}

function suggestionSecondaryLine(s: LocationSuggestion): string {
  return [s.state?.trim(), s.postcode?.trim()].filter(Boolean).join(' · ')
}

function normalizeAreaToken(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

const EARTH_RADIUS_KM = 6371

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const deltaLat = ((bLat - aLat) * Math.PI) / 180
  const deltaLon = ((bLon - aLon) * Math.PI) / 180
  const lat1 = (aLat * Math.PI) / 180
  const lat2 = (bLat * Math.PI) / 180
  const haversine =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2)
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(haversine))
}

function withDistanceFromCurrentLocation(items: RestaurantSearchResult[]): RestaurantSearchResult[] {
  if (currentDistanceLat.value == null || currentDistanceLon.value == null) return items
  if (!Number.isFinite(currentDistanceLat.value) || !Number.isFinite(currentDistanceLon.value)) return items
  return items.map((restaurant) => ({
    ...restaurant,
    distanceKm: Number(
      distanceKm(
        currentDistanceLat.value!,
        currentDistanceLon.value!,
        restaurant.latitude,
        restaurant.longitude,
      ).toFixed(1),
    ),
  }))
}

function refreshDistanceSummaryFromResults() {
  const nearestRestaurant = results.value.find((restaurant) => restaurant.distanceKm !== null)
  const distance = nearestRestaurant?.distanceKm
  locationDistanceLabel.value = typeof distance === 'number' ? `${distance.toFixed(1)} km to nearby places` : 'No distance context yet'
}

async function captureCurrentLocationForDistance(): Promise<boolean> {
  if (!navigator.geolocation) return false
  return new Promise<boolean>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        currentDistanceLat.value = position.coords.latitude
        currentDistanceLon.value = position.coords.longitude
        resolve(true)
      },
      () => resolve(false),
      { timeout: 6000, maximumAge: 60000 },
    )
  })
}

function scoreAreaSuggestion(query: string, suggestion: LocationSuggestion): number {
  const normalizedQuery = normalizeAreaToken(query)
  if (!normalizedQuery) return 0
  const suburb = normalizeAreaToken(suggestion.suburb ?? '')
  const area = normalizeAreaToken(suggestion.areaSearch ?? '')
  const display = normalizeAreaToken(suggestion.displayName ?? '')
  const postcode = normalizeAreaToken(suggestion.postcode ?? '')
  let score = 0
  if (suburb === normalizedQuery || area === normalizedQuery) score += 100
  if (suburb.startsWith(normalizedQuery) || area.startsWith(normalizedQuery)) score += 70
  if (suburb.includes(normalizedQuery) || area.includes(normalizedQuery)) score += 45
  if (display.includes(normalizedQuery)) score += 20
  if (postcode === normalizedQuery) score += 80
  return score
}

function pickBestSuggestionForArea(query: string, suggestions: LocationSuggestion[]): LocationSuggestion | null {
  if (!suggestions.length) return null
  const normalizedQuery = normalizeAreaToken(query)
  if (!normalizedQuery) return suggestions[0] ?? null

  const scored = suggestions
    .map((suggestion) => ({ suggestion, score: scoreAreaSuggestion(normalizedQuery, suggestion) }))
    .sort((a, b) => b.score - a.score)

  const top = scored[0]
  if (!top || top.score < 45) return null
  return top.suggestion
}

function formatAreaLabel(s: LocationSuggestion): string {
  const meta = suggestionSecondaryLine(s)
  const primary = suggestionPrimaryLine(s)
  return meta ? `${primary} · ${meta}` : primary
}

function searchLocationContext(): { lat?: number; lon?: number; suburb?: string } {
  const suburb = areaSuburbForApi.value?.trim() || areaContext.value?.trim() || undefined
  const lat = searchFocusLat.value ?? currentDistanceLat.value ?? undefined
  const lon = searchFocusLon.value ?? currentDistanceLon.value ?? undefined
  if (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon)
  ) {
    return { lat, lon, suburb }
  }
  if (suburb) return { suburb }
  return {}
}

async function fetchUnifiedSuggestions(): Promise<void> {
  const q = normalizeLocationQuery(searchQuery.value)
  if (q.length < 2) {
    areaSuggestions.value = []
    placeSuggestions.value = []
    suggestOpen.value = false
    suggestActiveIndex.value = -1
    return
  }
  const requestId = ++latestSuggestRequest
  suggestLoading.value = true
  try {
    const response = await suggestRestaurantUnified({
      q,
      limit: 8,
      ...searchLocationContext(),
    })
    if (requestId !== latestSuggestRequest) return
    areaSuggestions.value = response.areas
    placeSuggestions.value = response.places
    suggestOpen.value = true
    suggestActiveIndex.value = unifiedSuggestEntries.value.length ? 0 : -1
  } catch {
    if (requestId !== latestSuggestRequest) return
    areaSuggestions.value = []
    placeSuggestions.value = []
    suggestOpen.value = true
    suggestActiveIndex.value = -1
  } finally {
    if (requestId === latestSuggestRequest) suggestLoading.value = false
  }
}

function onSearchInput(): void {
  areaSuburbForApi.value = null
  suggestActiveIndex.value = -1
  searchInvalid.value = false
  searchHint.value = ''
  const q = searchQuery.value.trim()
  suggestOpen.value = q.length >= 2
  if (suggestTimer) clearTimeout(suggestTimer)
  suggestTimer = setTimeout(() => {
    suggestTimer = undefined
    void fetchUnifiedSuggestions()
  }, 250)
}

function onSearchFocus(): void {
  if (searchQuery.value.trim().length >= 2) suggestOpen.value = true
}

function onSearchBlur(): void {
  setTimeout(() => {
    suggestOpen.value = false
  }, 200)
}

function moveSuggest(delta: number): void {
  const n = unifiedSuggestEntries.value.length
  if (!n) {
    suggestActiveIndex.value = -1
    return
  }
  if (!suggestOpen.value) suggestOpen.value = true
  const next = (suggestActiveIndex.value < 0 ? 0 : suggestActiveIndex.value + delta + n) % n
  suggestActiveIndex.value = next
}

function chooseActiveSuggestion(): boolean {
  const entry = unifiedSuggestEntries.value[suggestActiveIndex.value]
  if (!suggestOpen.value || !entry) return false
  if (entry.kind === 'area') pickAreaSuggestion(entry.area)
  else pickPlaceSuggestion(entry.place)
  return true
}

function onSearchKeydown(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    moveSuggest(1)
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    moveSuggest(-1)
    return
  }
  if (e.key === 'Escape') {
    suggestOpen.value = false
    return
  }
  if (e.key === 'Enter') {
    if (chooseActiveSuggestion()) {
      e.preventDefault()
      return
    }
    e.preventDefault()
    void runUnifiedSearch()
  }
}

function pickAreaSuggestion(s: LocationSuggestion): void {
  areaSuburbForApi.value = s.areaSearch
  searchQuery.value = formatAreaLabel(s)
  suggestOpen.value = false
  areaSuggestions.value = []
  placeSuggestions.value = []
  suggestActiveIndex.value = -1
  searchInvalid.value = false
  searchHint.value = ''
  searchFocusLat.value = s.latitude
  searchFocusLon.value = s.longitude
  void runSearch({ lat: s.latitude, lon: s.longitude, suburb: s.areaSearch })
}

function pickPlaceSuggestion(s: PlaceSuggestion): void {
  searchQuery.value = s.name
  suggestOpen.value = false
  areaSuggestions.value = []
  placeSuggestions.value = []
  suggestActiveIndex.value = -1
  searchFocusLat.value = s.latitude
  searchFocusLon.value = s.longitude
  void runSearch({
    q: s.name,
    lat: s.latitude,
    lon: s.longitude,
    suburb: areaSuburbForApi.value?.trim() || areaContext.value?.trim() || undefined,
  })
}

async function runAreaSearchFromText(areaText: string, restaurantQ?: string): Promise<void> {
  const q = normalizeLocationQuery(areaText)
  searchInvalid.value = false
  searchHint.value = ''
  if (q.length < 2) {
    searchInvalid.value = true
    searchHint.value = 'Enter a valid suburb name or postcode.'
    return
  }
  suggestLoading.value = true
  try {
    const res = await suggestRestaurantLocations(q, 8)
    const anchor = pickBestSuggestionForArea(q, res.suggestions)
    const data = anchor
      ? await runSearch({
          lat: anchor.latitude,
          lon: anchor.longitude,
          suburb: anchor.areaSearch,
          ...(restaurantQ ? { q: restaurantQ } : {}),
        })
      : await runSearch({
          suburb: q,
          ...(restaurantQ ? { q: restaurantQ } : {}),
        })

    const gotCurrentLocation = await captureCurrentLocationForDistance()
    if (gotCurrentLocation) {
      results.value = withDistanceFromCurrentLocation(results.value)
      showEasiestThree()
      refreshDistanceSummaryFromResults()
      distanceAnchorLabel.value = 'Distances from your current location'
    }

    if (!res.suggestions.length && (data?.results?.length ?? 0) === 0) {
      searchInvalid.value = true
      searchHint.value = 'No matching suburb/postcode found. Try a restaurant name instead.'
    }
  } finally {
    suggestLoading.value = false
  }
}

async function runUnifiedSearch(): Promise<void> {
  const text = searchQuery.value.trim()
  searchInvalid.value = false
  searchHint.value = ''
  if (!text) {
    searchInvalid.value = true
    searchHint.value = 'Enter a suburb, postcode, or restaurant name.'
    return
  }

  const commaIdx = text.indexOf(',')
  if (commaIdx > 0) {
    const namePart = text.slice(0, commaIdx).trim()
    const areaPart = text.slice(commaIdx + 1).trim()
    if (namePart && areaPart) {
      await runAreaSearchFromText(areaPart, namePart)
      return
    }
  }

  const normalized = normalizeLocationQuery(text)
  try {
    const locRes = await suggestRestaurantLocations(normalized, 8)
    const anchor = pickBestSuggestionForArea(normalized, locRes.suggestions)
    if (anchor) {
      areaSuburbForApi.value = anchor.areaSearch
      searchQuery.value = formatAreaLabel(anchor)
      searchFocusLat.value = anchor.latitude
      searchFocusLon.value = anchor.longitude
      await runSearch({ lat: anchor.latitude, lon: anchor.longitude, suburb: anchor.areaSearch })
      return
    }
  } catch {
    /* fall through to restaurant name search */
  }

  await runSearch({ q: text })
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

watch(
  () =>
    `${mapPoints.value.map((point) => point.id).join(',')}|${searchFocusLat.value ?? ''}:${searchFocusLon.value ?? ''}`,
  () => {
    void syncMapAfterReveal()
  },
)

function resultMeta(restaurant: RestaurantSearchResult): string {
  const cuisine = restaurant.cuisine ?? 'Restaurant'
  const reviews = `${restaurant.reviewCount} reviews`
  const comfort = `${restaurant.comfortBadge} ${restaurant.overallRating.toFixed(1)}/5`
  const distance = restaurant.distanceKm === null ? '' : ` · ${restaurant.distanceKm.toFixed(1)} km`
  return `${cuisine} · ${reviews} · ${comfort}${distance}`
}

function freshResultMeta(restaurant: RestaurantSearchResult): string {
  const distance = restaurant.distanceKm === null ? '' : ` · ${restaurant.distanceKm.toFixed(1)} km`
  return `No BiteBud sensory reviews yet${distance}`
}

function comfortRank(badge: string): number {
  if (badge === 'Great match') return 0
  if (badge === 'Good match') return 1
  return 2
}

function showEasiestThree() {
  const ranked = [...filteredResults.value].sort((a, b) => {
    const badgeDelta = comfortRank(a.comfortBadge) - comfortRank(b.comfortBadge)
    if (badgeDelta !== 0) return badgeDelta
    const distanceA = typeof a.distanceKm === 'number' ? a.distanceKm : Number.MAX_SAFE_INTEGER
    const distanceB = typeof b.distanceKm === 'number' ? b.distanceKm : Number.MAX_SAFE_INTEGER
    return distanceA - distanceB
  })
  recommendedIds.value = ranked.slice(0, 3).map((restaurant) => restaurant.id)
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

  if (suburb && q) searchQuery.value = `${q}, ${suburb}`
  else if (suburb) searchQuery.value = suburb
  else if (q) searchQuery.value = q

  if (suburb) {
    areaSuburbForApi.value = suburb
    void runSearch({
      suburb,
      lat,
      lon,
      ...(q ? { q } : {}),
    })
    return
  }
  if (q) {
    void runSearch({ q, lat, lon })
    return
  }
  if (typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon)) {
    void runSearch({ lat, lon })
  }
})

onBeforeUnmount(() => {
  if (suggestTimer) clearTimeout(suggestTimer)
  const leafletMap = (mapEl.value as any)?.leafletObject as L.Map | undefined
  if (leafletMap && baseRasterLayer) {
    leafletMap.removeLayer(baseRasterLayer)
    baseRasterLayer = null
  }
})
</script>

<template>
  <section class="page">
    <p class="page-back">
      <RouterLink class="page-back-link" :to="{ name: 'cookingStart' }">Back to start</RouterLink>
    </p>
    <header class="hero">
      <h1>Find a restaurant.</h1>
      <p class="hint hero-hint">Search a suburb to see restaurants nearby, or type a restaurant name to find it.</p>
    </header>

    <div class="page-layout" :class="{ 'page-layout--map-open': showMapSection }">
      <main class="results-column">
        <section class="top-controls" aria-label="Search controls">
          <div class="top-controls__inner">
            <div class="fallback-row fallback-row--unified">
              <div class="location-field">
                <input
                  v-model="searchQuery"
                  type="text"
                  placeholder="Suburb, postcode, or restaurant name"
                  autocomplete="off"
                  aria-autocomplete="list"
                  :aria-expanded="suggestOpen"
                  :class="{ 'location-input--invalid': searchInvalid }"
                  :aria-activedescendant="
                    suggestOpen && suggestActiveIndex >= 0 ? `unified-suggest-${suggestActiveIndex}` : undefined
                  "
                  @input="onSearchInput"
                  @focus="onSearchFocus"
                  @blur="onSearchBlur"
                  @keydown="onSearchKeydown"
                />
                <ul
                  v-show="suggestOpen && (hasSuggestResults || suggestLoading)"
                  class="location-suggest location-suggest--unified"
                  role="listbox"
                >
                  <template v-if="areaSuggestions.length">
                    <li class="location-suggest__section" role="presentation">Areas</li>
                    <li
                      v-for="entry in unifiedSuggestEntries.filter((e) => e.kind === 'area')"
                      :key="entry.key"
                      role="option"
                      class="location-suggest__item"
                      :id="`unified-suggest-${unifiedSuggestEntries.indexOf(entry)}`"
                      :aria-selected="unifiedSuggestEntries.indexOf(entry) === suggestActiveIndex"
                      :class="{
                        'location-suggest__item--active':
                          unifiedSuggestEntries.indexOf(entry) === suggestActiveIndex,
                      }"
                      @mousedown.prevent="pickAreaSuggestion(entry.area)"
                    >
                      <span class="location-suggest__primary">{{ suggestionPrimaryLine(entry.area) }}</span>
                      <span v-if="suggestionSecondaryLine(entry.area)" class="location-suggest__meta">{{
                        suggestionSecondaryLine(entry.area)
                      }}</span>
                    </li>
                  </template>
                  <template v-if="placeSuggestions.length">
                    <li class="location-suggest__section" role="presentation">Restaurants</li>
                    <li
                      v-for="entry in unifiedSuggestEntries.filter((e) => e.kind === 'place')"
                      :key="entry.key"
                      role="option"
                      class="location-suggest__item"
                      :id="`unified-suggest-${unifiedSuggestEntries.indexOf(entry)}`"
                      :aria-selected="unifiedSuggestEntries.indexOf(entry) === suggestActiveIndex"
                      :class="{
                        'location-suggest__item--active':
                          unifiedSuggestEntries.indexOf(entry) === suggestActiveIndex,
                      }"
                      @mousedown.prevent="pickPlaceSuggestion(entry.place)"
                    >
                      <span class="location-suggest__primary">{{ entry.place.name }}</span>
                      <span v-if="entry.place.subtitle" class="location-suggest__meta">{{ entry.place.subtitle }}</span>
                    </li>
                  </template>
                </ul>
                <div
                  v-if="suggestOpen && !suggestLoading && !hasSuggestResults && searchQuery.trim().length >= 2"
                  class="location-suggest-empty"
                >
                  No matching areas or restaurants.
                </div>
                <p v-if="suggestLoading" class="location-suggest__loading">Searching…</p>
                <p v-if="searchInvalid && searchHint" class="location-hint">{{ searchHint }}</p>
              </div>
              <button
                class="bb-btn bb-btn--primary bb-btn--compact search-submit-btn"
                type="button"
                :disabled="loading"
                @click="runUnifiedSearch"
              >
                Search
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
          </div>

          <p v-if="!loading && hasCompletedSearch && reviewedResults.length === 0" class="hint section-hint">
            No reviewed places for this search yet.
          </p>
          <ul v-if="reviewedResults.length" class="result-list">
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
        </section>

        <section class="section-card section-card--tight">
          <div class="section-head">
            <h2>Found nearby</h2>
            <button
              v-if="reviewedResults.length > 0"
              type="button"
              class="bb-btn bb-btn--secondary bb-btn--compact"
              :aria-expanded="showNearbySection"
              @click="showNearbySection = !showNearbySection"
            >
              {{ showNearbySection ? 'Hide nearby results' : `Show nearby results (${freshResults.length})` }}
            </button>
          </div>

          <div v-show="showNearbyEffective">
            <p v-if="hasAnyResult" class="hint section-hint">{{ distanceAnchorLabel }}</p>
            <ul v-if="freshResults.length" class="result-list">
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
                  <p class="meta">{{ freshResultMeta(r) }}</p>
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
            <div
              v-else-if="!loading && hasCompletedSearch && !hasAnyResult"
              class="nearby-empty"
            >
              <p class="hint">Try another suburb, a restaurant name, or use Near me.</p>
              <div class="empty-actions">
                <button class="bb-btn bb-btn--secondary bb-btn--compact" type="button" @click="useAreaContext">Use area context</button>
              </div>
            </div>
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
              <LMap ref="mapEl" v-model:zoom="mapZoom" :center="INITIAL_MAP_CENTER" class="restaurant-map">
                <LCircleMarker
                  v-for="point in mapPoints"
                  :key="point.id"
                  :lat-lng="[point.latitude, point.longitude]"
                  :radius="activeMapId === point.id ? 12 : 9"
                  :color="markerColor(point)"
                  :fill-color="markerColor(point)"
                  :fill-opacity="0.92"
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
                <p>{{ searchFocusLat != null ? 'No pins in this view — try widening the area or another search.' : 'No pins yet — search an area.' }}</p>
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
.page-back {
  margin: 0 0 0.15rem;
}
.page-back-link {
  font-weight: 700;
  font-size: 0.95rem;
  color: var(--bb-accent);
  text-decoration: none;
}
.page-back-link:hover {
  text-decoration: underline;
}
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
.field-label {
  margin: 0;
  width: min(36rem, 100%);
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--bb-muted);
}
.fallback-row--unified {
  width: min(36rem, 100%);
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
}
.location-suggest__section {
  padding: 0.35rem 0.65rem 0.15rem;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--bb-muted);
  list-style: none;
}
.search-submit-btn {
  align-self: start;
  min-width: 5.5rem;
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
  .fallback-row--unified {
    grid-template-columns: 1fr;
  }
  .search-submit-btn {
    width: 100%;
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
