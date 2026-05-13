import { apiFetch } from './api'
import { getBiteBudUserId } from '../composables/useUserId'

export type RecipeCompletionCreateBody = {
  rating?: number
  wouldRepeat?: boolean
  worked?: string[]
  didntWork?: string[]
  notes?: string
}

export async function postRecipeCompletion(
  recipeId: string,
  body: RecipeCompletionCreateBody,
): Promise<{ id: string; completedAt: string }> {
  const uid = getBiteBudUserId()
  if (!uid) throw new Error('Missing user id')
  return apiFetch<{ id: string; completedAt: string }>(`/api/recipes/${recipeId}/completions`, {
    method: 'POST',
    headers: { 'X-User-Id': uid },
    body: JSON.stringify(body),
  })
}

