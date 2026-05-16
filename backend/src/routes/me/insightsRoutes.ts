import type { FastifyInstance } from "fastify";
import { parseBiteBudUserId } from "../../biteBudUserId.js";
import { parseIsoDateOnly, todayMelbourneDate } from "../../calendarDate.js";
import { findLifetimeActivityStats } from "../../database/userActivityDatabase.js";
import { buildInsightsPayload } from "../../services/insightsService.js";
import { insightsQuerySchema } from "./meSchemas.js";

/** Register `GET /api/me/insights` — multi-card cooking + dining insights for the user's recent activity. */
export async function registerInsightsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/me/insights", async (request, reply) => {
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) return reply.status(400).send({ error: "Missing or invalid X-User-Id" });

    const parsedQuery = insightsQuerySchema.parse(
      (request.query as Record<string, unknown>) ?? {},
    );

    const todayUtc = todayMelbourneDate();
    const parsedFrom = parsedQuery.from ? parseIsoDateOnly(parsedQuery.from) : null;
    const parsedTo = parsedQuery.to ? parseIsoDateOnly(parsedQuery.to) : null;
    let rangeFrom: Date | null = null;
    let rangeTo: Date | null = null;
    let fullHistoryInsights = false;
    if (parsedFrom && parsedTo) {
      rangeFrom = parsedFrom;
      rangeTo = parsedTo;
      fullHistoryInsights = false;
    } else {
      const lifetimeRow = await findLifetimeActivityStats(userId);
      const firstDay = lifetimeRow.first_activity_day ?? null;
      rangeFrom =
        firstDay?.trim()?.length ?
          (parseIsoDateOnly(firstDay.trim()) ?? todayUtc)
        : todayUtc;
      rangeTo = todayUtc;
      fullHistoryInsights = true;
    }
    if (!rangeFrom || !rangeTo) {
      return reply.status(400).send({ error: "Invalid from/to date" });
    }
    if (rangeFrom.getTime() > rangeTo.getTime()) {
      return reply.status(400).send({ error: "From date cannot be after To date" });
    }
    if (rangeTo.getTime() > todayUtc.getTime()) {
      return reply.status(400).send({ error: "To date cannot be in the future" });
    }

    const dismissedCardIds = new Set(
      (parsedQuery.dismissed ?? "")
        .split(",")
        .map((rawId) => rawId.trim())
        .filter(Boolean),
    );

    const payload = await buildInsightsPayload({
      userId,
      rangeFromInclusive: rangeFrom,
      rangeTo,
      dismissedCardIds,
      fullHistoryInsights,
    });

    return reply.send(payload);
  });
}
