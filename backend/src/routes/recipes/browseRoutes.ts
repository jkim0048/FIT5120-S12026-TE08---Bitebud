import type { FastifyInstance } from "fastify";
import { parseBiteBudUserId } from "../../biteBudUserId.js";
import { findEligibleRecipeEvents } from "../../database/motivationDatabase.js";
import { recipeDatabase } from "../../database/recipeDatabase.js";
import { sensoryProfileDatabase } from "../../database/sensoryProfileDatabase.js";
import { parseRecipeGraph } from "../../graph/recipeGraph.js";
import { deriveRecipeMetadata } from "../../services/recipeMetadata.js";
import { jsonStringArray } from "../../services/recipeRouteHelpers.js";
import {
  computeSensoryConflicts,
  matchStatusFromConflicts,
  profileWarningsFromConflicts,
} from "../../services/sensoryMatch.js";
import { browseQuery } from "./recipeSchemas.js";

/**
 * Backfill `RecipeProgress.completedAt` for legacy users whose completions only exist as motivation events.
 *
 * Pre-existing motivation logs (eligible_activity recipe_completed) precede the `completedAt` field, so we
 * walk them once on every browse call to stamp the progress row for matching recipes.
 */
async function backfillLegacyRecipeCompletions(userId: string): Promise<void> {
  const eligibleEvents = await findEligibleRecipeEvents(userId);
  const completedRecipeIds = new Set<string>();
  for (const event of eligibleEvents) {
    const metadata = event.metadata as { type?: string; recipeId?: string };
    if (metadata?.type !== "recipe_completed") continue;
    if (typeof metadata.recipeId === "string" && metadata.recipeId.trim()) {
      completedRecipeIds.add(metadata.recipeId.trim());
    }
  }
  const recipeIds = [...completedRecipeIds];
  if (!recipeIds.length) return;

  const existingRecipes = await recipeDatabase.recipeFindMany({
    where: { id: { in: recipeIds } },
    select: { id: true },
  });
  const existingIdSet = new Set(existingRecipes.map((row) => row.id));
  for (const recipeId of recipeIds) {
    if (!existingIdSet.has(recipeId)) continue;
    const progressRow = await recipeDatabase.recipeProgressFindUnique({
      where: { recipeId_userId: { recipeId, userId } },
    });
    if (progressRow && (progressRow as { completedAt?: Date | null }).completedAt) continue;
    await recipeDatabase.recipeProgressUpsert({
      where: { recipeId_userId: { recipeId, userId } },
      create: {
        recipeId,
        userId,
        completedNodeIds:
          ((progressRow as { completedNodeIds?: string[] } | null)?.completedNodeIds as string[]) ??
          [],
        completedAt: new Date(),
      } as unknown as Parameters<typeof recipeDatabase.recipeProgressUpsert>[0]["create"],
      update: { completedAt: new Date() } as unknown as Parameters<
        typeof recipeDatabase.recipeProgressUpsert
      >[0]["update"],
    });
  }
}

/** Register `GET /api/recipes/browse` — My Recipes listing with sensory profile filtering. */
export async function registerBrowseRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/recipes/browse", async (request, reply) => {
    const query = browseQuery.parse((request.query as Record<string, string>) ?? {});
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    const where: Record<string, unknown> = {};
    const searchText = query.q?.trim();
    if (searchText) where.title = { contains: searchText, mode: "insensitive" };
    if (query.maxMinutes != null) where.totalTimeMinutes = { lte: query.maxMinutes };
    if (query.complexity && query.complexity !== "any") where.complexity = query.complexity;
    if (query.heatLevel && query.heatLevel !== "any") where.heatLevel = query.heatLevel;

    if (userId) {
      try {
        await backfillLegacyRecipeCompletions(userId);
      } catch {
        // Do not block browsing on backfill failures.
      }
      where.progress = { some: { userId, completedAt: { not: null } } };
    } else {
      // For You is user-specific; without user ID we return empty.
      where.id = "__none__";
    }

    const orderBy =
      query.sort === "newest" ? ({ createdAt: "desc" } as const) : ({ updatedAt: "desc" } as const);
    const recipes = await recipeDatabase.recipeFindMany({
      where,
      orderBy,
      skip: query.skip,
      take: query.limit,
    });

    let profileFoods: Array<{ name: string; status: "SAFE" | "UNSURE" | "UNSAFE" }> = [];
    let dietaryNeeds: string[] = [];
    let culturalRequirements: string[] = [];
    let hasSensoryProfile = false;
    if (userId) {
      const profile = await sensoryProfileDatabase.sensoryProfileFindUnique({
        where: { userId },
        include: { foodItems: true },
      });
      if (profile) {
        hasSensoryProfile = true;
        profileFoods = profile.foodItems.map((foodItem) => ({
          name: foodItem.name,
          status: foodItem.status as "SAFE" | "UNSURE" | "UNSAFE",
        }));
        dietaryNeeds = jsonStringArray(profile.dietaryNeeds);
        culturalRequirements = jsonStringArray(profile.culturalRequirements);
      }
    }

    const cards = recipes
      .map((recipe) => {
        const graph = parseRecipeGraph(recipe.graph);
        const derived = deriveRecipeMetadata(graph);
        const effectiveTags = (Array.isArray(recipe.tags) ? recipe.tags : derived.tags ?? []).filter(
          (value): value is string => typeof value === "string",
        );
        let matchStatus: "safe" | "sometimes" | "unsafe" = "safe";
        let profileWarnings: string[] = [];
        let hasDietaryConflict = false;
        let hasSensoryConflict = false;
        if (hasSensoryProfile) {
          const { sensory, dietary } = computeSensoryConflicts(
            graph,
            profileFoods,
            dietaryNeeds,
            culturalRequirements,
          );
          matchStatus = matchStatusFromConflicts(sensory, dietary);
          profileWarnings = profileWarningsFromConflicts(sensory, dietary);
          hasDietaryConflict = dietary.length > 0;
          hasSensoryConflict = sensory.length > 0;
        }

        return {
          id: recipe.id,
          mealDbId: recipe.mealDbId,
          title: recipe.title,
          image: recipe.imageUrl ?? undefined,
          minutes: recipe.totalTimeMinutes ?? null,
          heatLevel: recipe.heatLevel ?? derived.heatLevel ?? "none",
          complexity: recipe.complexity ?? derived.complexity ?? "low",
          tags: effectiveTags,
          matchStatus,
          profileWarnings,
          hasDietaryConflict,
          hasSensoryConflict,
        };
      })
      .filter(
        (card) =>
          query.filter === "showAll" || (!card.hasDietaryConflict && !card.hasSensoryConflict),
      );

    return reply.send({ results: cards });
  });
}
