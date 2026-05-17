import type { FastifyInstance } from "fastify";
import { parseBiteBudUserId } from "../../biteBudUserId.js";
import { recipeDatabase } from "../../database/recipeDatabase.js";
import { sensoryProfileDatabase } from "../../database/sensoryProfileDatabase.js";
import { parseRecipeGraph } from "../../graph/recipeGraph.js";
import {
  graphIngredientLines,
  jsonStringArray,
} from "../../services/recipeRouteHelpers.js";
import {
  computeSensoryConflicts,
  computeTextureConflictsFromIngredientLines,
  decodeUnsafeTexturePrefs,
} from "../../services/sensoryMatch.js";

const SAFETY_DISCLAIMER =
  "Suggestions only—verify ingredients yourself, especially for allergies.";

/** Register `GET /api/recipes/:id/sensory-conflicts` — surface sensory/dietary/texture warnings for a recipe. */
export async function registerSensoryConflictsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/recipes/:id/sensory-conflicts", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) {
      return reply.status(400).send({ error: "Missing or invalid X-User-Id" });
    }
    const recipe = await recipeDatabase.recipeFindUnique({ where: { id } });
    if (!recipe) return reply.status(404).send({ error: "Not found" });

    const graph = parseRecipeGraph(recipe.graph);
    const profile = await sensoryProfileDatabase.sensoryProfileFindUnique({
      where: { userId },
      include: { foodItems: true },
    });

    if (!profile) {
      return reply.send({
        hasProfile: false,
        sensory: [],
        dietary: [],
        disclaimer: SAFETY_DISCLAIMER,
      });
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

    return reply.send({
      hasProfile: true,
      sensory,
      dietary,
      textures,
      disclaimer: SAFETY_DISCLAIMER,
    });
  });
}
