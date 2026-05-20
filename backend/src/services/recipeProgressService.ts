import { recipeDatabase } from "../database/recipeDatabase.js";

export type RecipeNotFound = { kind: "not_found" };

/** Persist per-step checklist progress for a user and recipe. */
export async function saveRecipeProgress(
  recipeId: string,
  userId: string,
  completedNodeIds: string[],
): Promise<RecipeNotFound | { ok: true }> {
  const recipe = await recipeDatabase.recipeFindUnique({ where: { id: recipeId } });
  if (!recipe) return { kind: "not_found" };

  await recipeDatabase.recipeProgressUpsert({
    where: { recipeId_userId: { recipeId, userId } },
    create: { recipeId, userId, completedNodeIds },
    update: { completedNodeIds },
  });
  return { ok: true };
}

/** Mark a recipe fully completed for a user (idempotent if already completed). */
export async function completeRecipe(
  recipeId: string,
  userId: string,
): Promise<RecipeNotFound | { ok: true }> {
  const recipe = await recipeDatabase.recipeFindUnique({ where: { id: recipeId } });
  if (!recipe) return { kind: "not_found" };

  const existing = await recipeDatabase.recipeProgressFindUnique({
    where: { recipeId_userId: { recipeId, userId } },
  });
  if (existing && (existing as { completedAt?: Date | null }).completedAt) {
    return { ok: true };
  }

  const completedAt = new Date();
  await recipeDatabase.recipeProgressUpsert({
    where: { recipeId_userId: { recipeId, userId } },
    create: {
      recipeId,
      userId,
      completedNodeIds:
        ((existing as { completedNodeIds?: string[] } | null)?.completedNodeIds as string[]) ??
        [],
      completedAt,
    } as unknown as Parameters<typeof recipeDatabase.recipeProgressUpsert>[0]["create"],
    update: { completedAt } as unknown as Parameters<
      typeof recipeDatabase.recipeProgressUpsert
    >[0]["update"],
  });
  return { ok: true };
}

/** Return completed step node ids for a user and recipe. */
export async function getRecipeProgress(
  recipeId: string,
  userId: string,
): Promise<{ completedNodeIds: string[] }> {
  const row = await recipeDatabase.recipeProgressFindUnique({
    where: { recipeId_userId: { recipeId, userId } },
  });
  return { completedNodeIds: (row?.completedNodeIds as string[]) ?? [] };
}

/** Record a rated cooking completion with feedback tags. */
export async function createRecipeCompletion(
  recipeId: string,
  userId: string,
  body: {
    rating?: number | null;
    wouldRepeat?: boolean | null;
    worked?: string[];
    didntWork?: string[];
    notes?: string;
  },
): Promise<RecipeNotFound | { id: string; completedAt: string }> {
  const recipe = await recipeDatabase.recipeFindUnique({
    where: { id: recipeId },
    select: { id: true },
  });
  if (!recipe) return { kind: "not_found" };

  const created = await recipeDatabase.recipeCompletionCreate({
    data: {
      recipeId: recipe.id,
      userId,
      rating: body.rating ?? null,
      wouldRepeat: body.wouldRepeat ?? null,
      worked: (body.worked ?? []) as unknown as object,
      didntWork: (body.didntWork ?? []) as unknown as object,
      notes: body.notes?.trim() ? body.notes.trim() : null,
    },
    select: { id: true, completedAt: true },
  });

  return {
    id: created.id,
    completedAt: created.completedAt.toISOString(),
  };
}
