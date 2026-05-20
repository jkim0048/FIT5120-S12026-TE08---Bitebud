import type { FastifyInstance } from "fastify";
import {
  isPrismaSchemaMissingError,
  schemaMissingResponse,
} from "../../services/restaurantPrismaErrors.js";
import {
  getReviewById,
  listMyReviews,
  saveRatingReview,
  updateReviewBestTime,
} from "../../services/restaurantInteractionService.js";
import {
  DEFAULT_USER_ID,
  bestTimeBodySchema,
  ratingBodySchema,
} from "./restaurantSchemas.js";

/**
 * Register review endpoints:
 * - `GET   /api/restaurants/my-reviews` — current user's review list.
 * - `POST  /api/restaurants/:placeId/reviews/rating` — create/update a comfort rating review.
 * - `GET   /api/restaurants/reviews/:reviewId` — fetch one review by id (current user only).
 * - `PATCH /api/restaurants/reviews/:reviewId/best-time` — update the best-time arrays on a review.
 */
export async function registerReviewRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/restaurants/my-reviews", async (request, reply) => {
    const userId = (request.headers["x-user-id"] as string | undefined) ?? "";
    if (!userId.trim()) {
      return reply.status(401).send({ error: "Missing user id", reviews: [] });
    }
    try {
      return await listMyReviews(userId);
    } catch (err) {
      if (isPrismaSchemaMissingError(err)) {
        return reply.status(503).send(schemaMissingResponse());
      }
      throw err;
    }
  });

  app.post("/api/restaurants/:placeId/reviews/rating", async (request, reply) => {
    const params = request.params as { placeId: string };
    const parsed = ratingBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid rating payload" });
    }
    const userId = (request.headers["x-user-id"] as string | undefined) ?? DEFAULT_USER_ID;
    try {
      return await saveRatingReview(params.placeId, userId, parsed.data);
    } catch (err) {
      if (isPrismaSchemaMissingError(err)) {
        return reply.status(503).send(schemaMissingResponse());
      }
      throw err;
    }
  });

  app.get("/api/restaurants/reviews/:reviewId", async (request, reply) => {
    const params = request.params as { reviewId: string };
    const userId = (request.headers["x-user-id"] as string | undefined) ?? DEFAULT_USER_ID;
    try {
      const result = await getReviewById(params.reviewId, userId);
      if ("kind" in result && result.kind === "not_found") {
        return reply.status(404).send({ error: "Review not found" });
      }
      return result;
    } catch (err) {
      if (isPrismaSchemaMissingError(err)) {
        return reply.status(503).send(schemaMissingResponse());
      }
      throw err;
    }
  });

  app.patch("/api/restaurants/reviews/:reviewId/best-time", async (request, reply) => {
    const params = request.params as { reviewId: string };
    const parsed = bestTimeBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid best-time payload" });
    }
    try {
      return await updateReviewBestTime(params.reviewId, parsed.data);
    } catch (err) {
      if (isPrismaSchemaMissingError(err)) {
        return reply.status(503).send(schemaMissingResponse());
      }
      throw err;
    }
  });
}
