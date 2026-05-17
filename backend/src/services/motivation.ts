import type { Prisma } from "@prisma/client";
import { pgDateColumnToYmd } from "../calendarDate.js";
import {
  createMotivationEvent,
  createMotivationProfile,
  findEligibleRecipeEvents,
  findLatestStreakResetEvent,
  findMotivationDailyByUserDate,
  findMotivationDailyRowsForUser,
  findMotivationDailyRowsOrdered,
  findMotivationProfile,
  findRecipesTotalTimeByIds,
  findRestaurantReviewsForInsights,
  updateMotivationProfile,
  upsertMotivationDaily,
} from "../database/motivationDatabase.js";
import { recipeDatabase } from "../database/recipeDatabase.js";
import { restaurantDatabase } from "../database/restaurantDatabase.js";
import { findMonthActivityCounts } from "../database/userActivityDatabase.js";

export type MotivationActivityType = "recipe_completed" | "restaurant_review_submitted";

const COUNT_KEYS: Record<MotivationActivityType, string> = {
  recipe_completed: "recipe_completed",
  restaurant_review_submitted: "restaurant_review_submitted",
};

const MS_PER_DAY = 86_400_000;
const STREAK_RESET_TOAST_WINDOW_MS = 24 * 60 * 60 * 1000;
const STREAK_THREE_THRESHOLD = 3;
const MIN_RECIPES_FOR_TIMING_CARD = 3;
const MIN_REVIEWS_FOR_DINING_CARD = 3;
const MIN_QUIET_REVIEWS_FOR_CARD = 3;
const TIMING_BREAKPOINT_MINUTES = 30;
const MOTIVATION_TOTAL_THRESHOLD = 6;
const MOTIVATION_RECIPES_THRESHOLD = 3;
const MOTIVATION_REVIEWS_THRESHOLD = 3;
const CALM_NOISE_THRESHOLD = 2.5;
const CALM_CROWD_THRESHOLD = 2.5;
const LOW_NOISE_RATING_THRESHOLD = 2;
const GREAT_OVERALL_RATING_THRESHOLD = 4;

/** Parse a `YYYY-MM-DD` user-local date string into a UTC `Date` (midnight). */
export function parseLocalDateYmd(ymd: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!match) throw new Error("localDate must be YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error("invalid localDate");
  }
  return new Date(Date.UTC(year, month - 1, day));
}

/** Get the Monday-of-week (UTC) for the given UTC date. */
function mondayUtcOf(date: Date): Date {
  const dayOfWeek = date.getUTCDay();
  const offsetToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + offsetToMonday),
  );
}

/** Whole calendar-days difference between two UTC dates (positive when `later` is after `earlier`). */
function calendarDaysBetweenUtc(later: Date, earlier: Date): number {
  const laterMs = Date.UTC(later.getUTCFullYear(), later.getUTCMonth(), later.getUTCDate());
  const earlierMs = Date.UTC(earlier.getUTCFullYear(), earlier.getUTCMonth(), earlier.getUTCDate());
  return Math.round((laterMs - earlierMs) / MS_PER_DAY);
}

/** Normalise the stored JSON `counts` object into a strict `string → number` map (drops NaN entries). */
function readCounts(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const rawCounts = raw as Record<string, unknown>;
  const counts: Record<string, number> = {};
  for (const [countKey, countValue] of Object.entries(rawCounts)) {
    const numeric = typeof countValue === "number" ? countValue : Number(countValue);
    if (Number.isFinite(numeric)) counts[countKey] = numeric;
  }
  return counts;
}

function totalEligibleCount(counts: Record<string, number>): number {
  return (counts.recipe_completed ?? 0) + (counts.restaurant_review_submitted ?? 0);
}

async function sumEligibleFromDaily(userId: string): Promise<{
  recipe: number;
  review: number;
  total: number;
}> {
  const dailyRows = await findMotivationDailyRowsForUser(userId);
  let recipe = 0;
  let review = 0;
  for (const dailyRow of dailyRows) {
    const counts = readCounts(dailyRow.counts);
    recipe += counts.recipe_completed ?? 0;
    review += counts.restaurant_review_submitted ?? 0;
  }
  return { recipe, review, total: recipe + review };
}

export type RecordActivityResult = {
  currentStreak: number;
  longestStreak: number;
  duplicate: boolean;
  toastKey: string | null;
};

/**
 * Record one eligible activity (recipe completion or restaurant review) for the user and update streaks.
 *
 * Idempotent for repeated same-type activity on the same day (returns `duplicate: true`).
 * Returns the new streak length, longest streak, duplicate flag, and the toast key to display.
 */
export async function recordMotivationActivity(opts: {
  userId: string;
  type: MotivationActivityType;
  localDate: Date;
  metadata?: Record<string, unknown>;
}): Promise<RecordActivityResult> {
  const { userId, type, localDate, metadata } = opts;
  const key = COUNT_KEYS[type];

  const existingDaily = await findMotivationDailyByUserDate(userId, localDate);

  const prevCounts = readCounts(existingDaily?.counts);
  const prevTotal = totalEligibleCount(prevCounts);
  const prevTypeCount = prevCounts[key] ?? 0;

  const newCounts = { ...prevCounts, [key]: prevTypeCount + 1 };

  await upsertMotivationDaily(userId, localDate, newCounts);

  const duplicateSameType = prevTypeCount > 0;
  if (duplicateSameType) {
    await createMotivationEvent({
      userId,
      eventType: "duplicate_activity_same_type",
      localDate,
      metadata: { ...(metadata ?? {}), type } as object,
    } as Prisma.MotivationEventCreateInput);
    const profile = await findMotivationProfile(userId);
    return {
      currentStreak: profile?.currentStreak ?? 0,
      longestStreak: profile?.longestStreak ?? 0,
      duplicate: true,
      toastKey: null,
    };
  }

  const isFirstEligibleOfDay = prevTotal === 0;

  await createMotivationEvent({
    userId,
    eventType: "eligible_activity",
    localDate,
    metadata: { ...(metadata ?? {}), type } as object,
  } as Prisma.MotivationEventCreateInput);

  if (!isFirstEligibleOfDay) {
    const profile = await findMotivationProfile(userId);
    return {
      currentStreak: profile?.currentStreak ?? 0,
      longestStreak: profile?.longestStreak ?? 0,
      duplicate: false,
      toastKey: type === "recipe_completed" ? "recipe_done" : "review_helpful",
    };
  }

  let profile = await findMotivationProfile(userId);
  if (!profile) {
    profile = await createMotivationProfile({
      userId,
      currentStreak: 1,
      longestStreak: 1,
      lastActiveLocalDate: localDate,
    });
    await createMotivationEvent({
      userId,
      eventType: "streak_increment",
      localDate,
      metadata: { to: 1 } as object,
    } as Prisma.MotivationEventCreateInput);
    return {
      currentStreak: 1,
      longestStreak: 1,
      duplicate: false,
      toastKey: pickToastKey(type, 1),
    };
  }

  const lastActive = profile.lastActiveLocalDate;
  let newStreak = profile.currentStreak;
  let freezeWeekMonday: Date | undefined;

  if (!lastActive) {
    newStreak = 1;
  } else {
    const dayGap = calendarDaysBetweenUtc(localDate, lastActive);
    if (dayGap <= 0) {
      newStreak = profile.currentStreak;
    } else if (dayGap === 1) {
      newStreak = profile.currentStreak + 1;
    } else if (dayGap === 2) {
      const weekMonday = mondayUtcOf(localDate);
      const freezeWeek = profile.freezeUsedWeekStart;
      const freezeAlreadyUsedThisWeek =
        freezeWeek != null && mondayUtcOf(freezeWeek).getTime() === weekMonday.getTime();
      if (!freezeAlreadyUsedThisWeek) {
        newStreak = profile.currentStreak + 1;
        freezeWeekMonday = weekMonday;
        await createMotivationEvent({
          userId,
          eventType: "freeze_used",
          localDate,
          metadata: { weekMonday: weekMonday.toISOString().slice(0, 10) } as object,
        } as Prisma.MotivationEventCreateInput);
      } else {
        newStreak = 1;
        await createMotivationEvent({
          userId,
          eventType: "streak_reset",
          localDate,
          metadata: { reason: "gap_no_freeze" } as object,
        } as Prisma.MotivationEventCreateInput);
      }
    } else {
      newStreak = 1;
      await createMotivationEvent({
        userId,
        eventType: "streak_reset",
        localDate,
        metadata: { reason: "long_gap" } as object,
      } as Prisma.MotivationEventCreateInput);
    }
  }

  const longestStreak = Math.max(profile.longestStreak, newStreak);
  await updateMotivationProfile(userId, {
    currentStreak: newStreak,
    longestStreak,
    lastActiveLocalDate: localDate,
    ...(freezeWeekMonday != null ? { freezeUsedWeekStart: freezeWeekMonday } : {}),
  });

  await createMotivationEvent({
    userId,
    eventType: "streak_increment",
    localDate,
    metadata: { to: newStreak } as object,
  } as Prisma.MotivationEventCreateInput);

  let toastKey = pickToastKey(type, newStreak);
  if (newStreak === STREAK_THREE_THRESHOLD) {
    toastKey = "streak_three";
  }

  return {
    currentStreak: newStreak,
    longestStreak,
    duplicate: false,
    toastKey,
  };
}

/** Pick the post-activity toast key based on activity type and current streak length. */
function pickToastKey(type: MotivationActivityType, streak: number): string {
  if (streak === STREAK_THREE_THRESHOLD) return "streak_three";
  return type === "recipe_completed" ? "recipe_done" : "review_helpful";
}

/** Current motivation summary for the user: streak counts plus whether to show the comeback toast. */
export async function getMotivationSummary(userId: string): Promise<{
  currentStreak: number;
  longestStreak: number;
  showStartFresh: boolean;
  hasActivity: boolean;
}> {
  const profile = await findMotivationProfile(userId);
  const recentReset = await findLatestStreakResetEvent(userId);
  const showStartFresh = Boolean(
    recentReset && Date.now() - recentReset.createdAt.getTime() < STREAK_RESET_TOAST_WINDOW_MS,
  );
  const { total } = await sumEligibleFromDaily(userId);
  return {
    currentStreak: profile?.currentStreak ?? 0,
    longestStreak: profile?.longestStreak ?? 0,
    showStartFresh,
    hasActivity: total > 0,
  };
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Build the user's monthly motivation progress payload: per-day counts in the requested calendar month,
 * lifetime totals, current/longest streak, and overall active-day counters.
 */
export async function getMotivationProgress(
  userId: string,
  opts?: { year?: number; month?: number },
): Promise<{
  eligibleTotal: number;
  currentStreak: number;
  longestStreak: number;
  totalActiveDays: number;
  activeDaysThisMonth: number;
  daysInMonth: number;
  calendarYear: number;
  calendarMonth: number;
  calendarMonthDays: Array<{ date: string; count: number }>;
  breakdown: { recipe_completed: number; restaurant_review_submitted: number };
}> {
  const profile = await findMotivationProfile(userId);

  const dailyRows = await findMotivationDailyRowsOrdered(userId);

  let recipe = 0;
  let review = 0;
  const totalByLocalDate = new Map<string, number>();
  let totalActiveDays = 0;
  for (const dailyRow of dailyRows) {
    const counts = readCounts(dailyRow.counts);
    recipe += counts.recipe_completed ?? 0;
    review += counts.restaurant_review_submitted ?? 0;
    const localDateKey = pgDateColumnToYmd(dailyRow.localDate);
    const dayTotal = totalEligibleCount(counts);
    totalByLocalDate.set(localDateKey, (totalByLocalDate.get(localDateKey) ?? 0) + dayTotal);
    if (dayTotal > 0) totalActiveDays += 1;
  }

  const now = new Date();
  const calendarYear = opts?.year ?? now.getUTCFullYear();
  const calendarMonth = opts?.month ?? now.getUTCMonth() + 1;
  const monthIndex = calendarMonth - 1;
  const monthStart = new Date(Date.UTC(calendarYear, monthIndex, 1));
  const monthEndExclusive = new Date(Date.UTC(calendarYear, monthIndex + 1, 1));
  const monthEnd = new Date(Date.UTC(calendarYear, monthIndex + 1, 0));
  const daysInMonth = monthEnd.getUTCDate();

  const monthActivityRows = await findMonthActivityCounts(userId, monthStart, monthEndExclusive);

  for (const monthRow of monthActivityRows ?? []) {
    const dayTotal = Number(monthRow.recipes) + Number(monthRow.dining);
    if (dayTotal > 0) totalByLocalDate.set(monthRow.day, dayTotal);
  }

  const [recipeTotal, reviewTotal] = await Promise.all([
    recipeDatabase.recipeCompletionCount({ where: { userId } }),
    restaurantDatabase.restaurantReviewCount({ where: { userId } }),
  ]);
  recipe = Math.max(recipe, recipeTotal);
  review = Math.max(review, reviewTotal);

  const calendarMonthDays: Array<{ date: string; count: number }> = [];
  for (let dayOfMonth = 1; dayOfMonth <= daysInMonth; dayOfMonth++) {
    const dayDate = new Date(Date.UTC(calendarYear, monthIndex, dayOfMonth));
    const dayKey = dayDate.toISOString().slice(0, 10);
    calendarMonthDays.push({ date: dayKey, count: totalByLocalDate.get(dayKey) ?? 0 });
  }

  let activeDaysThisMonth = 0;
  for (const dayCell of calendarMonthDays) {
    if (dayCell.count > 0) activeDaysThisMonth += 1;
  }

  const eligibleTotal = recipe + review;

  return {
    eligibleTotal,
    currentStreak: profile?.currentStreak ?? 0,
    longestStreak: profile?.longestStreak ?? 0,
    totalActiveDays,
    activeDaysThisMonth,
    daysInMonth,
    calendarYear,
    calendarMonth,
    calendarMonthDays,
    breakdown: { recipe_completed: recipe, restaurant_review_submitted: review },
  };
}

/**
 * Compute the motivation insights cards (cooking rhythm + sensory environment) for the user.
 *
 * Returns `ok: false` with the analysed totals when the user does not yet have enough activity to surface cards.
 */
export async function getMotivationInsights(userId: string): Promise<{
  ok: boolean;
  recordsAnalyzed: { recipes: number; reviews: number; total: number };
  bestDay?: string;
  cookingCard?: { title: string; body: string };
  diningCard?: { title: string; body: string };
}> {
  const { recipe: recipeCompletes, review: reviewCompletes, total } = await sumEligibleFromDaily(userId);

  const reviews = await findRestaurantReviewsForInsights(userId);

  const eligibleForInsights =
    total >= MOTIVATION_TOTAL_THRESHOLD &&
    recipeCompletes >= MOTIVATION_RECIPES_THRESHOLD &&
    reviewCompletes >= MOTIVATION_REVIEWS_THRESHOLD;

  if (!eligibleForInsights) {
    return {
      ok: false,
      recordsAnalyzed: { recipes: recipeCompletes, reviews: reviewCompletes, total },
    };
  }

  const recipeEvents = await findEligibleRecipeEvents(userId);

  const weekdayCounts = new Map<number, number>();
  const recipeIdsSeen = new Set<string>();
  for (const event of recipeEvents) {
    const eventMetadata = event.metadata as { type?: string; recipeId?: string };
    if (eventMetadata?.type !== "recipe_completed") continue;
    const weekday = event.localDate.getUTCDay();
    weekdayCounts.set(weekday, (weekdayCounts.get(weekday) ?? 0) + 1);
    if (eventMetadata.recipeId) recipeIdsSeen.add(eventMetadata.recipeId);
  }
  let bestWeekday = 0;
  let bestWeekdayCount = -1;
  for (const [weekday, weekdayCount] of weekdayCounts) {
    if (weekdayCount > bestWeekdayCount) {
      bestWeekdayCount = weekdayCount;
      bestWeekday = weekday;
    }
  }
  const bestDay = bestWeekdayCount > 0 ? WEEKDAY[bestWeekday] : undefined;

  const timedRecipes =
    recipeIdsSeen.size > 0 ? await findRecipesTotalTimeByIds([...recipeIdsSeen]) : [];
  const recipesWithTiming = timedRecipes.filter(
    (recipe) => recipe.totalTimeMinutes != null && recipe.totalTimeMinutes > 0,
  );
  const underBreakpointCount = recipesWithTiming.filter(
    (recipe) => (recipe.totalTimeMinutes ?? 0) <= TIMING_BREAKPOINT_MINUTES,
  ).length;
  const overBreakpointCount = recipesWithTiming.filter(
    (recipe) => (recipe.totalTimeMinutes ?? 0) > TIMING_BREAKPOINT_MINUTES,
  ).length;

  let cookingCard: { title: string; body: string } | undefined;
  if (recipesWithTiming.length >= MIN_RECIPES_FOR_TIMING_CARD) {
    if (underBreakpointCount > overBreakpointCount) {
      cookingCard = {
        title: "Time and effort",
        body: "Recipes under 30 minutes consistently feel comfortable for you. Longer recipes often feel overwhelming.",
      };
    } else if (overBreakpointCount > underBreakpointCount) {
      cookingCard = {
        title: "Time and effort",
        body: "You often lean toward recipes that need more time. Shorter meals can still be a good match on busy days—when it helps, not when it harries.",
      };
    } else {
      cookingCard = {
        title: "Time and effort",
        body: `You mix shorter and longer recipes (${recipesWithTiming.length} with timing in your log). That variety can keep cooking from feeling stuck in one mode.`,
      };
    }
  } else if (recipeCompletes > 0 && bestDay) {
    cookingCard = {
      title: "Cooking rhythm",
      body: `You often finish recipes on ${bestDay}. This is based on ${recipeCompletes} completed recipe${recipeCompletes === 1 ? "" : "s"}.`,
    };
  } else if (recipeCompletes > 0) {
    cookingCard = {
      title: "Cooking rhythm",
      body: `You have completed ${recipeCompletes} recipe${recipeCompletes === 1 ? "" : "s"} in BiteBud. Keep going at your own pace.`,
    };
  }

  const quietReviews = reviews.filter((review) => review.noiseRating <= LOW_NOISE_RATING_THRESHOLD);
  const greatAmongQuiet = quietReviews.filter(
    (review) => review.overallRating >= GREAT_OVERALL_RATING_THRESHOLD,
  );

  let diningCard: { title: string; body: string } | undefined;
  if (reviews.length >= MIN_REVIEWS_FOR_DINING_CARD) {
    if (quietReviews.length >= MIN_QUIET_REVIEWS_FOR_CARD && greatAmongQuiet.length >= 1) {
      diningCard = {
        title: "Sensory environment",
        body: `Quiet venues are your sweet spot. You have rated ${greatAmongQuiet.length} out of ${quietReviews.length} low-noise restaurants as Great.`,
      };
    } else {
      const averageNoise =
        reviews.reduce((runningTotal, review) => runningTotal + review.noiseRating, 0) /
        reviews.length;
      const averageCrowd =
        reviews.reduce((runningTotal, review) => runningTotal + review.crowdsRating, 0) /
        reviews.length;
      const isCalm = averageNoise <= CALM_NOISE_THRESHOLD && averageCrowd <= CALM_CROWD_THRESHOLD;
      diningCard = {
        title: "Sensory environment",
        body: isCalm
          ? `Your recent reviews (${reviews.length}) often mention calmer noise and crowds. That pattern can help you pick similar places next time.`
          : `Your recent reviews (${reviews.length}) show a mix of noise and crowd levels. You can use this to notice what feels best for you.`,
      };
    }
  }

  return {
    ok: true,
    recordsAnalyzed: { recipes: recipeCompletes, reviews: reviewCompletes, total },
    bestDay,
    cookingCard,
    diningCard,
  };
}
