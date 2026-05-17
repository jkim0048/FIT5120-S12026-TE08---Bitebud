import type { FastifyInstance } from "fastify";
import { parseBiteBudUserId } from "../../biteBudUserId.js";
import { recipeDatabase } from "../../database/recipeDatabase.js";
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
    const recipe = await recipeDatabase.recipeFindUnique({ where: { id } });
    if (!recipe) return reply.status(404).send({ error: "Not found" });

    await recipeDatabase.recipeProgressUpsert({
      where: { recipeId_userId: { recipeId: id, userId } },
      create: { recipeId: id, userId, completedNodeIds: body.completedNodeIds },
      update: { completedNodeIds: body.completedNodeIds },
    });
    return reply.send({ ok: true });
  });

  app.post("/api/recipes/:id/complete", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) {
      return reply.status(400).send({ error: "Missing or invalid X-User-Id" });
    }
    const recipe = await recipeDatabase.recipeFindUnique({ where: { id } });
    if (!recipe) return reply.status(404).send({ error: "Not found" });

    const existing = await recipeDatabase.recipeProgressFindUnique({
      where: { recipeId_userId: { recipeId: id, userId } },
    });
    if (existing && (existing as { completedAt?: Date | null }).completedAt) {
      return reply.send({ ok: true });
    }

    const completedAt = new Date();
    await recipeDatabase.recipeProgressUpsert({
      where: { recipeId_userId: { recipeId: id, userId } },
      create: {
        recipeId: id,
        userId,
        completedNodeIds:
          ((existing as { completedNodeIds?: string[] } | null)?.completedNodeIds as string[]) ??
          [],
        completedAt,
      } as unknown as Parameters<typeof recipeDatabase.recipeProgressUpsert>[0]["create"],
      update: { completedAt } as unknown as Parameters<
        typeof recipeDatabase.recipeProgressUpsert
      >[0]["update"],
    });
    return reply.send({ ok: true });
  });

  app.get("/api/recipes/:id/progress", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) {
      return reply.status(400).send({ error: "Missing or invalid X-User-Id" });
    }
    const row = await recipeDatabase.recipeProgressFindUnique({
      where: { recipeId_userId: { recipeId: id, userId } },
    });
    const completedNodeIds = (row?.completedNodeIds as string[]) ?? [];
    return reply.send({ completedNodeIds });
  });
}
