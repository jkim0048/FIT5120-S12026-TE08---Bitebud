import { z } from "zod";

/** Demo placeholder used when an `x-user-id` header is missing (anonymous user). */
export const DEFAULT_USER_ID = "demo-user";

/** Query schema for `GET /api/restaurants/search`: text + optional lat/lon + suburb. */
export const searchQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  lat: z.coerce.number().optional(),
  lon: z.coerce.number().optional(),
  suburb: z.string().trim().max(160).optional(),
});

/** Query schema for `GET /api/restaurants/location-suggest`: free-text + result-count cap. */
export const locationSuggestQuerySchema = z.object({
  q: z.string().trim().min(2).max(80),
  limit: z.coerce.number().int().min(1).max(12).optional(),
});

/** Query schema for `GET /api/restaurants/place-suggest`: restaurant name autocomplete. */
export const placeSuggestQuerySchema = z.object({
  q: z.string().trim().min(2).max(120),
  lat: z.coerce.number().optional(),
  lon: z.coerce.number().optional(),
  suburb: z.string().trim().max(160).optional(),
  limit: z.coerce.number().int().min(1).max(12).optional(),
});

/** Query schema for `GET /api/restaurants/search-suggest`: unified area + place autocomplete. */
export const unifiedSuggestQuerySchema = placeSuggestQuerySchema;

/** Body schema for `POST /api/restaurants/:placeId/reviews/rating`: 5-axis sensory rating. */
export const ratingBodySchema = z.object({
  overallRating: z.number().min(0).max(5),
  noiseRating: z.number().int().min(1).max(5),
  musicRating: z.number().int().min(1).max(5),
  lightRating: z.number().int().min(1).max(5),
  crowdsRating: z.number().int().min(1).max(5),
  smellsRating: z.number().int().min(1).max(5),
});

/** Body schema for `PATCH /api/restaurants/reviews/:reviewId/best-time`: meal blocks, time-of-day, days-of-week. */
export const bestTimeBodySchema = z.object({
  bestMealBlocks: z.array(z.string().trim().min(1)).max(6),
  bestTimesOfDay: z.array(z.string().trim().min(1)).max(6),
  bestDaysOfWeek: z.array(z.string().trim().min(1)).max(7),
});

/** Body schema for `POST /api/restaurants/from-nominatim`: upsert payload for an OSM place. */
export const createFromNominatimSchema = z.object({
  nominatimPlaceId: z.string().trim().min(1),
  osmType: z.string().trim().optional(),
  osmId: z.string().trim().optional(),
  name: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  cuisine: z.string().trim().optional(),
  address: z.string().trim().optional(),
  suburb: z.string().trim().optional(),
  latitude: z.number(),
  longitude: z.number(),
  extratags: z.record(z.string(), z.string()).optional(),
});
