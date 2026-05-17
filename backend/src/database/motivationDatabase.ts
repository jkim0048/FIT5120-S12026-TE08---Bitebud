import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";

const RECENT_REVIEWS_FOR_INSIGHTS = 80;
const ELIGIBLE_RECIPE_EVENTS_LIMIT = 300;

/** Fetch the daily motivation row for a user and local date, or `null` if not yet created. */
export async function findMotivationDailyByUserDate(userId: string, localDate: Date) {
  return prisma.motivationDailyActivity.findUnique({
    where: { userId_localDate: { userId, localDate } },
  });
}

/** Insert or update a user's per-day eligible activity counts. */
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

/** Append a motivation audit event (streak increment, duplicate, freeze, reset, etc.). */
export async function createMotivationEvent(data: Prisma.MotivationEventCreateInput): Promise<void> {
  await prisma.motivationEvent.create({ data });
}

/** Fetch the motivation profile row for a user (current streak, longest, freeze week, etc.). */
export async function findMotivationProfile(userId: string) {
  return prisma.motivationProfile.findUnique({ where: { userId } });
}

/** Create the motivation profile row for a brand-new active user. */
export async function createMotivationProfile(data: Prisma.MotivationProfileCreateInput) {
  return prisma.motivationProfile.create({ data });
}

/** Patch the motivation profile row (streak counts, last active date, freeze week). */
export async function updateMotivationProfile(
  userId: string,
  data: Prisma.MotivationProfileUpdateInput,
): Promise<void> {
  await prisma.motivationProfile.update({ where: { userId }, data });
}

/** Find the most recent `streak_reset` event for a user (used to show a comeback toast). */
export async function findLatestStreakResetEvent(userId: string) {
  return prisma.motivationEvent.findFirst({
    where: { userId, eventType: "streak_reset" },
    orderBy: { createdAt: "desc" },
  });
}

/** Stream every daily-counts row for a user (used to total eligible activity). */
export async function findMotivationDailyRowsForUser(userId: string) {
  return prisma.motivationDailyActivity.findMany({
    where: { userId },
    select: { counts: true },
  });
}

/** Stream every daily activity row for a user, oldest first (used to build calendar views). */
export async function findMotivationDailyRowsOrdered(userId: string) {
  return prisma.motivationDailyActivity.findMany({
    where: { userId },
    orderBy: { localDate: "asc" },
  });
}

/** Fetch the most recent restaurant reviews for insights (includes place join, capped). */
export async function findRestaurantReviewsForInsights(userId: string) {
  return prisma.restaurantReview.findMany({
    where: { userId },
    include: { place: true },
    orderBy: { createdAt: "desc" },
    take: RECENT_REVIEWS_FOR_INSIGHTS,
  });
}

/** Fetch the most recent motivation events tagged `eligible_activity` (for cooking-cadence insights). */
export async function findEligibleRecipeEvents(userId: string) {
  return prisma.motivationEvent.findMany({
    where: { userId, eventType: "eligible_activity" },
    select: { metadata: true, localDate: true },
    take: ELIGIBLE_RECIPE_EVENTS_LIMIT,
  });
}

/** Look up `totalTimeMinutes` for a batch of recipe ids; returns empty array when `ids` is empty. */
export async function findRecipesTotalTimeByIds(ids: string[]) {
  if (ids.length === 0) return [];
  return prisma.recipe.findMany({
    where: { id: { in: ids } },
    select: { totalTimeMinutes: true },
  });
}
