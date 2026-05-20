import { apiFetch } from './api'
import { getBiteBudUserId } from '../composables/useUserId'

export type RecipeCompletionCreateBody = {
  rating?: number
  wouldRepeat?: boolean
  worked?: string[]
  didntWork?: string[]
  notes?: string
}

/** Submit a rated recipe completion (with optional feedback tags) for the active user. */
export async function postRecipeCompletion(
  recipeId: string,
  body: RecipeCompletionCreateBody,
): Promise<{ id: string; completedAt: string }> {
  const userId = getBiteBudUserId()
  if (!userId) throw new Error('Missing user id')
  return apiFetch<{ id: string; completedAt: string }>(`/api/recipes/${recipeId}/completions`, {
    method: 'POST',
    headers: { 'X-User-Id': userId },
    body: JSON.stringify(body),
  })
}

