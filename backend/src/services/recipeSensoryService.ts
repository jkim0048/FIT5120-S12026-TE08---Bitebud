import { recipeDatabase } from "../database/recipeDatabase.js";
import { sensoryProfileDatabase } from "../database/sensoryProfileDatabase.js";
import { parseRecipeGraph } from "../graph/recipeGraph.js";
import { graphIngredientLines, jsonStringArray } from "./recipeRouteHelpers.js";
import {
  computeSensoryConflicts,
  computeTextureConflictsFromIngredientLines,
  decodeUnsafeTexturePrefs,
} from "./sensoryMatch.js";

const SAFETY_DISCLAIMER =
  "Suggestions only—verify ingredients yourself, especially for allergies.";

export type RecipeNotFound = { kind: "not_found" };

/** Sensory, dietary, and texture warnings for a recipe against the user's profile. */
export async function getRecipeSensoryConflicts(recipeId: string, userId: string) {
  const recipe = await recipeDatabase.recipeFindUnique({ where: { id: recipeId } });
  if (!recipe) return { kind: "not_found" } as RecipeNotFound;

  const graph = parseRecipeGraph(recipe.graph);
  const profile = await sensoryProfileDatabase.sensoryProfileFindUnique({
    where: { userId },
    include: { foodItems: true },
  });

  if (!profile) {
    return {
      hasProfile: false,
      sensory: [],
      dietary: [],
      disclaimer: SAFETY_DISCLAIMER,
    };
  }

  const dietaryNeeds = jsonStringArray(profile.dietaryNeeds);
  const culturalRequirements = jsonStringArray(profile.culturalRequirements);
  const foods = profile.foodItems.map((foodItem) => ({
    name: foodItem.name,
    status: foodItem.status as "SAFE" | "UNSURE" | "UNSAFE",
  }));
  const { sensory, dietary } = computeSensoryConflicts(
    graph,
    foods,
    dietaryNeeds,
    culturalRequirements,
  );
  const ingredientLines = graphIngredientLines(graph);
  const textures = computeTextureConflictsFromIngredientLines(
    ingredientLines,
    decodeUnsafeTexturePrefs(profile.texturePrefs),
  );

  return {
    hasProfile: true,
    sensory,
    dietary,
    textures,
    disclaimer: SAFETY_DISCLAIMER,
  };
}
