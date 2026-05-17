import type { FastifyInstance } from "fastify";
import { parseBiteBudUserId } from "../../biteBudUserId.js";
import { createRecipeCompletion } from "../../services/recipeProgressService.js";
import { completionBody } from "./recipeSchemas.js";

/** Register `POST /api/recipes/:id/completions` — record a rated cooking completion with feedback tags. */
export async function registerCompletionsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/recipes/:id/completions", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) {
      return reply.status(400).send({ error: "Missing or invalid X-User-Id" });
    }
    const body = completionBody.parse(request.body);
    const result = await createRecipeCompletion(id, userId, body);
    if ("kind" in result && result.kind === "not_found") {
      return reply.status(404).send({ error: "Not found" });
    }
    return reply.send(result);
  });
}
