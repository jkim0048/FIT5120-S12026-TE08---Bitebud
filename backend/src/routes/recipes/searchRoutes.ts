import type { FastifyInstance } from "fastify";
import { parseBiteBudUserId } from "../../biteBudUserId.js";
import { sensoryProfileDatabase } from "../../database/sensoryProfileDatabase.js";
import { getMealDbMinutes, jsonStringArray } from "../../services/recipeRouteHelpers.js";
import {
  computeSensoryConflictsFromIngredientLines,
  computeTextureConflictsFromIngredientLines,
  decodeUnsafeTexturePrefs,
  matchStatusFromConflicts,
  profileWarningsFromConflicts,
} from "../../services/sensoryMatch.js";
import {
  browseMealsOrdered,
  mealIngredientLines,
  mealSearchHitFields,
  searchMealsOrdered,
} from "../../services/themealdb.js";
import { searchQuery } from "./recipeSchemas.js";

/** Register `GET /api/recipes/search` — MealDB-backed search with sensory profile annotations. */
export async function registerSearchRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/recipes/search", async (request, reply) => {
    const query = searchQuery.parse((request.query as Record<string, string>) ?? {});
    const filters = {
      maxMinutes: query.maxMinutes,
      complexity: query.complexity,
      heatLevel: query.heatLevel,
    };
    const searchText = query.q;
    const meals = searchText
      ? await searchMealsOrdered(searchText, filters)
      : await browseMealsOrdered(query.page, query.limit, filters);

    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
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

    return reply.send({ results });
  });
}
