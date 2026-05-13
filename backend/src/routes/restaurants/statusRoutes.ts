import type { FastifyInstance } from "fastify";
import { restaurantDatabase } from "../../database/restaurantDatabase.js";
import {
  isPrismaSchemaMissingError,
  schemaMissingResponse,
} from "../../services/restaurantPrismaErrors.js";

/** Register `GET /api/restaurants/status` — quick health check returning DB readiness mode. */
export async function registerStatusRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/restaurants/status", async (_request, reply) => {
    try {
      await restaurantDatabase.restaurantPlaceCount();
      return { ok: true, dbReady: true, mode: "full" };
    } catch (err) {
      if (isPrismaSchemaMissingError(err)) {
        return reply.status(503).send({
          ok: false,
          dbReady: false,
          mode: "fallback",
          ...schemaMissingResponse(),
        });
      }
      throw err;
    }
  });
}
