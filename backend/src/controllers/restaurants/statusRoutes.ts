import type { FastifyInstance } from "fastify";
import {
  isPrismaSchemaMissingError,
  schemaMissingResponse,
} from "../../services/restaurantPrismaErrors.js";
import { getRestaurantDbStatus } from "../../services/restaurantInteractionService.js";

/** Register `GET /api/restaurants/status` — quick health check returning DB readiness mode. */
export async function registerStatusRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/restaurants/status", async (_request, reply) => {
    try {
      return await getRestaurantDbStatus();
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
