import { apiFetch } from './api'

export type AboutPopulationTotal = { year: number; totalThousands: number }
export type AboutMealPrepAgeRow = {
  ageGroup: string
  estimate2015: number | null
  estimate2018: number
  estimate2022: number
}
export type AboutPopulationByAgeRow = {
  ageGroup: string
  estimate2015: number
  estimate2018: number
  estimate2022: number
  isTotalRow: boolean
}
export type AboutActivityRow = { activity: string; totalEstimateThousands: number }

export type AboutStatsPayload = {
  populationTotals: AboutPopulationTotal[]
  mealPrepAssistanceByAge: AboutMealPrepAgeRow[]
  populationByAge: AboutPopulationByAgeRow[]
  activityAssistance: AboutActivityRow[]
}

export function fetchAboutStats(): Promise<AboutStatsPayload> {
  return apiFetch<AboutStatsPayload>('/api/about/stats')
}
