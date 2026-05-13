import type { FastifyInstance } from "fastify";
import { parseBiteBudUserId } from "../../biteBudUserId.js";
import { recipeDatabase } from "../../database/recipeDatabase.js";
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

    const recipe = await recipeDatabase.recipeFindUnique({
      where: { id },
      select: { id: true },
    });
    if (!recipe) return reply.status(404).send({ error: "Not found" });

    const created = await recipeDatabase.recipeCompletionCreate({
      data: {
        recipeId: recipe.id,
        userId,
        rating: body.rating ?? null,
        wouldRepeat: body.wouldRepeat ?? null,
        worked: (body.worked ?? []) as unknown as object,
        didntWork: (body.didntWork ?? []) as unknown as object,
        notes: body.notes?.trim() ? body.notes.trim() : null,
      },
      select: { id: true, completedAt: true },
    });

    return reply.send({
      id: created.id,
      completedAt: created.completedAt.toISOString(),
    });
  });
}
