import type { FastifyInstance } from "fastify";
import { parseBiteBudUserId } from "../../biteBudUserId.js";
import { assembleActivityPayload } from "../../services/userActivityService.js";

/** Register `GET /api/me/activity` — current streak + recent activity totals. */
export async function registerActivityRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/me/activity", async (request, reply) => {
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) return reply.status(400).send({ error: "Missing or invalid X-User-Id" });

    const payload = await assembleActivityPayload(userId);
    return reply.send(payload);
  });
}
