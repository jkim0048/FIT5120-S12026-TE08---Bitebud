import type { FastifyInstance } from "fastify";
import { parseBiteBudUserId } from "../../biteBudUserId.js";
import { recipeDatabase } from "../../database/recipeDatabase.js";
import type { RecipeGraph } from "../../graph/recipeGraph.js";
import { generateRecipeLedeResilient } from "../../services/recipeLede.js";
import { deriveRecipeMetadata } from "../../services/recipeMetadata.js";
import {
  parseRecipeTextToGraphResilient,
  withIcons,
} from "../../services/recipeRouteHelpers.js";
import {
  enrichGraphWithMealDbImages,
  lookupMealById,
} from "../../services/themealdb.js";

/** Register `POST /api/recipes/:id/refine` — re-run the LLM parser over an existing recipe's source text. */
export async function registerRefineRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/recipes/:id/refine", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    const recipe = await recipeDatabase.recipeFindUnique({ where: { id } });
    if (!recipe) return reply.status(404).send({ error: "Not found" });
    if (!recipe.rawText) {
      return reply
        .status(400)
        .send({ error: "Recipe cannot be refined (missing source text)" });
    }

    const parsed = await parseRecipeTextToGraphResilient(
      recipe.rawText,
      recipe.sourceUrl ?? null,
    );
    let graphAfterParse = parsed.graph;
    let mealThumb: string | null = null;
    if (recipe.mealDbId) {
      try {
        const meal = await lookupMealById(recipe.mealDbId);
        graphAfterParse = enrichGraphWithMealDbImages(meal, graphAfterParse);
        const thumbUrl =
          typeof meal.strMealThumb === "string" ? meal.strMealThumb.trim() : "";
        mealThumb = thumbUrl || null;
      } catch {
        // keep graph without MealDB enrichment
      }
    }

    const resolved = await withIcons({ ...graphAfterParse, id: recipe.id }, userId);
    const fullGraph: RecipeGraph = { ...resolved, id: recipe.id };
    const derivedMetadata = deriveRecipeMetadata(graphAfterParse);
    const lede = await generateRecipeLedeResilient({
      title: fullGraph.title,
      rawText: recipe.rawText,
    });

    await recipeDatabase.recipeUpdate({
      where: { id: recipe.id },
      data: {
        graph: fullGraph as object,
        refined: parsed.refined,
        lede,
        complexity: derivedMetadata.complexity ?? null,
        heatLevel: derivedMetadata.heatLevel ?? null,
        tags: (derivedMetadata.tags ?? []) as unknown as object,
        ...(recipe.imageUrl == null && mealThumb ? { imageUrl: mealThumb } : {}),
      } as unknown as Parameters<typeof recipeDatabase.recipeUpdate>[0]["data"],
    });
    return reply.send({ ok: true, parserSource: parsed.parserSource });
  });
}
