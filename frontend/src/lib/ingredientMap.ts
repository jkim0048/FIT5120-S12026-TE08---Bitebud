import { apiFetch } from './api'

export type IngredientMapItem = {
  ingredientKey: string
  label: string
  emoji: string
  hint: string
}

/** Fetch the legacy ingredient → icon mapping (label, emoji fallback, hover hint). */
export async function fetchIngredientIconMap(): Promise<IngredientMapItem[]> {
  const response = await apiFetch<{ items: IngredientMapItem[] }>('/api/icons/ingredient-map')
  return response.items ?? []
}
