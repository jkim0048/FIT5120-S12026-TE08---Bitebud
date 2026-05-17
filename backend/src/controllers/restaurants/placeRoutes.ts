import type { FastifyInstance } from "fastify";
import {
  isPrismaSchemaMissingError,
  schemaMissingResponse,
} from "../../services/restaurantPrismaErrors.js";
import {
  getPlaceDetails,
  upsertPlaceFromNominatim,
} from "../../services/restaurantPlaceService.js";
import {
  DEFAULT_USER_ID,
  createFromNominatimSchema,
} from "./restaurantSchemas.js";

/**
 * Register place endpoints:
 * - `POST /api/restaurants/from-nominatim` — upsert a place from a Nominatim selection.
 * - `GET  /api/restaurants/:placeId/details` — full place + reviews + favourite + summary.
 */
export async function registerPlaceRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/restaurants/from-nominatim", async (request, reply) => {
    const parsed = createFromNominatimSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid nominatim place payload" });
    }
    try {
      return await upsertPlaceFromNominatim(parsed.data);
    } catch (err) {
      if (isPrismaSchemaMissingError(err)) {
        return reply.status(503).send(schemaMissingResponse());
      }
      throw err;
    }
  });

  app.get("/api/restaurants/:placeId/details", async (request, reply) => {
    try {
      const params = request.params as { placeId: string };
      const userId = (request.headers["x-user-id"] as string | undefined) ?? DEFAULT_USER_ID;
      const result = await getPlaceDetails(params.placeId, userId);
      if ("kind" in result && result.kind === "not_found") {
        return reply.status(404).send({ error: "Restaurant not found" });
      }
      return result;
    } catch (err) {
      if (isPrismaSchemaMissingError(err)) {
        return reply.status(503).send(schemaMissingResponse());
      }
      throw err;
    }
  });
}
