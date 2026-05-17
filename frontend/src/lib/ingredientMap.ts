import { apiFetch } from './api'

export type IngredientMapItem = {
  ingredientKey: string
  label: string
  emoji: string
  hint: string
}

export async function fetchIngredientIconMap(): Promise<IngredientMapItem[]> {
  const res = await apiFetch<{ items: IngredientMapItem[] }>('/api/icons/ingredient-map')
  return res.items ?? []
}
