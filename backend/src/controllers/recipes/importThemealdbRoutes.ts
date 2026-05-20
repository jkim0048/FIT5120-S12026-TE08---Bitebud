import type { FastifyInstance } from "fastify";
import { parseBiteBudUserId } from "../../biteBudUserId.js";
import { importThemealdbMeal } from "../../services/recipeImportService.js";
import { importBody } from "./recipeSchemas.js";

/** Register `POST /api/recipes/import/themealdb` — import a MealDB meal (or return cached version). */
export async function registerImportThemealdbRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/recipes/import/themealdb", async (request, reply) => {
    const body = importBody.parse(request.body);
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    return reply.send(await importThemealdbMeal(body.mealDbId, userId));
  });
}
