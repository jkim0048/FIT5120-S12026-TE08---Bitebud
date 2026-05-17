import type { FastifyInstance } from "fastify";
import { restaurantDatabase } from "../../database/restaurantDatabase.js";
import {
  isPrismaSchemaMissingError,
  schemaMissingResponse,
} from "../../services/restaurantPrismaErrors.js";
import {
  DEFAULT_USER_ID,
  bestTimeBodySchema,
  ratingBodySchema,
} from "./restaurantSchemas.js";

const MY_REVIEWS_PAGE_SIZE = 200;

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
      const reviews = await restaurantDatabase.restaurantReviewFindMany({
        where: { userId },
        include: { place: true },
        orderBy: { updatedAt: "desc" },
        take: MY_REVIEWS_PAGE_SIZE,
      });
      return {
        reviews: reviews.map((review) => ({
          place: {
            id: review.placeId,
            name: review.place.name,
            displayName: review.place.displayName,
            address: review.place.address,
            cuisine: review.place.cuisine,
            suburb: review.place.suburb,
          },
          review: {
            id: review.id,
            overallRating: review.overallRating,
            noiseRating: review.noiseRating,
            musicRating: review.musicRating,
            lightRating: review.lightRating,
            crowdsRating: review.crowdsRating,
            smellsRating: review.smellsRating,
            bestMealBlocks: (review.bestMealBlocks as string[]) ?? [],
            bestTimesOfDay: (review.bestTimesOfDay as string[]) ?? [],
            bestDaysOfWeek: (review.bestDaysOfWeek as string[]) ?? [],
            createdAt: review.createdAt,
            updatedAt: review.updatedAt,
          },
        })),
      };
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
    let savedReview;
    try {
      const existing = await restaurantDatabase.restaurantReviewFindFirst({
        where: { placeId: params.placeId, userId },
        orderBy: { createdAt: "desc" },
      });
      savedReview = existing
        ? await restaurantDatabase.restaurantReviewUpdate({
            where: { id: existing.id },
            data: parsed.data,
          })
        : await restaurantDatabase.restaurantReviewCreate({
            data: { placeId: params.placeId, userId, ...parsed.data },
          });
    } catch (err) {
      if (isPrismaSchemaMissingError(err)) {
        return reply.status(503).send(schemaMissingResponse());
      }
      throw err;
    }
    return { ok: true, reviewId: savedReview.id };
  });

  app.get("/api/restaurants/reviews/:reviewId", async (request, reply) => {
    const params = request.params as { reviewId: string };
    const userId = (request.headers["x-user-id"] as string | undefined) ?? DEFAULT_USER_ID;
    let review;
    try {
      review = await restaurantDatabase.restaurantReviewFindFirst({
        where: { id: params.reviewId, userId },
        select: {
          id: true,
          placeId: true,
          overallRating: true,
          noiseRating: true,
          musicRating: true,
          lightRating: true,
          crowdsRating: true,
          smellsRating: true,
          bestMealBlocks: true,
          bestTimesOfDay: true,
          bestDaysOfWeek: true,
        },
      });
    } catch (err) {
      if (isPrismaSchemaMissingError(err)) {
        return reply.status(503).send(schemaMissingResponse());
      }
      throw err;
    }
    if (!review) {
      return reply.status(404).send({ error: "Review not found" });
    }
    return {
      reviewId: review.id,
      placeId: review.placeId,
      overallRating: Number(review.overallRating),
      noiseRating: review.noiseRating,
      musicRating: review.musicRating,
      lightRating: review.lightRating,
      crowdsRating: review.crowdsRating,
      smellsRating: review.smellsRating,
      bestMealBlocks: (review.bestMealBlocks as string[]) ?? [],
      bestTimesOfDay: (review.bestTimesOfDay as string[]) ?? [],
      bestDaysOfWeek: (review.bestDaysOfWeek as string[]) ?? [],
    };
  });

  app.patch("/api/restaurants/reviews/:reviewId/best-time", async (request, reply) => {
    const params = request.params as { reviewId: string };
    const parsed = bestTimeBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid best-time payload" });
    }
    let updated;
    try {
      updated = await restaurantDatabase.restaurantReviewUpdate({
        where: { id: params.reviewId },
        data: parsed.data,
      });
    } catch (err) {
      if (isPrismaSchemaMissingError(err)) {
        return reply.status(503).send(schemaMissingResponse());
      }
      throw err;
    }
    return { ok: true, reviewId: updated.id };
  });
}
