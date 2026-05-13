import type { FastifyInstance } from "fastify";
import { registerFavoriteRoutes } from "./favoriteRoutes.js";
import { registerPlaceRoutes } from "./placeRoutes.js";
import { registerReviewRoutes } from "./reviewRoutes.js";
import { registerSearchRoutes } from "./searchRoutes.js";
import { registerStatusRoutes } from "./statusRoutes.js";

/**
 * Register every `/api/restaurants/*` endpoint group on the Fastify app.
 *
 * Registration order matters: list-style routes (`/my-reviews`, `/location-suggest`,
 * `/status`, `/search`, `/from-nominatim`, `/reviews/:reviewId`) must be added before
 * the `:placeId/*` style routes so Fastify matches the literal segments first.
 */
export async function registerRestaurantRoutes(app: FastifyInstance): Promise<void> {
  await registerReviewRoutes(app);
  await registerSearchRoutes(app);
  await registerStatusRoutes(app);
  await registerPlaceRoutes(app);
  await registerFavoriteRoutes(app);
}
