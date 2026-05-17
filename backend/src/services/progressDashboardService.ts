import {
  addDays,
  isoDateOnly,
  localCalendarDateString,
  parseIsoDateOnly,
} from "../calendarDate.js";
import { findActiveCalendarDays } from "../database/userActivityDatabase.js";
import { findMotivationProfile } from "../database/motivationDatabase.js";
import { recipeDatabase } from "../database/recipeDatabase.js";
import { restaurantDatabase } from "../database/restaurantDatabase.js";
import { computeCurrentActivityStreak } from "./userActivityService.js";

const MS_PER_DAY = 86_400_000;
const COOKING_INSIGHTS_NEED = 3;
const DINING_INSIGHTS_NEED = 2;
const PROGRESS_ACTIVITY_NEED = 3;
const MIN_HIGH_RATING = 4;
const MAX_LOW_RATING = 3;
const RECIPES_MILESTONE_NEED = 25;

export type DayRatingBand = "none" | "high" | "mixed" | "low";

export type ProgressMilestoneStatus = "earned" | "almost" | "locked";

export type ProgressDashboardPayload = {
  range: { from: string; to: string };
  comparisonRange: { from: string; to: string };
  deltaLabel: string;
  stats: {
    recipesCooked: number;
    diningReviews: number;
    daysActive: number;
  };
  statsDelta: {
    recipesCooked: number;
    diningReviews: number;
    daysActive: number;
  };
  thresholds: {
    cooking: { have: number; need: number };
    dining: { have: number; need: number };
    progress: { have: number; need: number };
  };
  insightsUnlocked: boolean;
  uiState: "new" | "active" | "established";
  streak: { current: number; longest: number };
  calendar: Array<{
    date: string;
    recipes: number;
    reviews: number;
    ratingBand: DayRatingBand;
  }>;
  milestones: Array<{
    id: string;
    title: string;
    description: string;
    status: ProgressMilestoneStatus;
    progress?: { have: number; need: number };
  }>;
  ratingTrend: Array<{
    weekStart: string;
    weekLabel: string;
    averageRating: number | null;
    completionCount: number;
  }>;
  ratingTrendSummary: string | null;
};

function inclusiveDayCount(fromInclusive: Date, toInclusive: Date): number {
  return Math.max(
    1,
    Math.round((toInclusive.getTime() - fromInclusive.getTime()) / MS_PER_DAY) + 1,
  );
}

function deltaLabelForSpan(dayCount: number): string {
  if (dayCount <= 7) return "last week";
  if (dayCount <= 31) return "last month";
  if (dayCount <= 92) return "last period";
  return "previous period";
}

function melbourneDayKey(utcInstant: Date): string {
  return localCalendarDateString(utcInstant);
}

function classifyDayRatingBand(ratings: number[], hasActivity: boolean): DayRatingBand {
  if (!hasActivity) return "none";
  if (ratings.length === 0) return "mixed";
  const allHigh = ratings.every((rating) => rating >= MIN_HIGH_RATING);
  const allLow = ratings.every((rating) => rating <= MAX_LOW_RATING);
  if (allHigh) return "high";
  if (allLow) return "low";
  return "mixed";
}

function enumerateInclusiveDays(fromInclusive: Date, toInclusive: Date): string[] {
  const days: string[] = [];
  let cursor = new Date(fromInclusive);
  while (cursor.getTime() <= toInclusive.getTime()) {
    days.push(isoDateOnly(cursor));
    cursor = addDays(cursor, 1);
  }
  return days;
}

function startOfIsoWeekUtc(isoDay: string): string {
  const parsed = parseIsoDateOnly(isoDay);
  if (!parsed) return isoDay;
  const d = new Date(parsed);
  const weekday = d.getUTCDay();
  const diff = (weekday + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return isoDateOnly(d);
}

function weekLabelFromIndex(index: number, isoWeekStart: string): string {
  const parsed = parseIsoDateOnly(isoWeekStart);
  const month =
    parsed ?
      new Date(parsed).toLocaleDateString("en-AU", { month: "short", timeZone: "UTC" })
    : "";
  return month ? `W${index + 1} · ${month}` : `W${index + 1}`;
}

async function aggregateRangeActivity(
  userId: string,
  fromInclusive: Date,
  toExclusive: Date,
): Promise<{
  recipeCount: number;
  reviewCount: number;
  ratedRecipeCount: number;
  daysActive: number;
  dayMap: Map<
    string,
    { recipes: number; reviews: number; ratings: number[]; hasActivity: boolean }
  >;
  weeklyRatings: Map<string, { sum: number; count: number }>;
}> {
  const [completions, reviews] = await Promise.all([
    recipeDatabase.recipeCompletionFindMany({
      where: { userId, completedAt: { gte: fromInclusive, lt: toExclusive } },
      select: { completedAt: true, rating: true },
      orderBy: { completedAt: "asc" },
    }),
    restaurantDatabase.restaurantReviewFindMany({
      where: { userId, createdAt: { gte: fromInclusive, lt: toExclusive } },
      select: { createdAt: true, overallRating: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const dayMap = new Map<
    string,
    { recipes: number; reviews: number; ratings: number[]; hasActivity: boolean }
  >();

  function touchDay(dayKey: string) {
    let row = dayMap.get(dayKey);
    if (!row) {
      row = { recipes: 0, reviews: 0, ratings: [], hasActivity: false };
      dayMap.set(dayKey, row);
    }
    return row;
  }

  let ratedRecipeCount = 0;
  const weeklyRatings = new Map<string, { sum: number; count: number }>();

  for (const completion of completions) {
    const dayKey = melbourneDayKey(new Date(completion.completedAt));
    const row = touchDay(dayKey);
    row.recipes += 1;
    row.hasActivity = true;
    const rating = completion.rating;
    if (typeof rating === "number" && Number.isFinite(rating)) {
      ratedRecipeCount += 1;
      row.ratings.push(rating);
      const weekStart = startOfIsoWeekUtc(dayKey);
      const bucket = weeklyRatings.get(weekStart) ?? { sum: 0, count: 0 };
      bucket.sum += rating;
      bucket.count += 1;
      weeklyRatings.set(weekStart, bucket);
    }
  }

  for (const review of reviews) {
    const dayKey = melbourneDayKey(new Date(review.createdAt));
    const row = touchDay(dayKey);
    row.reviews += 1;
    row.hasActivity = true;
    const overall = Number(review.overallRating);
    if (Number.isFinite(overall)) {
      row.ratings.push(overall);
    }
  }

  const daysActive = Array.from(dayMap.values()).filter((row) => row.hasActivity).length;

  return {
    recipeCount: completions.length,
    reviewCount: reviews.length,
    ratedRecipeCount,
    daysActive,
    dayMap,
    weeklyRatings,
  };
}

function buildRatingTrend(
  weeklyRatings: Map<string, { sum: number; count: number }>,
  rangeFromInclusive: Date,
  rangeToInclusive: Date,
): { weeks: ProgressDashboardPayload["ratingTrend"]; summary: string | null } {
  const entries = Array.from(weeklyRatings.entries())
    .filter(([, bucket]) => bucket.count > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-4);

  const weeks = entries.map(([weekStart, bucket], index) => ({
    weekStart,
    weekLabel: weekLabelFromIndex(index, weekStart),
    averageRating: Math.round((bucket.sum / bucket.count) * 10) / 10,
    completionCount: bucket.count,
  }));

  let summary: string | null = null;
  if (weeks.length >= 2) {
    const first = weeks[0].averageRating ?? 0;
    const last = weeks[weeks.length - 1].averageRating ?? 0;
    if (last > first + 0.2) {
      summary = "Your ratings have been improving over the last few weeks.";
    } else if (last < first - 0.2) {
      summary = "Your ratings dipped recently — a simpler week might help.";
    } else {
      summary = "Your ratings have been fairly steady recently.";
    }
  } else if (weeks.length === 1) {
    summary = "Keep rating recipes to see how your trend develops.";
  }

  void rangeFromInclusive;
  void rangeToInclusive;

  return { weeks, summary };
}

async function buildMilestones(
  userId: string,
  lifetimeRatedRecipes: number,
  lifetimeReviews: number,
  lifetimeCompletions: number,
  currentStreak: number,
  longestStreak: number,
  insightsUnlocked: boolean,
  thresholds: ProgressDashboardPayload["thresholds"],
): Promise<ProgressDashboardPayload["milestones"]> {
  const cookingAlmost =
    thresholds.cooking.have > 0 &&
    thresholds.cooking.have < thresholds.cooking.need;
  const diningAlmost =
    thresholds.dining.have > 0 && thresholds.dining.have < thresholds.dining.need;

  const milestones: ProgressDashboardPayload["milestones"] = [
    {
      id: "first-recipe",
      title: "First Recipe Completed",
      description: "Cook and rate your first recipe.",
      status: lifetimeRatedRecipes >= 1 ? "earned" : "locked",
    },
    {
      id: "first-review",
      title: "First Restaurant Reviewed",
      description: "Leave your first dining review.",
      status: lifetimeReviews >= 1 ? "earned" : "locked",
    },
    {
      id: "first-insight",
      title: "First Insight Unlocked",
      description: "Complete enough activities to see your first pattern.",
      status: insightsUnlocked ? "earned" : cookingAlmost || diningAlmost ? "almost" : "locked",
    },
    {
      id: "streak-3",
      title: "3-Day Streak",
      description: "Cook or dine out 3 days in a row.",
      status: currentStreak >= 3 || longestStreak >= 3 ? "earned" : "locked",
    },
    {
      id: "streak-10",
      title: "10-Day Streak",
      description: "Cook or dine out 10 days in a row.",
      status: currentStreak >= 10 || longestStreak >= 10 ? "earned" : "locked",
    },
    {
      id: "recipes-25",
      title: "25 Recipes Cooked",
      description: "Build a library of home-cooked meals.",
      status:
        lifetimeCompletions >= RECIPES_MILESTONE_NEED
          ? "earned"
          : lifetimeCompletions > 0
            ? "almost"
            : "locked",
      progress: {
        have: Math.min(lifetimeCompletions, RECIPES_MILESTONE_NEED),
        need: RECIPES_MILESTONE_NEED,
      },
    },
  ];

  void userId;
  return milestones;
}

/** Build the My Progress dashboard for a selected date range (Progress page only). */
export async function buildProgressDashboardPayload(
  userId: string,
  rangeFromInclusive: Date,
  rangeToInclusive: Date,
): Promise<ProgressDashboardPayload> {
  const rangeToExclusive = addDays(rangeToInclusive, 1);
  const dayCount = inclusiveDayCount(rangeFromInclusive, rangeToInclusive);
  const comparisonToInclusive = addDays(rangeFromInclusive, -1);
  const comparisonFromInclusive = addDays(rangeFromInclusive, -dayCount);
  const comparisonToExclusive = addDays(comparisonToInclusive, 1);

  const [
    current,
    previous,
    lifetimeRatedRecipes,
    lifetimeReviews,
    lifetimeCompletions,
    profile,
    activeCalendarDays,
  ] = await Promise.all([
    aggregateRangeActivity(userId, rangeFromInclusive, rangeToExclusive),
    aggregateRangeActivity(userId, comparisonFromInclusive, comparisonToExclusive),
    recipeDatabase.recipeCompletionCount({
      where: { userId, rating: { not: null } },
    }),
    restaurantDatabase.restaurantReviewCount({ where: { userId } }),
    recipeDatabase.recipeCompletionCount({ where: { userId } }),
    findMotivationProfile(userId),
    findActiveCalendarDays(userId),
  ]);

  const thresholds = {
    cooking: { have: current.ratedRecipeCount, need: COOKING_INSIGHTS_NEED },
    dining: { have: current.reviewCount, need: DINING_INSIGHTS_NEED },
    progress: {
      have: current.recipeCount + current.reviewCount,
      need: PROGRESS_ACTIVITY_NEED,
    },
  };

  const insightsUnlocked =
    thresholds.cooking.have >= thresholds.cooking.need &&
    thresholds.dining.have >= thresholds.dining.need;

  const uiState: ProgressDashboardPayload["uiState"] =
    thresholds.progress.have === 0 ? "new" : insightsUnlocked ? "established" : "active";

  const calendarDays = enumerateInclusiveDays(rangeFromInclusive, rangeToInclusive);
  const calendar = calendarDays.map((date) => {
    const row = current.dayMap.get(date);
    const recipes = row?.recipes ?? 0;
    const reviews = row?.reviews ?? 0;
    const hasActivity = Boolean(row?.hasActivity);
    return {
      date,
      recipes,
      reviews,
      ratingBand: classifyDayRatingBand(row?.ratings ?? [], hasActivity),
    };
  });

  const { weeks: ratingTrend, summary: ratingTrendSummary } = buildRatingTrend(
    current.weeklyRatings,
    rangeFromInclusive,
    rangeToInclusive,
  );

  const currentStreak = computeCurrentActivityStreak(activeCalendarDays.map((row) => row.day));
  const longestStreak = profile?.longestStreak ?? 0;

  const lifetimeInsightsUnlocked =
    lifetimeRatedRecipes >= COOKING_INSIGHTS_NEED && lifetimeReviews >= DINING_INSIGHTS_NEED;

  const milestones = await buildMilestones(
    userId,
    lifetimeRatedRecipes,
    lifetimeReviews,
    lifetimeCompletions,
    currentStreak,
    longestStreak,
    lifetimeInsightsUnlocked,
    {
      cooking: { have: lifetimeRatedRecipes, need: COOKING_INSIGHTS_NEED },
      dining: { have: lifetimeReviews, need: DINING_INSIGHTS_NEED },
      progress: {
        have: lifetimeCompletions + lifetimeReviews,
        need: PROGRESS_ACTIVITY_NEED,
      },
    },
  );

  return {
    range: { from: isoDateOnly(rangeFromInclusive), to: isoDateOnly(rangeToInclusive) },
    comparisonRange: {
      from: isoDateOnly(comparisonFromInclusive),
      to: isoDateOnly(comparisonToInclusive),
    },
    deltaLabel: deltaLabelForSpan(dayCount),
    stats: {
      recipesCooked: current.recipeCount,
      diningReviews: current.reviewCount,
      daysActive: current.daysActive,
    },
    statsDelta: {
      recipesCooked: current.recipeCount - previous.recipeCount,
      diningReviews: current.reviewCount - previous.reviewCount,
      daysActive: current.daysActive - previous.daysActive,
    },
    thresholds,
    insightsUnlocked,
    uiState,
    streak: { current: currentStreak, longest: longestStreak },
    calendar,
    milestones,
    ratingTrend,
    ratingTrendSummary,
  };
}
