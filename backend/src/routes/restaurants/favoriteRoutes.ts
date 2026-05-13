import type { FastifyInstance } from "fastify";
import { restaurantDatabase } from "../../database/restaurantDatabase.js";
import {
  isPrismaSchemaMissingError,
  schemaMissingResponse,
} from "../../services/restaurantPrismaErrors.js";
import { DEFAULT_USER_ID } from "./restaurantSchemas.js";

/**
 * Register favourite toggle endpoints:
 * - `POST   /api/restaurants/:placeId/favorite` — add to favourites.
 * - `DELETE /api/restaurants/:placeId/favorite` — remove from favourites.
 */
export async function registerFavoriteRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/restaurants/:placeId/favorite", async (request, reply) => {
    const params = request.params as { placeId: string };
    const userId = (request.headers["x-user-id"] as string | undefined) ?? DEFAULT_USER_ID;
    try {
      await restaurantDatabase.restaurantFavoriteUpsert({
        where: { placeId_userId: { placeId: params.placeId, userId } },
        update: {},
        create: { placeId: params.placeId, userId },
      });
    } catch (err) {
      if (isPrismaSchemaMissingError(err)) {
        return reply.status(503).send(schemaMissingResponse());
      }
      throw err;
    }
    return { ok: true };
  });

  app.delete("/api/restaurants/:placeId/favorite", async (request, reply) => {
    const params = request.params as { placeId: string };
    const userId = (request.headers["x-user-id"] as string | undefined) ?? DEFAULT_USER_ID;
    try {
      await restaurantDatabase.restaurantFavoriteDeleteMany({
        where: { placeId: params.placeId, userId },
      });
    } catch (err) {
      if (isPrismaSchemaMissingError(err)) {
        return reply.status(503).send(schemaMissingResponse());
      }
      throw err;
    }
    return { ok: true };
  });
}
