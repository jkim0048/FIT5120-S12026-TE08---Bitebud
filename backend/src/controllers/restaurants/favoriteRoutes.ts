import type { FastifyInstance } from "fastify";
import {
  isPrismaSchemaMissingError,
  schemaMissingResponse,
} from "../../services/restaurantPrismaErrors.js";
import { addFavorite, removeFavorite } from "../../services/restaurantInteractionService.js";
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
      return await addFavorite(params.placeId, userId);
    } catch (err) {
      if (isPrismaSchemaMissingError(err)) {
        return reply.status(503).send(schemaMissingResponse());
      }
      throw err;
    }
  });

  app.delete("/api/restaurants/:placeId/favorite", async (request, reply) => {
    const params = request.params as { placeId: string };
    const userId = (request.headers["x-user-id"] as string | undefined) ?? DEFAULT_USER_ID;
    try {
      return await removeFavorite(params.placeId, userId);
    } catch (err) {
      if (isPrismaSchemaMissingError(err)) {
        return reply.status(503).send(schemaMissingResponse());
      }
      throw err;
    }
  });
}
