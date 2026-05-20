import type { FastifyInstance } from "fastify";
import { parseBiteBudUserId } from "../../biteBudUserId.js";
import { browseRecipes } from "../../services/recipeBrowseService.js";
import { browseQuery } from "./recipeSchemas.js";

/** Register `GET /api/recipes/browse` — My Recipes listing with sensory profile filtering. */
export async function registerBrowseRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/recipes/browse", async (request, reply) => {
    const query = browseQuery.parse((request.query as Record<string, string>) ?? {});
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    return reply.send(await browseRecipes(userId, query));
  });
}
