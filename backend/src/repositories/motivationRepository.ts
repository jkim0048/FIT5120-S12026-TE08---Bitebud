import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";

export async function findMotivationDailyByUserDate(userId: string, localDate: Date) {
  return prisma.motivationDailyActivity.findUnique({
    where: { userId_localDate: { userId, localDate } },
  });
}

export async function upsertMotivationDaily(
  userId: string,
  localDate: Date,
  counts: Record<string, number>,
): Promise<void> {
  await prisma.motivationDailyActivity.upsert({
    where: { userId_localDate: { userId, localDate } },
    create: { userId, localDate, counts: counts as object },
    update: { counts: counts as object },
  });
}

export async function createMotivationEvent(data: Prisma.MotivationEventCreateInput): Promise<void> {
  await prisma.motivationEvent.create({ data });
}

export async function findMotivationProfile(userId: string) {
  return prisma.motivationProfile.findUnique({ where: { userId } });
}

export async function createMotivationProfile(data: Prisma.MotivationProfileCreateInput) {
  return prisma.motivationProfile.create({ data });
}

export async function updateMotivationProfile(
  userId: string,
  data: Prisma.MotivationProfileUpdateInput,
): Promise<void> {
  await prisma.motivationProfile.update({ where: { userId }, data });
}

export async function findLatestStreakResetEvent(userId: string) {
  return prisma.motivationEvent.findFirst({
    where: { userId, eventType: "streak_reset" },
    orderBy: { createdAt: "desc" },
  });
}

export async function findMotivationDailyRowsForUser(userId: string) {
  return prisma.motivationDailyActivity.findMany({
    where: { userId },
    select: { counts: true },
  });
}

export async function findMotivationDailyRowsOrdered(userId: string) {
  return prisma.motivationDailyActivity.findMany({
    where: { userId },
    orderBy: { localDate: "asc" },
  });
}

export async function findRestaurantReviewsForInsights(userId: string) {
  return prisma.restaurantReview.findMany({
    where: { userId },
    include: { place: true },
    orderBy: { createdAt: "desc" },
    take: 80,
  });
}

export async function findEligibleRecipeEvents(userId: string) {
  return prisma.motivationEvent.findMany({
    where: { userId, eventType: "eligible_activity" },
    select: { metadata: true, localDate: true },
    take: 300,
  });
}

export async function findRecipesTotalTimeByIds(ids: string[]) {
  if (ids.length === 0) return [];
  return prisma.recipe.findMany({
    where: { id: { in: ids } },
    select: { totalTimeMinutes: true },
  });
}
