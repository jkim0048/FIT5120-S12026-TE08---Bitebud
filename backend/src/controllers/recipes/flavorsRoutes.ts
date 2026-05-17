import type { FastifyInstance } from "fastify";
import { getRecipeFlavors } from "../../services/recipeQueryService.js";

/** Register `GET /api/recipes/:id/flavors` — group recipe ingredients by inferred flavour bucket. */
export async function registerFlavorsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/recipes/:id/flavors", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await getRecipeFlavors(id);
    if ("kind" in result && result.kind === "not_found") {
      return reply.status(404).send({ error: "Not found" });
    }
    return reply.send(result);
  });
}
