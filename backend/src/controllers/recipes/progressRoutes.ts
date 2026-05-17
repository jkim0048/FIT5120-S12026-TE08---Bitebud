import type { FastifyInstance } from "fastify";
import { parseBiteBudUserId } from "../../biteBudUserId.js";
import {
  completeRecipe,
  getRecipeProgress,
  saveRecipeProgress,
} from "../../services/recipeProgressService.js";
import { progressBody } from "./recipeSchemas.js";

/**
 * Register the recipe progress / completion endpoints:
 * - `POST /api/recipes/:id/progress` — save the user's per-step checklist progress.
 * - `POST /api/recipes/:id/complete` — mark a recipe as fully completed (sets `completedAt`).
 * - `GET  /api/recipes/:id/progress` — fetch the user's completed step ids.
 */
export async function registerProgressRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/recipes/:id/progress", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) {
      return reply.status(400).send({ error: "Missing or invalid X-User-Id" });
    }
    const body = progressBody.parse(request.body);
    const result = await saveRecipeProgress(id, userId, body.completedNodeIds);
    if ("kind" in result && result.kind === "not_found") {
      return reply.status(404).send({ error: "Not found" });
    }
    return reply.send(result);
  });

  app.post("/api/recipes/:id/complete", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) {
      return reply.status(400).send({ error: "Missing or invalid X-User-Id" });
    }
    const result = await completeRecipe(id, userId);
    if ("kind" in result && result.kind === "not_found") {
      return reply.status(404).send({ error: "Not found" });
    }
    return reply.send(result);
  });

  app.get("/api/recipes/:id/progress", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) {
      return reply.status(400).send({ error: "Missing or invalid X-User-Id" });
    }
    return reply.send(await getRecipeProgress(id, userId));
  });
}
