import { apiFetch } from './api'
import { biteBudUserIdHeader } from '../composables/useUserId'

/** Format `date` as a `YYYY-MM-DD` calendar string in the local timezone. */
export function localCalendarYmd(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export type MotivationSummary = {
  currentStreak: number
  longestStreak: number
  showStartFresh: boolean
  hasActivity: boolean
}

/** Fetch the current motivation summary (streak counts + comeback toast hint) for the active user. */
export async function fetchMotivationSummary(): Promise<MotivationSummary> {
  return apiFetch<MotivationSummary>('/api/motivation/summary', {
    headers: biteBudUserIdHeader(),
  })
}

export type RecordMotivationResponse = {
  currentStreak: number
  longestStreak: number
  duplicate: boolean
  toastKey: string | null
}

/** Record an eligible motivation activity (recipe completion or restaurant review) and return new streak info. */
export async function recordMotivationActivity(body: {
  type: 'recipe_completed' | 'restaurant_review_submitted'
  localDate: string
  recipeId?: string
  placeId?: string
}): Promise<RecordMotivationResponse> {
  return apiFetch<RecordMotivationResponse>('/api/motivation/record', {
    method: 'POST',
    headers: { ...biteBudUserIdHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export type MotivationProgressPayload = {
  eligibleTotal: number
  currentStreak: number
  longestStreak: number
  totalActiveDays: number
  activeDaysThisMonth: number
  daysInMonth: number
  calendarYear: number
  calendarMonth: number
  calendarMonthDays: Array<{ date: string; count: number }>
  breakdown: { recipe_completed: number; restaurant_review_submitted: number }
}

/** Fetch the motivation progress payload (calendar + streak + breakdown) for the active user. */
export async function fetchMotivationProgress(opts?: {
  year?: number
  month?: number
}): Promise<MotivationProgressPayload> {
  const queryParams = new URLSearchParams()
  if (opts?.year != null) queryParams.set('year', String(opts.year))
  if (opts?.month != null) queryParams.set('month', String(opts.month))
  const suffix = queryParams.toString() ? `?${queryParams.toString()}` : ''
  return apiFetch<MotivationProgressPayload>(`/api/motivation/progress${suffix}`, {
    headers: biteBudUserIdHeader(),
  })
}

export type MotivationInsightsPayload = {
  ok: boolean
  recordsAnalyzed: { recipes: number; reviews: number; total: number }
  bestDay?: string
  cookingCard?: { title: string; body: string }
  diningCard?: { title: string; body: string }
}

/** Fetch the motivation insights cards (cooking + dining) for the active user. */
export async function fetchMotivationInsights(): Promise<MotivationInsightsPayload> {
  return apiFetch<MotivationInsightsPayload>('/api/motivation/insights', {
    headers: biteBudUserIdHeader(),
  })
}
