import type { FastifyInstance } from "fastify";
import { parseBiteBudUserId } from "../../biteBudUserId.js";
import { recipeDatabase } from "../../database/recipeDatabase.js";
import { parseRecipeGraph, type RecipeGraph } from "../../graph/recipeGraph.js";
import { generateRecipeLedeResilient } from "../../services/recipeLede.js";
import { deriveRecipeMetadata } from "../../services/recipeMetadata.js";
import {
  getMealDbMinutes,
  getMealDbServings,
  linkRecipeToUser,
  parseRecipeTextToGraphResilient,
  persistGraph,
  withIcons,
} from "../../services/recipeRouteHelpers.js";
import {
  enrichGraphWithMealDbImages,
  lookupMealById,
  mealToRecipeText,
} from "../../services/themealdb.js";
import { importBody } from "./recipeSchemas.js";

type ExistingRecipe = NonNullable<Awaited<ReturnType<typeof recipeDatabase.recipeFindUnique>>>;

/** Patch a cached refined recipe so its DB columns and `graph` JSON match the latest MealDB snapshot. */
async function refreshCachedMealDbRecipe(
  existing: ExistingRecipe,
  knownTime: number | null,
  knownServings: number | null,
  mealDbId: string,
): Promise<ExistingRecipe> {
  let updated = existing;
  if (updated.totalTimeMinutes == null && knownTime != null) {
    await recipeDatabase.recipeUpdate({
      where: { id: updated.id },
      data: { totalTimeMinutes: knownTime },
    });
    updated = { ...updated, totalTimeMinutes: knownTime };
  }
  if (updated.servings == null && knownServings != null) {
    const baseGraph = parseRecipeGraph(updated.graph);
    await recipeDatabase.recipeUpdate({
      where: { id: updated.id },
      data: {
        servings: knownServings,
        graph: { ...(baseGraph as unknown as object), servings: knownServings } as object,
      },
    });
    updated = { ...updated, servings: knownServings };
  }
  if (!updated.imageUrl) {
    try {
      const meal = await lookupMealById(mealDbId);
      const thumbUrl = typeof meal.strMealThumb === "string" ? meal.strMealThumb.trim() : "";
      if (thumbUrl) {
        await recipeDatabase.recipeUpdate({
          where: { id: updated.id },
          data: { imageUrl: thumbUrl },
        });
        updated = { ...updated, imageUrl: thumbUrl };
      }
    } catch {
      // keep existing record even if image refresh fails
    }
  }
  return updated;
}

/** Register `POST /api/recipes/import/themealdb` — import a MealDB meal (or return cached version). */
export async function registerImportThemealdbRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/recipes/import/themealdb", async (request, reply) => {
    const body = importBody.parse(request.body);
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);

    const mealDbMinutes = await getMealDbMinutes();
    const mealDbServings = await getMealDbServings();
    const knownTime = mealDbMinutes.get(body.mealDbId) ?? null;
    const knownServings = mealDbServings.get(body.mealDbId) ?? null;
    const existing = await recipeDatabase.recipeFindUnique({
      where: { mealDbId: body.mealDbId },
    });

    if (existing && existing.refined) {
      const refreshed = await refreshCachedMealDbRecipe(
        existing,
        knownTime,
        knownServings,
        body.mealDbId,
      );
      const cachedGraph = parseRecipeGraph(refreshed.graph);
      const graphWithServings =
        cachedGraph.servings == null && knownServings != null
          ? { ...cachedGraph, servings: knownServings }
          : cachedGraph;
      const resolved = await withIcons({ ...graphWithServings, id: refreshed.id }, userId);
      await linkRecipeToUser(refreshed.id, userId);
      return reply.send({
        recipeId: refreshed.id,
        graph: resolved,
        parserSource: "cached",
      });
    }

    const meal = await lookupMealById(body.mealDbId);
    const { text, sourceUrl, imageUrl } = mealToRecipeText(meal);
    const parsed = await parseRecipeTextToGraphResilient(text, sourceUrl);
    const graph = enrichGraphWithMealDbImages(meal, parsed.graph);
    const resolved = await withIcons(graph, userId);
    const lede = await generateRecipeLedeResilient({
      title: resolved.title,
      rawText: text,
    });
    const resolvedWithTime: RecipeGraph = {
      ...resolved,
      ...(knownTime != null &&
      (resolved.totalTimeMinutes == null || !Number.isFinite(resolved.totalTimeMinutes))
        ? { totalTimeMinutes: knownTime }
        : {}),
      ...(knownServings != null &&
      (resolved.servings == null || !Number.isFinite(resolved.servings))
        ? { servings: knownServings }
        : {}),
    };

    if (existing) {
      const derived = deriveRecipeMetadata(resolvedWithTime);
      const totalTimeMinutesOut =
        knownTime != null &&
        (resolvedWithTime.totalTimeMinutes == null ||
          !Number.isFinite(resolvedWithTime.totalTimeMinutes))
          ? knownTime
          : resolvedWithTime.totalTimeMinutes ?? null;
      const fullGraph: RecipeGraph = {
        ...resolvedWithTime,
        id: existing.id,
        totalTimeMinutes: totalTimeMinutesOut,
      };
      await recipeDatabase.recipeUpdate({
        where: { id: existing.id },
        data: {
          title: fullGraph.title,
          lede,
          imageUrl: imageUrl ?? null,
          sourceUrl: fullGraph.sourceUrl ?? null,
          totalTimeMinutes: totalTimeMinutesOut,
          servings: fullGraph.servings ?? null,
          graph: fullGraph as object,
          rawText: text,
          refined: parsed.refined,
          complexity: derived.complexity ?? null,
          heatLevel: derived.heatLevel ?? null,
          tags: (derived.tags ?? []) as unknown as object,
        } as unknown as Parameters<typeof recipeDatabase.recipeUpdate>[0]["data"],
      });
      await linkRecipeToUser(existing.id, userId);
      return reply.send({
        recipeId: existing.id,
        graph: fullGraph,
        parserSource: parsed.parserSource,
      });
    }

    const saved = await persistGraph(resolvedWithTime, {
      mealDbId: body.mealDbId,
      rawText: text,
      refined: parsed.refined,
      lede,
      metadata: { imageUrl },
    });

    if (
      (saved.graph.totalTimeMinutes == null && knownTime != null) ||
      (saved.graph.servings == null && knownServings != null)
    ) {
      const graphPatch: Record<string, unknown> = {};
      const dataPatch: Record<string, unknown> = {};
      if (saved.graph.totalTimeMinutes == null && knownTime != null) {
        graphPatch.totalTimeMinutes = knownTime;
        dataPatch.totalTimeMinutes = knownTime;
        saved.graph.totalTimeMinutes = knownTime;
      }
      if (saved.graph.servings == null && knownServings != null) {
        graphPatch.servings = knownServings;
        dataPatch.servings = knownServings;
        saved.graph.servings = knownServings;
      }
      await recipeDatabase.recipeUpdate({
        where: { id: saved.recipeId },
        data: {
          ...(dataPatch as object),
          graph: { ...(saved.graph as unknown as object), ...graphPatch } as object,
        },
      });
    }

    await linkRecipeToUser(saved.recipeId, userId);
    return reply.send({ ...saved, parserSource: parsed.parserSource });
  });
}
