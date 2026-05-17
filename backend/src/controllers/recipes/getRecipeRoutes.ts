import type { FastifyInstance } from "fastify";
import { parseBiteBudUserId } from "../../biteBudUserId.js";
import { getRecipeById } from "../../services/recipeQueryService.js";

/** Register `GET /api/recipes/:id` — return a recipe + parsed graph, re-parsing stale MealDB imports on demand. */
export async function registerGetRecipeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/recipes/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    const result = await getRecipeById(id, userId);
    if ("kind" in result && result.kind === "not_found") {
      return reply.status(404).send({ error: "Not found" });
    }
    return reply.send(result);
  });
}
