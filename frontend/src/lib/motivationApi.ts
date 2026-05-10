import { apiFetch } from './api'
import { biteBudUserIdHeader } from '../composables/useUserId'

export function localCalendarYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export type MotivationSummary = {
  currentStreak: number
  longestStreak: number
  showStartFresh: boolean
  hasActivity: boolean
}

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

export async function fetchMotivationProgress(opts?: {
  year?: number
  month?: number
}): Promise<MotivationProgressPayload> {
  const qs = new URLSearchParams()
  if (opts?.year != null) qs.set('year', String(opts.year))
  if (opts?.month != null) qs.set('month', String(opts.month))
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
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

export async function fetchMotivationInsights(): Promise<MotivationInsightsPayload> {
  return apiFetch<MotivationInsightsPayload>('/api/motivation/insights', {
    headers: biteBudUserIdHeader(),
  })
}
