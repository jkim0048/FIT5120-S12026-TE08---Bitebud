import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseBiteBudUserId } from "../biteBudUserId.js";
import {
  getMotivationInsights,
  getMotivationProgress,
  getMotivationSummary,
  parseLocalDateYmd,
  recordMotivationActivity,
  type MotivationActivityType,
} from "../services/motivation.js";

const recordBody = z.object({
  type: z.enum(["recipe_completed", "restaurant_review_submitted"]),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  recipeId: z.string().uuid().optional(),
  placeId: z.string().uuid().optional(),
});

const progressQuery = z.object({
  year: z.coerce.number().int().min(2020).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

export async function registerMotivationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/motivation/record", async (request, reply) => {
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) {
      return reply.status(400).send({ error: "Missing or invalid X-User-Id" });
    }
    const body = recordBody.parse(request.body);
    const localDate = parseLocalDateYmd(body.localDate);
    const meta: Record<string, unknown> = {};
    if (body.recipeId) meta.recipeId = body.recipeId;
    if (body.placeId) meta.placeId = body.placeId;

    const result = await recordMotivationActivity({
      userId,
      type: body.type as MotivationActivityType,
      localDate,
      metadata: meta,
    });
    return reply.send(result);
  });

  app.get("/api/motivation/summary", async (request, reply) => {
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) {
      return reply.send({
        currentStreak: 0,
        longestStreak: 0,
        showStartFresh: false,
        hasActivity: false,
      });
    }
    const summary = await getMotivationSummary(userId);
    return reply.send(summary);
  });

  app.get("/api/motivation/progress", async (request, reply) => {
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) {
      return reply.status(400).send({ error: "Missing or invalid X-User-Id" });
    }
    const q = progressQuery.safeParse(request.query ?? {});
    const year = q.success ? q.data.year : undefined;
    const month = q.success ? q.data.month : undefined;
    const progress = await getMotivationProgress(userId, { year, month });
    return reply.send(progress);
  });

  app.get("/api/motivation/insights", async (request, reply) => {
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) {
      return reply.status(400).send({ error: "Missing or invalid X-User-Id" });
    }
    const insights = await getMotivationInsights(userId);
    return reply.send(insights);
  });
}
