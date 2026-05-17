import type { FastifyInstance } from "fastify";
import { parseBiteBudUserId } from "../../biteBudUserId.js";
import { getRecipeSensoryConflicts } from "../../services/recipeSensoryService.js";

/** Register `GET /api/recipes/:id/sensory-conflicts` — surface sensory/dietary/texture warnings for a recipe. */
export async function registerSensoryConflictsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/recipes/:id/sensory-conflicts", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) {
      return reply.status(400).send({ error: "Missing or invalid X-User-Id" });
    }
    const result = await getRecipeSensoryConflicts(id, userId);
    if ("kind" in result && result.kind === "not_found") {
      return reply.status(404).send({ error: "Not found" });
    }
    return reply.send(result);
  });
}
