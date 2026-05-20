import { recipeDatabase } from "../database/recipeDatabase.js";
import type { RecipeGraph } from "../graph/recipeGraph.js";
import { generateRecipeLedeResilient } from "./recipeLede.js";
import { deriveRecipeMetadata } from "./recipeMetadata.js";
import { parseRecipeTextToGraphResilient, withIcons } from "./recipeRouteHelpers.js";
import { enrichGraphWithMealDbImages, lookupMealById } from "./themealdb.js";

export type RecipeNotFound = { kind: "not_found" };
export type MissingSourceText = { kind: "missing_source_text" };

/** Re-run the LLM parser over an existing recipe's source text. */
export async function refineRecipe(recipeId: string, userId: string | null) {
  const recipe = await recipeDatabase.recipeFindUnique({ where: { id: recipeId } });
  if (!recipe) return { kind: "not_found" } as RecipeNotFound;
  if (!recipe.rawText) return { kind: "missing_source_text" } as MissingSourceText;

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
      const thumbUrl = typeof meal.strMealThumb === "string" ? meal.strMealThumb.trim() : "";
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
  return { ok: true, parserSource: parsed.parserSource };
}
