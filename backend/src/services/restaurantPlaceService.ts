import type { Prisma } from "@prisma/client";
import {
  ensureRestaurantSeedData,
  restaurantDatabase,
} from "../database/restaurantDatabase.js";
import { comfortBadge } from "./restaurantNominatimClient.js";

const PLACE_DETAILS_RECENT_LIMIT = 3;
const PLACE_DETAILS_REVIEWS_LIMIT = 20;

export type PlaceNotFound = { kind: "not_found" };

/** Upsert a restaurant place from a Nominatim selection payload. */
export async function upsertPlaceFromNominatim(payload: {
  nominatimPlaceId: string;
  name: string;
  displayName: string;
  cuisine?: string | null;
  address?: string | null;
  suburb?: string | null;
  latitude: number;
  longitude: number;
  extratags?: Record<string, unknown>;
  osmType?: string | null;
  osmId?: string | null;
}) {
  const place = await restaurantDatabase.restaurantPlaceUpsert({
    where: { nominatimPlaceId: payload.nominatimPlaceId },
    update: {
      name: payload.name,
      displayName: payload.displayName,
      cuisine: payload.cuisine ?? null,
      address: payload.address ?? null,
      suburb: payload.suburb ?? null,
      latitude: payload.latitude,
      longitude: payload.longitude,
      extratags: (payload.extratags ?? {}) as Prisma.InputJsonValue,
      osmType: payload.osmType ?? null,
      osmId: payload.osmId ?? null,
    },
    create: {
      nominatimPlaceId: payload.nominatimPlaceId,
      name: payload.name,
      displayName: payload.displayName,
      cuisine: payload.cuisine ?? null,
      address: payload.address ?? null,
      suburb: payload.suburb ?? null,
      latitude: payload.latitude,
      longitude: payload.longitude,
      extratags: (payload.extratags ?? {}) as Prisma.InputJsonValue,
      osmType: payload.osmType ?? null,
      osmId: payload.osmId ?? null,
    },
  });
  return { ok: true, placeId: place.id };
}

/** Full place details with reviews, favourite flag, and aggregated comfort summary. */
export async function getPlaceDetails(placeId: string, userId: string) {
  await ensureRestaurantSeedData();
  const place = await restaurantDatabase.restaurantPlaceFindUnique({
    where: { id: placeId },
    include: { reviews: true, favorites: { where: { userId } } },
  });
  if (!place) return { kind: "not_found" } as PlaceNotFound;

  const reviewCount = place.reviews.length;
  const userHasReview = place.reviews.some((review) => review.userId === userId);
  const averageOf = (key: keyof (typeof place.reviews)[number]) =>
    reviewCount > 0
      ? place.reviews.reduce(
          (runningSum, review) => runningSum + Number(review[key] ?? 0),
          0,
        ) / reviewCount
      : 0;
  const overall = averageOf("overallRating");

  return {
    place: {
      id: place.id,
      name: place.name,
      displayName: place.displayName,
      cuisine: place.cuisine,
      address: place.address,
      suburb: place.suburb,
      latitude: place.latitude,
      longitude: place.longitude,
    },
    summary: {
      reviewCount,
      userHasReview,
      overallRating: Number(overall.toFixed(1)),
      comfortBadge: comfortBadge(overall),
      noiseRating: Number(averageOf("noiseRating").toFixed(1)),
      musicRating: Number(averageOf("musicRating").toFixed(1)),
      lightRating: Number(averageOf("lightRating").toFixed(1)),
      crowdsRating: Number(averageOf("crowdsRating").toFixed(1)),
      smellsRating: Number(averageOf("smellsRating").toFixed(1)),
      recentBestMealBlocks: [
        ...new Set(
          place.reviews.flatMap((review) => (review.bestMealBlocks as string[]) ?? []),
        ),
      ].slice(0, PLACE_DETAILS_RECENT_LIMIT),
      recentBestTimesOfDay: [
        ...new Set(
          place.reviews.flatMap((review) => (review.bestTimesOfDay as string[]) ?? []),
        ),
      ].slice(0, PLACE_DETAILS_RECENT_LIMIT),
      recentBestDaysOfWeek: [
        ...new Set(
          place.reviews.flatMap((review) => (review.bestDaysOfWeek as string[]) ?? []),
        ),
      ].slice(0, PLACE_DETAILS_RECENT_LIMIT),
    },
    isFavorite: place.favorites.length > 0,
    reviews: place.reviews.slice(0, PLACE_DETAILS_REVIEWS_LIMIT).map((review) => ({
      id: review.id,
      userId: review.userId,
      overallRating: review.overallRating,
      noiseRating: review.noiseRating,
      musicRating: review.musicRating,
      lightRating: review.lightRating,
      crowdsRating: review.crowdsRating,
      smellsRating: review.smellsRating,
      bestMealBlocks: review.bestMealBlocks,
      bestTimesOfDay: review.bestTimesOfDay,
      bestDaysOfWeek: review.bestDaysOfWeek,
      createdAt: review.createdAt,
    })),
  };
}
