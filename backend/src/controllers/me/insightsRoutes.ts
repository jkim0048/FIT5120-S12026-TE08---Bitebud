import type { FastifyInstance } from "fastify";
import { parseBiteBudUserId } from "../../biteBudUserId.js";
import {
  buildInsightsPayload,
  resolveInsightsDateRange,
} from "../../services/insightsService.js";
import { insightsQuerySchema } from "./meSchemas.js";

/** Register `GET /api/me/insights` — multi-card cooking + dining insights for the user's recent activity. */
export async function registerInsightsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/me/insights", async (request, reply) => {
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) return reply.status(400).send({ error: "Missing or invalid X-User-Id" });

    const parsedQuery = insightsQuerySchema.parse(
      (request.query as Record<string, unknown>) ?? {},
    );

    const rangeResult = await resolveInsightsDateRange(
      userId,
      parsedQuery.from,
      parsedQuery.to,
    );
    if ("kind" in rangeResult) {
      if (rangeResult.kind === "invalid_range") {
        return reply.status(400).send({ error: "Invalid from/to date" });
      }
      if (rangeResult.kind === "from_after_to") {
        return reply.status(400).send({ error: "From date cannot be after To date" });
      }
      return reply.status(400).send({ error: "To date cannot be in the future" });
    }

    const dismissedCardIds = new Set(
      (parsedQuery.dismissed ?? "")
        .split(",")
        .map((rawId) => rawId.trim())
        .filter(Boolean),
    );

    const { rangeFrom, rangeTo, fullHistoryInsights } = rangeResult;
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
