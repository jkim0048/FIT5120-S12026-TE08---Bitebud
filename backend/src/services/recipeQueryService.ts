import { recipeDatabase } from "../database/recipeDatabase.js";
import { sensoryProfileDatabase } from "../database/sensoryProfileDatabase.js";
import { parseRecipeGraph, type RecipeGraph } from "../graph/recipeGraph.js";
import { inferFlavorProfile } from "./flavorProfile.js";
import { deriveRecipeMetadata } from "./recipeMetadata.js";
import {
  getMealDbMinutes,
  getMealDbServings,
  jsonStringArray,
  linkRecipeToUser,
  parseRecipeTextToGraphResilient,
  withIcons,
} from "./recipeRouteHelpers.js";
import {
  computeSensoryConflictsFromIngredientLines,
  computeTextureConflictsFromIngredientLines,
  decodeUnsafeTexturePrefs,
  matchStatusFromConflicts,
  profileWarningsFromConflicts,
} from "./sensoryMatch.js";
import {
  browseMealsOrdered,
  enrichGraphWithMealDbImages,
  lookupMealById,
  mealIngredientLines,
  mealSearchHitFields,
  mealToRecipeText,
  searchMealsOrdered,
} from "./themealdb.js";

const FLAVOR_LABELS: Array<{ key: "sweet" | "salty" | "sour" | "bitter" | "spicy"; label: string }> = [
  { key: "sweet", label: "Sweet" },
  { key: "salty", label: "Salty" },
  { key: "sour", label: "Sour" },
  { key: "bitter", label: "Bitter" },
  { key: "spicy", label: "Spicy" },
];

type RecipeRow = NonNullable<Awaited<ReturnType<typeof recipeDatabase.recipeFindUnique>>>;

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

export type RecipeNotFound = { kind: "not_found" };

/** Fetch a recipe with parsed graph, refreshing stale MealDB imports when needed. */
export async function getRecipeById(recipeId: string, userId: string | null) {
  let recipe = await recipeDatabase.recipeFindUnique({ where: { id: recipeId } });
  if (!recipe) return { kind: "not_found" } as RecipeNotFound;

  if (recipe.mealDbId && !recipe.refined) {
    recipe = await refreshUnrefinedMealDbRecipe(recipe);
    if (!recipe) return { kind: "not_found" } as RecipeNotFound;
  }

  recipe = await backfillMealDbThumbnail(recipe);

  const graph = parseRecipeGraph(recipe.graph);
  const resolved = await withIcons({ ...graph, id: recipe.id }, userId);
  await linkRecipeToUser(recipe.id, userId);

  return {
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
  };
}

export type SearchQuery = {
  q?: string;
  page: number;
  limit: number;
  maxMinutes?: number;
  complexity?: string;
  heatLevel?: string;
  filter: string;
};

/** MealDB-backed search with sensory profile annotations. */
export async function searchRecipes(userId: string | null, query: SearchQuery) {
  const filters = {
    maxMinutes: query.maxMinutes,
    complexity: query.complexity,
    heatLevel: query.heatLevel,
  };
  const searchText = query.q;
  const meals = searchText
    ? await searchMealsOrdered(searchText, filters)
    : await browseMealsOrdered(query.page, query.limit, filters);

  let profileFoods: Array<{ name: string; status: "SAFE" | "UNSURE" | "UNSAFE" }> = [];
  let dietaryNeeds: string[] = [];
  let culturalRequirements: string[] = [];
  let unsafeTextures: ReturnType<typeof decodeUnsafeTexturePrefs> = [];
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
      unsafeTextures = decodeUnsafeTexturePrefs(profile.texturePrefs);
    }
  }

  const rows = meals.map((meal) => {
    const meta = mealSearchHitFields(meal);
    const mealDbId = String(meal.idMeal);
    let matchStatus: "safe" | "sometimes" | "unsafe" = "safe";
    let profileWarnings: string[] = [];
    let hasDietaryConflict = false;
    let hasSensoryConflict = false;
    if (hasSensoryProfile) {
      const ingredientLines = mealIngredientLines(meal);
      const { sensory, dietary } = computeSensoryConflictsFromIngredientLines(
        ingredientLines,
        profileFoods,
        dietaryNeeds,
        culturalRequirements,
      );
      const textureConflicts = computeTextureConflictsFromIngredientLines(
        ingredientLines,
        unsafeTextures,
      );
      matchStatus = matchStatusFromConflicts(sensory, dietary, textureConflicts);
      profileWarnings = profileWarningsFromConflicts(sensory, dietary, textureConflicts);
      hasDietaryConflict = dietary.length > 0;
      hasSensoryConflict = sensory.length > 0;
    }
    return {
      id: mealDbId,
      title: meal.strMeal,
      image: meal.strMealThumb ?? undefined,
      minutes: meta.minutes,
      heatLevel: meta.heatLevel,
      complexity: meta.complexity,
      matchStatus,
      profileWarnings,
      hasDietaryConflict,
      hasSensoryConflict,
    };
  });

  const mealDbMinutes = await getMealDbMinutes();
  for (const row of rows) {
    const minutes = mealDbMinutes.get(row.id);
    if (minutes != null) row.minutes = minutes;
  }

  const results = hasSensoryProfile
    ? rows.filter(
        (row) => query.filter === "showAll" || (!row.hasDietaryConflict && !row.hasSensoryConflict),
      )
    : rows;

  return { results };
}

/** Group recipe ingredients by inferred flavour bucket. */
export async function getRecipeFlavors(recipeId: string) {
  const recipe = await recipeDatabase.recipeFindUnique({ where: { id: recipeId } });
  if (!recipe) return { kind: "not_found" } as RecipeNotFound;

  const graph = parseRecipeGraph(recipe.graph);
  const ingredients = (graph.nodes ?? [])
    .filter((node) => node.type === "ingredient")
    .map((node) => ({
      id: String(node.id),
      label: String(node.label ?? "").trim(),
      detail: String(node.detail ?? "").trim(),
    }))
    .filter((ingredient) => ingredient.id && ingredient.label);

  const inferredFlavorProfile = await inferFlavorProfile(ingredients);
  return {
    flavors: FLAVOR_LABELS.map((flavor) => ({
      key: flavor.key,
      label: flavor.label,
      ingredientIds: inferredFlavorProfile[flavor.key] ?? [],
    })).filter((flavor) => flavor.ingredientIds.length > 0),
  };
}
