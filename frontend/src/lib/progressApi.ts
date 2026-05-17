import { apiFetch } from './api'
import { biteBudUserIdHeader } from '../composables/useUserId'

export type DayRatingBand = 'none' | 'high' | 'mixed' | 'low'

export type ProgressMilestoneStatus = 'earned' | 'almost' | 'locked'

export type ProgressDashboardPayload = {
  range: { from: string; to: string }
  comparisonRange: { from: string; to: string }
  deltaLabel: string
  stats: {
    recipesCooked: number
    diningReviews: number
    daysActive: number
  }
  statsDelta: {
    recipesCooked: number
    diningReviews: number
    daysActive: number
  }
  thresholds: {
    cooking: { have: number; need: number }
    dining: { have: number; need: number }
    progress: { have: number; need: number }
  }
  insightsUnlocked: boolean
  uiState: 'new' | 'active' | 'established'
  streak: { current: number; longest: number }
  calendar: Array<{
    date: string
    recipes: number
    reviews: number
    ratingBand: DayRatingBand
  }>
  milestones: Array<{
    id: string
    title: string
    description: string
    status: ProgressMilestoneStatus
    progress?: { have: number; need: number }
  }>
  ratingTrend: Array<{
    weekStart: string
    weekLabel: string
    averageRating: number | null
    completionCount: number
  }>
  ratingTrendSummary: string | null
}

export async function fetchProgressDashboard(fromIso: string, toIso: string): Promise<ProgressDashboardPayload> {
  const params = new URLSearchParams({ from: fromIso, to: toIso })
  return apiFetch<ProgressDashboardPayload>(`/api/me/progress?${params.toString()}`, {
    headers: biteBudUserIdHeader(),
  })
}
