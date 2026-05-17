import type { FastifyInstance } from "fastify";
import { parseBiteBudUserId } from "../../biteBudUserId.js";
import { searchRecipes } from "../../services/recipeQueryService.js";
import { searchQuery } from "./recipeSchemas.js";

/** Register `GET /api/recipes/search` — MealDB-backed search with sensory profile annotations. */
export async function registerSearchRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/recipes/search", async (request, reply) => {
    const query = searchQuery.parse((request.query as Record<string, string>) ?? {});
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    return reply.send(await searchRecipes(userId, query));
  });
}
