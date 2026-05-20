import type { FastifyInstance } from "fastify";
import {
  searchRestaurants,
  suggestLocations,
  suggestPlaces,
  suggestUnified,
} from "../../services/restaurantSearchService.js";
import {
  DEFAULT_USER_ID,
  locationSuggestQuerySchema,
  placeSuggestQuerySchema,
  searchQuerySchema,
  unifiedSuggestQuerySchema,
} from "./restaurantSchemas.js";

/**
 * Register restaurant search endpoints (thin handlers → restaurantSearchService).
 */
export async function registerSearchRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/restaurants/location-suggest", async (request, reply) => {
    const parsed = locationSuggestQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid suggest parameters", suggestions: [] });
    }
    const { q, limit } = parsed.data;
    return suggestLocations(q, limit);
  });

  app.get("/api/restaurants/place-suggest", async (request, reply) => {
    const parsed = placeSuggestQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid suggest parameters", suggestions: [] });
    }
    const { q, lat, lon, suburb, limit } = parsed.data;
    return suggestPlaces({ q, lat, lon, suburb, limit });
  });

  app.get("/api/restaurants/search-suggest", async (request, reply) => {
    const parsed = unifiedSuggestQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid suggest parameters", areas: [], places: [] });
    }
    const { q, lat, lon, suburb, limit } = parsed.data;
    return suggestUnified({ q, lat, lon, suburb, limit });
  });

  app.get("/api/restaurants/search", async (request, reply) => {
    const parsed = searchQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid search parameters" });
    }
    const userId = (request.headers["x-user-id"] as string | undefined) ?? DEFAULT_USER_ID;
    const { q, lat, lon, suburb } = parsed.data;
    return searchRestaurants({ q, lat, lon, suburb, userId });
  });
}
