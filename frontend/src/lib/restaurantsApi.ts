import { apiFetch } from './api'
import { getBiteBudUserId } from '../composables/useUserId'

export type RestaurantSearchResult = {
  source: 'bitebud' | 'nominatim'
  id: string
  name: string
  displayName: string
  cuisine: string | null
  address: string | null
  suburb: string | null
  latitude: number
  longitude: number
  reviewCount: number
  overallRating: number
  comfortBadge: string
  distanceKm: number | null
  nominatimPlaceId?: string | null
  canRateNow?: boolean
  userHasReview?: boolean
  extratags?: Record<string, string>
  osmType?: string | null
  osmId?: string | null
}

export type RestaurantSearchResponse = {
  areaContext: string | null
  results: RestaurantSearchResult[]
  warnings?: Array<{ error: string; code: string }>
  modeUsed?: 'typed' | 'near_me' | 'area'
  fallbackStageUsed?: 'none' | 'expanded' | 'relaxed'
  sourceCounts?: { bitebud: number; nominatim: number }
}

export type LocationSuggestion = {
  id: string
  suburb: string | null
  state: string | null
  postcode: string | null
  latitude: number
  longitude: number
  displayName: string
  areaSearch: string
}

export type RestaurantDetails = {
  place: {
    id: string
    name: string
    displayName: string
    cuisine: string | null
    address: string | null
    suburb: string | null
    latitude: number
    longitude: number
  }
  summary: {
    reviewCount: number
    userHasReview?: boolean
    overallRating: number
    comfortBadge: string
    noiseRating: number
    musicRating: number
    lightRating: number
    crowdsRating: number
    smellsRating: number
    recentBestMealBlocks: string[]
    recentBestTimesOfDay: string[]
    recentBestDaysOfWeek: string[]
  }
  isFavorite: boolean
  reviews?: Array<{
    id: string
    userId: string
    overallRating: number
    noiseRating: number
    musicRating: number
    lightRating: number
    crowdsRating: number
    smellsRating: number
    bestMealBlocks: unknown
    bestTimesOfDay: unknown
    bestDaysOfWeek: unknown
    createdAt: string
  }>
}

function withUserHeaders(init?: RequestInit): RequestInit {
  const uid = getBiteBudUserId()
  return {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(uid ? { 'X-User-Id': uid } : {}),
    },
  }
}

export async function searchRestaurants(params: {
  q?: string
  lat?: number
  lon?: number
  suburb?: string
}): Promise<RestaurantSearchResponse> {
  const search = new URLSearchParams()
  if (params.q) search.set('q', params.q)
  if (typeof params.lat === 'number') search.set('lat', String(params.lat))
  if (typeof params.lon === 'number') search.set('lon', String(params.lon))
  if (params.suburb) search.set('suburb', params.suburb)
  return apiFetch(`/api/restaurants/search?${search.toString()}`, withUserHeaders())
}

export async function suggestRestaurantLocations(
  q: string,
  limit = 8,
): Promise<{ suggestions: LocationSuggestion[]; warning?: { code: string; error: string } }> {
  const search = new URLSearchParams({ q, limit: String(limit) })
  return apiFetch(`/api/restaurants/location-suggest?${search.toString()}`, withUserHeaders())
}

export async function createRestaurantFromNominatim(payload: {
  nominatimPlaceId: string
  osmType?: string
  osmId?: string
  name: string
  displayName: string
  cuisine?: string
  address?: string
  suburb?: string
  latitude: number
  longitude: number
  extratags?: Record<string, string>
}): Promise<{ ok: boolean; placeId: string }> {
  return apiFetch('/api/restaurants/from-nominatim', withUserHeaders({ method: 'POST', body: JSON.stringify(payload) }))
}

export async function fetchRestaurantDetails(placeId: string): Promise<RestaurantDetails> {
  return apiFetch(`/api/restaurants/${placeId}/details`, withUserHeaders())
}

export async function submitRestaurantRating(
  placeId: string,
  payload: {
    overallRating: number
    noiseRating: number
    musicRating: number
    lightRating: number
    crowdsRating: number
    smellsRating: number
  },
): Promise<{ ok: boolean; reviewId: string }> {
  return apiFetch(
    `/api/restaurants/${placeId}/reviews/rating`,
    withUserHeaders({ method: 'POST', body: JSON.stringify(payload) }),
  )
}

export async function fetchRestaurantReviewRating(reviewId: string): Promise<{
  reviewId: string
  placeId: string
  overallRating: number
  noiseRating: number
  musicRating: number
  lightRating: number
  crowdsRating: number
  smellsRating: number
  bestMealBlocks: string[]
  bestTimesOfDay: string[]
  bestDaysOfWeek: string[]
}> {
  return apiFetch(`/api/restaurants/reviews/${reviewId}`, withUserHeaders())
}

export async function patchRestaurantBestTime(
  reviewId: string,
  payload: { bestMealBlocks: string[]; bestTimesOfDay: string[]; bestDaysOfWeek: string[] },
): Promise<{ ok: boolean; reviewId: string }> {
  return apiFetch(
    `/api/restaurants/reviews/${reviewId}/best-time`,
    withUserHeaders({ method: 'PATCH', body: JSON.stringify(payload) }),
  )
}

export async function favoriteRestaurant(placeId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/restaurants/${placeId}/favorite`, withUserHeaders({ method: 'POST' }))
}
