import { prisma } from "../prisma.js";

const SEEDED_PLACES = [
  {
    name: "Higher Ground",
    displayName: "Higher Ground, Little Bourke Street, Melbourne VIC",
    cuisine: "Cafe / Australian",
    address: "650 Little Bourke St, Melbourne VIC",
    suburb: "Melbourne",
    latitude: -37.8155,
    longitude: 144.9545,
    extratags: { wheelchair: "yes", outdoor_seating: "yes" },
  },
  {
    name: "Tipo 00",
    displayName: "Tipo 00, Little Bourke Street, Melbourne VIC",
    cuisine: "Italian",
    address: "361 Little Bourke St, Melbourne VIC",
    suburb: "Melbourne",
    latitude: -37.8133,
    longitude: 144.9636,
    extratags: { reservation: "recommended" },
  },
  {
    name: "Lune Croissanterie",
    displayName: "Lune Croissanterie, Rose Street, Fitzroy VIC",
    cuisine: "Bakery",
    address: "119 Rose St, Fitzroy VIC",
    suburb: "Fitzroy",
    latitude: -37.8024,
    longitude: 144.9783,
    extratags: { takeaway: "yes" },
  },
  {
    name: "Rice Paper Scissors",
    displayName: "Rice Paper Scissors, Liverpool Street, Melbourne VIC",
    cuisine: "Thai / Vietnamese",
    address: "15 Hardware Ln, Melbourne VIC",
    suburb: "Melbourne",
    latitude: -37.8124,
    longitude: 144.9617,
    extratags: { outdoor_seating: "yes" },
  },
  {
    name: "Green Man's Arms",
    displayName: "Green Man's Arms, Lygon Street, Carlton VIC",
    cuisine: "Vegetarian",
    address: "418 Lygon St, Carlton VIC",
    suburb: "Carlton",
    latitude: -37.7986,
    longitude: 144.9677,
    extratags: { vegetarian: "yes", vegan: "yes" },
  },
] as const;

/** Seed demo Melbourne restaurants when DB is empty (dev/demo UX). */
export async function ensureRestaurantSeedData(): Promise<void> {
  const existing = await prisma.restaurantPlace.count();
  if (existing > 0) return;
  for (const place of SEEDED_PLACES) {
    const created = await prisma.restaurantPlace.create({
      data: {
        ...place,
        extratags: place.extratags as object,
      },
    });
    await prisma.restaurantReview.createMany({
      data: [
        {
          placeId: created.id,
          userId: "seed-user-1",
          overallRating: 4.2,
          noiseRating: 4,
          musicRating: 3,
          lightRating: 4,
          crowdsRating: 3,
          smellsRating: 4,
          bestMealBlocks: ["Brunch"],
          bestTimesOfDay: ["Morning"],
          bestDaysOfWeek: ["Monday", "Tuesday"],
        },
        {
          placeId: created.id,
          userId: "seed-user-2",
          overallRating: 3.8,
          noiseRating: 3,
          musicRating: 3,
          lightRating: 4,
          crowdsRating: 2,
          smellsRating: 4,
          bestMealBlocks: ["Lunch"],
          bestTimesOfDay: ["Midday"],
          bestDaysOfWeek: ["Wednesday", "Thursday"],
        },
      ],
    });
  }
}

/** Restaurant persistence — single owner for places, reviews, and favourites Prisma calls. */
export const restaurantDatabase = {
  restaurantPlaceCount: () => prisma.restaurantPlace.count(),

  restaurantPlaceFindMany: prisma.restaurantPlace.findMany.bind(prisma.restaurantPlace),

  restaurantPlaceFindUnique: prisma.restaurantPlace.findUnique.bind(prisma.restaurantPlace),

  restaurantPlaceUpsert: prisma.restaurantPlace.upsert.bind(prisma.restaurantPlace),

  restaurantReviewFindMany: prisma.restaurantReview.findMany.bind(prisma.restaurantReview),

  restaurantReviewFindFirst: prisma.restaurantReview.findFirst.bind(prisma.restaurantReview),

  restaurantReviewCreate: prisma.restaurantReview.create.bind(prisma.restaurantReview),

  restaurantReviewUpdate: prisma.restaurantReview.update.bind(prisma.restaurantReview),

  restaurantReviewCount: prisma.restaurantReview.count.bind(prisma.restaurantReview),

  restaurantFavoriteUpsert: prisma.restaurantFavorite.upsert.bind(prisma.restaurantFavorite),

  restaurantFavoriteDeleteMany: prisma.restaurantFavorite.deleteMany.bind(prisma.restaurantFavorite),
};
