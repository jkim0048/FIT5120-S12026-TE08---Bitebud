import type { FastifyInstance } from "fastify";
import { parseBiteBudUserId } from "../../biteBudUserId.js";
import { refineRecipe } from "../../services/recipeRefineService.js";

/** Register `POST /api/recipes/:id/refine` — re-run the LLM parser over an existing recipe's source text. */
export async function registerRefineRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/recipes/:id/refine", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    const result = await refineRecipe(id, userId);
    if ("kind" in result && result.kind === "not_found") {
      return reply.status(404).send({ error: "Not found" });
    }
    if ("kind" in result && result.kind === "missing_source_text") {
      return reply
        .status(400)
        .send({ error: "Recipe cannot be refined (missing source text)" });
    }
    return reply.send(result);
  });
}
