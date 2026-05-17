import type { Prisma } from "@prisma/client";
import { restaurantDatabase } from "../database/restaurantDatabase.js";

const MY_REVIEWS_PAGE_SIZE = 200;

/** Add a restaurant place to the user's favourites. */
export async function addFavorite(placeId: string, userId: string) {
  await restaurantDatabase.restaurantFavoriteUpsert({
    where: { placeId_userId: { placeId, userId } },
    update: {},
    create: { placeId, userId },
  });
  return { ok: true };
}

/** Remove a restaurant place from the user's favourites. */
export async function removeFavorite(placeId: string, userId: string) {
  await restaurantDatabase.restaurantFavoriteDeleteMany({
    where: { placeId, userId },
  });
  return { ok: true };
}

/** List the current user's restaurant reviews with place details. */
export async function listMyReviews(userId: string) {
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
}

type RatingReviewData = Omit<
  Prisma.RestaurantReviewUncheckedCreateInput,
  "placeId" | "userId" | "id"
>;

/** Create or update a comfort rating review for a place. */
export async function saveRatingReview(
  placeId: string,
  userId: string,
  data: RatingReviewData,
) {
  const existing = await restaurantDatabase.restaurantReviewFindFirst({
    where: { placeId, userId },
    orderBy: { createdAt: "desc" },
  });
  const savedReview = existing
    ? await restaurantDatabase.restaurantReviewUpdate({
        where: { id: existing.id },
        data,
      })
    : await restaurantDatabase.restaurantReviewCreate({
        data: { placeId, userId, ...data },
      });
  return { ok: true, reviewId: savedReview.id };
}

export type ReviewNotFound = { kind: "not_found" };

/** Fetch one review by id for the current user. */
export async function getReviewById(reviewId: string, userId: string) {
  const review = await restaurantDatabase.restaurantReviewFindFirst({
    where: { id: reviewId, userId },
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
  if (!review) return { kind: "not_found" } as ReviewNotFound;
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
}

type BestTimeReviewData = Pick<
  Prisma.RestaurantReviewUpdateInput,
  "bestMealBlocks" | "bestTimesOfDay" | "bestDaysOfWeek"
>;

/** Update best-time arrays on an existing review. */
export async function updateReviewBestTime(reviewId: string, data: BestTimeReviewData) {
  const updated = await restaurantDatabase.restaurantReviewUpdate({
    where: { id: reviewId },
    data,
  });
  return { ok: true, reviewId: updated.id };
}

/** Quick health check returning whether restaurant DB tables are ready. */
export async function getRestaurantDbStatus() {
  await restaurantDatabase.restaurantPlaceCount();
  return { ok: true, dbReady: true, mode: "full" as const };
}
