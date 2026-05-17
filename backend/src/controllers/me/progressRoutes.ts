import type { FastifyInstance } from "fastify";
import { parseBiteBudUserId } from "../../biteBudUserId.js";
import { parseIsoDateOnly, todayMelbourneDate } from "../../calendarDate.js";
import { buildProgressDashboardPayload } from "../../services/progressDashboardService.js";
import { insightsQuerySchema } from "./meSchemas.js";

/** Register `GET /api/me/progress` — cooking/dining dashboard for a Melbourne-local date range. */
export async function registerProgressRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/me/progress", async (request, reply) => {
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) return reply.status(400).send({ error: "Missing or invalid X-User-Id" });

    const parsedQuery = insightsQuerySchema.parse(
      (request.query as Record<string, unknown>) ?? {},
    );

    const todayUtc = todayMelbourneDate();
    const parsedFrom = parsedQuery.from ? parseIsoDateOnly(parsedQuery.from) : null;
    const parsedTo = parsedQuery.to ? parseIsoDateOnly(parsedQuery.to) : null;

    if (!parsedFrom || !parsedTo) {
      return reply.status(400).send({
        error: "Provide both `from` and `to` dates for the progress dashboard.",
      });
    }

    const rangeFrom = parsedFrom;
    const rangeTo = parsedTo;

    if (rangeFrom.getTime() > rangeTo.getTime()) {
      return reply.status(400).send({ error: "From date cannot be after To date" });
    }
    if (rangeTo.getTime() > todayUtc.getTime()) {
      return reply.status(400).send({ error: "To date cannot be in the future" });
    }

    const payload = await buildProgressDashboardPayload(userId, rangeFrom, rangeTo);
    return reply.send(payload);
  });
}
