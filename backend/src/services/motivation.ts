import type { Prisma } from "@prisma/client";
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
} from "../repositories/motivationRepository.js";

export type MotivationActivityType = "recipe_completed" | "restaurant_review_submitted";

const COUNT_KEYS: Record<MotivationActivityType, string> = {
  recipe_completed: "recipe_completed",
  restaurant_review_submitted: "restaurant_review_submitted",
};

export function parseLocalDateYmd(ymd: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) throw new Error("localDate must be YYYY-MM-DD");
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) throw new Error("invalid localDate");
  return new Date(Date.UTC(y, mo - 1, d));
}

function mondayUtcOf(d: Date): Date {
  const dow = d.getUTCDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offset));
}

function calendarDaysBetweenUtc(later: Date, earlier: Date): number {
  const l = Date.UTC(later.getUTCFullYear(), later.getUTCMonth(), later.getUTCDate());
  const e = Date.UTC(earlier.getUTCFullYear(), earlier.getUTCMonth(), earlier.getUTCDate());
  return Math.round((l - e) / 86_400_000);
}

function readCounts(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(o)) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

function totalEligibleCount(counts: Record<string, number>): number {
  return (counts.recipe_completed ?? 0) + (counts.restaurant_review_submitted ?? 0);
}

async function sumEligibleFromDaily(userId: string): Promise<{
  recipe: number;
  review: number;
  total: number;
}> {
  const rows = await findMotivationDailyRowsForUser(userId);
  let recipe = 0;
  let review = 0;
  for (const r of rows) {
    const c = readCounts(r.counts);
    recipe += c.recipe_completed ?? 0;
    review += c.restaurant_review_submitted ?? 0;
  }
  return { recipe, review, total: recipe + review };
}

export type RecordActivityResult = {
  currentStreak: number;
  longestStreak: number;
  duplicate: boolean;
  toastKey: string | null;
};

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

  const last = profile.lastActiveLocalDate;
  let newStreak = profile.currentStreak;
  let freezeWeekMonday: Date | undefined;

  if (!last) {
    newStreak = 1;
  } else {
    const gap = calendarDaysBetweenUtc(localDate, last);
    if (gap <= 0) {
      newStreak = profile.currentStreak;
    } else if (gap === 1) {
      newStreak = profile.currentStreak + 1;
    } else if (gap === 2) {
      const weekMonday = mondayUtcOf(localDate);
      const freezeWeek = profile.freezeUsedWeekStart;
      const freezeSameWeek =
        freezeWeek != null && mondayUtcOf(freezeWeek).getTime() === weekMonday.getTime();
      if (!freezeSameWeek) {
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

  const longest = Math.max(profile.longestStreak, newStreak);
  await updateMotivationProfile(userId, {
    currentStreak: newStreak,
    longestStreak: longest,
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
  if (newStreak === 3) {
    toastKey = "streak_three";
  }

  return {
    currentStreak: newStreak,
    longestStreak: longest,
    duplicate: false,
    toastKey,
  };
}

function pickToastKey(type: MotivationActivityType, streak: number): string {
  if (streak === 3) return "streak_three";
  return type === "recipe_completed" ? "recipe_done" : "review_helpful";
}

export async function getMotivationSummary(userId: string): Promise<{
  currentStreak: number;
  longestStreak: number;
  showStartFresh: boolean;
  hasActivity: boolean;
}> {
  const profile = await findMotivationProfile(userId);
  const recentReset = await findLatestStreakResetEvent(userId);
  const showStartFresh = Boolean(
    recentReset && Date.now() - recentReset.createdAt.getTime() < 24 * 60 * 60 * 1000,
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

  const rows = await findMotivationDailyRowsOrdered(userId);

  let recipe = 0;
  let review = 0;
  const byDate = new Map<string, number>();
  let totalActiveDays = 0;
  for (const r of rows) {
    const c = readCounts(r.counts);
    recipe += c.recipe_completed ?? 0;
    review += c.restaurant_review_submitted ?? 0;
    const key = r.localDate.toISOString().slice(0, 10);
    const dayTotal = totalEligibleCount(c);
    byDate.set(key, (byDate.get(key) ?? 0) + dayTotal);
    if (dayTotal > 0) totalActiveDays += 1;
  }

  const eligibleTotal = recipe + review;

  const now = new Date();
  const calYear = opts?.year ?? now.getUTCFullYear();
  const calMonth = opts?.month ?? now.getUTCMonth() + 1;
  const y = calYear;
  const m0 = calMonth - 1;
  const monthEnd = new Date(Date.UTC(y, m0 + 1, 0));
  const daysInMonth = monthEnd.getUTCDate();

  const calendarMonthDays: Array<{ date: string; count: number }> = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(Date.UTC(y, m0, day));
    const key = d.toISOString().slice(0, 10);
    calendarMonthDays.push({ date: key, count: byDate.get(key) ?? 0 });
  }

  let activeDaysThisMonth = 0;
  for (const cell of calendarMonthDays) {
    if (cell.count > 0) activeDaysThisMonth += 1;
  }

  return {
    eligibleTotal,
    currentStreak: profile?.currentStreak ?? 0,
    longestStreak: profile?.longestStreak ?? 0,
    totalActiveDays,
    activeDaysThisMonth,
    daysInMonth,
    calendarYear: y,
    calendarMonth: calMonth,
    calendarMonthDays,
    breakdown: { recipe_completed: recipe, restaurant_review_submitted: review },
  };
}

export async function getMotivationInsights(userId: string): Promise<{
  ok: boolean;
  recordsAnalyzed: { recipes: number; reviews: number; total: number };
  bestDay?: string;
  cookingCard?: { title: string; body: string };
  diningCard?: { title: string; body: string };
}> {
  const { recipe: recipeCompletes, review: reviewCompletes, total } = await sumEligibleFromDaily(userId);

  const reviews = await findRestaurantReviewsForInsights(userId);

  const ok = total >= 6 && recipeCompletes >= 3 && reviewCompletes >= 3;

  if (!ok) {
    return {
      ok: false,
      recordsAnalyzed: { recipes: recipeCompletes, reviews: reviewCompletes, total },
    };
  }

  const recipeEvents = await findEligibleRecipeEvents(userId);

  const weekdayCounts = new Map<number, number>();
  const recipeIdsSeen = new Set<string>();
  for (const e of recipeEvents) {
    const m = e.metadata as { type?: string; recipeId?: string };
    if (m?.type !== "recipe_completed") continue;
    const wd = e.localDate.getUTCDay();
    weekdayCounts.set(wd, (weekdayCounts.get(wd) ?? 0) + 1);
    if (m.recipeId) recipeIdsSeen.add(m.recipeId);
  }
  let bestWd = 0;
  let bestN = -1;
  for (const [wd, n] of weekdayCounts) {
    if (n > bestN) {
      bestN = n;
      bestWd = wd;
    }
  }
  const bestDay = bestN > 0 ? WEEKDAY[bestWd] : undefined;

  const timedRecipes =
    recipeIdsSeen.size > 0 ? await findRecipesTotalTimeByIds([...recipeIdsSeen]) : [];
  const withTime = timedRecipes.filter((r) => r.totalTimeMinutes != null && r.totalTimeMinutes > 0);
  const under30 = withTime.filter((r) => (r.totalTimeMinutes ?? 0) <= 30).length;
  const over30 = withTime.filter((r) => (r.totalTimeMinutes ?? 0) > 30).length;

  let cookingCard: { title: string; body: string } | undefined;
  if (withTime.length >= 3) {
    if (under30 > over30) {
      cookingCard = {
        title: "Time and effort",
        body: "Recipes under 30 minutes consistently feel comfortable for you. Longer recipes often feel overwhelming.",
      };
    } else if (over30 > under30) {
      cookingCard = {
        title: "Time and effort",
        body: "You often lean toward recipes that need more time. Shorter meals can still be a good match on busy days—when it helps, not when it harries.",
      };
    } else {
      cookingCard = {
        title: "Time and effort",
        body: `You mix shorter and longer recipes (${withTime.length} with timing in your log). That variety can keep cooking from feeling stuck in one mode.`,
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

  const quiet = reviews.filter((r) => r.noiseRating <= 2);
  const greatAmongQuiet = quiet.filter((r) => r.overallRating >= 4);

  let diningCard: { title: string; body: string } | undefined;
  if (reviews.length >= 3) {
    if (quiet.length >= 3 && greatAmongQuiet.length >= 1) {
      diningCard = {
        title: "Sensory environment",
        body: `Quiet venues are your sweet spot. You have rated ${greatAmongQuiet.length} out of ${quiet.length} low-noise restaurants as Great.`,
      };
    } else {
      const avgNoise = reviews.reduce((s, r) => s + r.noiseRating, 0) / reviews.length;
      const avgCrowd = reviews.reduce((s, r) => s + r.crowdsRating, 0) / reviews.length;
      const calm = avgNoise <= 2.5 && avgCrowd <= 2.5;
      diningCard = {
        title: "Sensory environment",
        body: calm
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
