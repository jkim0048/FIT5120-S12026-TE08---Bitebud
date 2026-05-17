import type { FastifyInstance } from "fastify";
import { parseBiteBudUserId } from "../../biteBudUserId.js";
import { recipeDatabase } from "../../database/recipeDatabase.js";
import { parseRecipeGraph, type RecipeGraph } from "../../graph/recipeGraph.js";
import { deriveRecipeMetadata } from "../../services/recipeMetadata.js";
import {
  getMealDbMinutes,
  getMealDbServings,
  linkRecipeToUser,
  parseRecipeTextToGraphResilient,
  withIcons,
} from "../../services/recipeRouteHelpers.js";
import {
  enrichGraphWithMealDbImages,
  lookupMealById,
  mealToRecipeText,
} from "../../services/themealdb.js";

type RecipeRow = NonNullable<Awaited<ReturnType<typeof recipeDatabase.recipeFindUnique>>>;

/** Re-parse a cached unrefined MealDB import and persist the result; returns the refreshed record. */
async function refreshUnrefinedMealDbRecipe(recipe: RecipeRow): Promise<RecipeRow> {
  if (!recipe.mealDbId) return recipe;
  try {
    const mealDbMinutes = await getMealDbMinutes();
    const mealDbServings = await getMealDbServings();
    const knownTime = mealDbMinutes.get(recipe.mealDbId) ?? null;
    const knownServings = mealDbServings.get(recipe.mealDbId) ?? null;
    const meal = await lookupMealById(recipe.mealDbId);
    const { text, sourceUrl, imageUrl } = mealToRecipeText(meal);
    const parsed = await parseRecipeTextToGraphResilient(text, sourceUrl);
    const graph = enrichGraphWithMealDbImages(meal, parsed.graph);
    const derived = deriveRecipeMetadata(graph);

    const totalTimeMinutesOut =
      knownTime != null && (graph.totalTimeMinutes == null || !Number.isFinite(graph.totalTimeMinutes))
        ? knownTime
        : graph.totalTimeMinutes ?? null;
    const servingsOut =
      knownServings != null && (graph.servings == null || !Number.isFinite(graph.servings))
        ? knownServings
        : graph.servings ?? null;
    const fullGraph: RecipeGraph = {
      ...graph,
      id: recipe.id,
      totalTimeMinutes: totalTimeMinutesOut,
      servings: servingsOut,
    };

    await recipeDatabase.recipeUpdate({
      where: { id: recipe.id },
      data: {
        title: fullGraph.title,
        imageUrl: imageUrl ?? null,
        sourceUrl: fullGraph.sourceUrl ?? null,
        totalTimeMinutes: totalTimeMinutesOut,
        servings: servingsOut,
        graph: fullGraph as object,
        rawText: text,
        refined: parsed.refined,
        complexity: derived.complexity ?? null,
        heatLevel: derived.heatLevel ?? null,
        tags: (derived.tags ?? []) as unknown as object,
      },
    });

    const refreshed = await recipeDatabase.recipeFindUnique({ where: { id: recipe.id } });
    return refreshed ?? recipe;
  } catch {
    return recipe;
  }
}

/** Lazy-load the MealDB thumbnail when a recipe has no image yet; returns the (possibly updated) record. */
async function backfillMealDbThumbnail(recipe: RecipeRow): Promise<RecipeRow> {
  if (recipe.imageUrl || !recipe.mealDbId) return recipe;
  try {
    const meal = await lookupMealById(recipe.mealDbId);
    const thumbnailUrl = typeof meal.strMealThumb === "string" ? meal.strMealThumb.trim() : "";
    if (!thumbnailUrl) return recipe;
    await recipeDatabase.recipeUpdate({
      where: { id: recipe.id },
      data: { imageUrl: thumbnailUrl },
    });
    return { ...recipe, imageUrl: thumbnailUrl };
  } catch {
    return recipe;
  }
}

/** Register `GET /api/recipes/:id` — return a recipe + parsed graph, re-parsing stale MealDB imports on demand. */
export async function registerGetRecipeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/recipes/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    let recipe = await recipeDatabase.recipeFindUnique({ where: { id } });
    if (!recipe) return reply.status(404).send({ error: "Not found" });

    if (recipe.mealDbId && !recipe.refined) {
      recipe = await refreshUnrefinedMealDbRecipe(recipe);
      if (!recipe) return reply.status(404).send({ error: "Not found" });
    }

    recipe = await backfillMealDbThumbnail(recipe);

    const graph = parseRecipeGraph(recipe.graph);
    const resolved = await withIcons({ ...graph, id: recipe.id }, userId);
    await linkRecipeToUser(recipe.id, userId);

    return reply.send({
      recipeId: recipe.id,
      graph: resolved,
      lede: (recipe as { lede?: string | null }).lede ?? null,
      imageUrl: recipe.imageUrl,
      complexity: recipe.complexity,
      heatLevel: recipe.heatLevel,
      tags: recipe.tags,
      updatedAt: recipe.updatedAt.toISOString(),
      refined: Boolean(recipe.refined),
      canRefine: Boolean(recipe.rawText),
    });
  });
}
