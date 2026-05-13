import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import {
  ensureRestaurantSeedData,
  restaurantDatabase,
} from "../../database/restaurantDatabase.js";
import { comfortBadge } from "../../services/restaurantNominatimClient.js";
import {
  isPrismaSchemaMissingError,
  schemaMissingResponse,
} from "../../services/restaurantPrismaErrors.js";
import {
  DEFAULT_USER_ID,
  createFromNominatimSchema,
} from "./restaurantSchemas.js";

const PLACE_DETAILS_RECENT_LIMIT = 3;
const PLACE_DETAILS_REVIEWS_LIMIT = 20;

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
      const payload = parsed.data;
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
    } catch (err) {
      if (isPrismaSchemaMissingError(err)) {
        return reply.status(503).send(schemaMissingResponse());
      }
      throw err;
    }
  });

  app.get("/api/restaurants/:placeId/details", async (request, reply) => {
    try {
      await ensureRestaurantSeedData();
    } catch (err) {
      if (isPrismaSchemaMissingError(err)) {
        return reply.status(503).send(schemaMissingResponse());
      }
      throw err;
    }
    const params = request.params as { placeId: string };
    const userId = (request.headers["x-user-id"] as string | undefined) ?? DEFAULT_USER_ID;
    const place = await restaurantDatabase.restaurantPlaceFindUnique({
      where: { id: params.placeId },
      include: { reviews: true, favorites: { where: { userId } } },
    });
    if (!place) {
      return reply.status(404).send({ error: "Restaurant not found" });
    }

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
  });
}
