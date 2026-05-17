import { LOCAL_TIMEZONE } from "../calendarDate.js";
import { prisma } from "../prisma.js";

/**
 * Database access for cross-table user activity aggregates over `recipe_completions` and `restaurant_reviews`.
 *
 * These queries use raw SQL because they combine two unrelated tables with date-bucket maths in Melbourne time —
 * Prisma's typed API cannot express that in a single round-trip without a `$queryRaw`.
 */

/** One Melbourne-local calendar day with any recipe or dining activity. */
export type ActivityDayRow = { day: string };

/** 30-day and all-time completion/review counts from a single SQL query. */
export type ActivityTotalsRow = {
  completions_30: bigint;
  reviews_30: bigint;
  completions_ever: bigint;
  reviews_ever: bigint;
};

/** Per-day recipe completions and restaurant reviews inside a date window. */
export type DailyActivityAggregateRow = {
  day: string;
  recipes: bigint;
  dining: bigint;
};

/** Totals for recipe completions and reviews in one date window. */
export type ActivityBreakdownRow = {
  recipes: bigint;
  dining: bigint;
};

/** Per ISO week (Melbourne-local) recipe and dining counts. */
export type WeeklyActivityAggregateRow = {
  week_start: string;
  recipes: bigint;
  dining: bigint;
};

/** Distinct active days, total reviews, and first activity date for a user. */
export type LifetimeStatsRow = {
  cooking_days_total: bigint;
  dining_days_total: bigint;
  dining_total: bigint;
  first_activity_day: string | null;
};

/** Current Melbourne week: distinct cooking days and dining review count. */
export type ThisWeekStatsRow = {
  week_start: string;
  cooking_days: bigint;
  dining_reviews: bigint;
};

/** Per-day recipe and dining counts within one calendar month. */
export type MonthActivityRow = {
  day: string;
  recipes: bigint;
  dining: bigint;
};

/** Distinct Melbourne-local days a user has either completed a recipe or reviewed a restaurant in the last ~400 days. */
export async function findActiveCalendarDays(userId: string): Promise<ActivityDayRow[]> {
  return prisma.$queryRaw<ActivityDayRow[]>`SELECT DISTINCT day::text AS day FROM (
      SELECT ((completed_at AT TIME ZONE 'UTC') AT TIME ZONE ${LOCAL_TIMEZONE})::date AS day
      FROM recipe_completions
      WHERE user_id = ${userId} AND completed_at >= NOW() - INTERVAL '400 days'
      UNION
      SELECT ((created_at AT TIME ZONE 'UTC') AT TIME ZONE ${LOCAL_TIMEZONE})::date AS day
      FROM restaurant_reviews
      WHERE user_id = ${userId} AND created_at >= NOW() - INTERVAL '400 days'
    ) days`;
}

/** Recent (30-day) and lifetime totals for completions and reviews in a single round-trip. */
export async function findActivityTotals(userId: string): Promise<ActivityTotalsRow> {
  const rows = await prisma.$queryRaw<ActivityTotalsRow[]>`SELECT
      (SELECT COUNT(*) FROM recipe_completions WHERE user_id = ${userId} AND completed_at >= NOW() - INTERVAL '30 days') AS completions_30,
      (SELECT COUNT(*) FROM restaurant_reviews WHERE user_id = ${userId} AND created_at >= NOW() - INTERVAL '30 days') AS reviews_30,
      (SELECT COUNT(*) FROM recipe_completions WHERE user_id = ${userId}) AS completions_ever,
      (SELECT COUNT(*) FROM restaurant_reviews WHERE user_id = ${userId}) AS reviews_ever`;
  return (
    rows[0] ?? {
      completions_30: 0n,
      reviews_30: 0n,
      completions_ever: 0n,
      reviews_ever: 0n,
    }
  );
}

/** Per-day cooking/dining counts in `[fromInclusive, toExclusive)`, Melbourne-local. */
export async function findDailyActivityAggregate(
  userId: string,
  fromInclusive: Date,
  toExclusive: Date,
): Promise<DailyActivityAggregateRow[]> {
  return prisma.$queryRaw<DailyActivityAggregateRow[]>`SELECT day::text AS day,
      SUM(recipes_count)::bigint AS recipes,
      SUM(dining_count)::bigint AS dining
    FROM (
      SELECT ((completed_at AT TIME ZONE 'UTC') AT TIME ZONE ${LOCAL_TIMEZONE})::date AS day, COUNT(*)::bigint AS recipes_count, 0::bigint AS dining_count
      FROM recipe_completions
      WHERE user_id = ${userId} AND completed_at >= ${fromInclusive} AND completed_at < ${toExclusive}
      GROUP BY 1
      UNION ALL
      SELECT ((created_at AT TIME ZONE 'UTC') AT TIME ZONE ${LOCAL_TIMEZONE})::date AS day, 0::bigint AS recipes_count, COUNT(*)::bigint AS dining_count
      FROM restaurant_reviews
      WHERE user_id = ${userId} AND created_at >= ${fromInclusive} AND created_at < ${toExclusive}
      GROUP BY 1
    ) x
    GROUP BY day
    ORDER BY day ASC`;
}

/** Single-row counts of cooking and dining activity in `[fromInclusive, toExclusive)`. */
export async function findActivityBreakdown(
  userId: string,
  fromInclusive: Date,
  toExclusive: Date,
): Promise<ActivityBreakdownRow> {
  const rows = await prisma.$queryRaw<ActivityBreakdownRow[]>`SELECT
      (SELECT COUNT(*) FROM recipe_completions WHERE user_id = ${userId} AND completed_at >= ${fromInclusive} AND completed_at < ${toExclusive}) AS recipes,
      (SELECT COUNT(*) FROM restaurant_reviews WHERE user_id = ${userId} AND created_at >= ${fromInclusive} AND created_at < ${toExclusive}) AS dining`;
  return rows[0] ?? { recipes: 0n, dining: 0n };
}

/** Per-week cooking/dining counts using Melbourne-local ISO week buckets. */
export async function findWeeklyActivityAggregate(
  userId: string,
  weeklyFrom: Date,
  toExclusive: Date,
): Promise<WeeklyActivityAggregateRow[]> {
  return prisma.$queryRaw<WeeklyActivityAggregateRow[]>`SELECT week_start::text AS week_start,
      SUM(recipes_count)::bigint AS recipes,
      SUM(dining_count)::bigint AS dining
    FROM (
      SELECT date_trunc('week', (completed_at AT TIME ZONE 'UTC') AT TIME ZONE ${LOCAL_TIMEZONE})::date AS week_start, COUNT(*)::bigint AS recipes_count, 0::bigint AS dining_count
      FROM recipe_completions
      WHERE user_id = ${userId} AND completed_at >= ${weeklyFrom} AND completed_at < ${toExclusive}
      GROUP BY 1
      UNION ALL
      SELECT date_trunc('week', (created_at AT TIME ZONE 'UTC') AT TIME ZONE ${LOCAL_TIMEZONE})::date AS week_start, 0::bigint AS recipes_count, COUNT(*)::bigint AS dining_count
      FROM restaurant_reviews
      WHERE user_id = ${userId} AND created_at >= ${weeklyFrom} AND created_at < ${toExclusive}
      GROUP BY 1
    ) x
    GROUP BY week_start
    ORDER BY week_start ASC`;
}

/** Lifetime stats: distinct cooking/dining days, total reviews, first ever activity date. */
export async function findLifetimeActivityStats(userId: string): Promise<LifetimeStatsRow> {
  const rows = await prisma.$queryRaw<LifetimeStatsRow[]>`SELECT
      (
        SELECT COUNT(DISTINCT ((completed_at AT TIME ZONE 'UTC') AT TIME ZONE ${LOCAL_TIMEZONE})::date)
        FROM recipe_completions
        WHERE user_id = ${userId}
      )::bigint AS cooking_days_total,
      (
        SELECT COUNT(DISTINCT ((created_at AT TIME ZONE 'UTC') AT TIME ZONE ${LOCAL_TIMEZONE})::date)
        FROM restaurant_reviews
        WHERE user_id = ${userId}
      )::bigint AS dining_days_total,
      (
        SELECT COUNT(*)
        FROM restaurant_reviews
        WHERE user_id = ${userId}
      )::bigint AS dining_total,
      (
        SELECT MIN(day)::text
        FROM (
          SELECT MIN(((completed_at AT TIME ZONE 'UTC') AT TIME ZONE ${LOCAL_TIMEZONE})::date) AS day
          FROM recipe_completions
          WHERE user_id = ${userId}
          UNION ALL
          SELECT MIN(((created_at AT TIME ZONE 'UTC') AT TIME ZONE ${LOCAL_TIMEZONE})::date) AS day
          FROM restaurant_reviews
          WHERE user_id = ${userId}
        ) firsts
      ) AS first_activity_day`;
  return (
    rows[0] ?? {
      cooking_days_total: 0n,
      dining_days_total: 0n,
      dining_total: 0n,
      first_activity_day: null,
    }
  );
}

/** Current-week (Monday-anchored, Melbourne-local) counters used by the progress gauges. */
export async function findThisWeekActivityStats(userId: string): Promise<ThisWeekStatsRow> {
  const rows = await prisma.$queryRaw<ThisWeekStatsRow[]>`SELECT
      date_trunc('week', NOW() AT TIME ZONE ${LOCAL_TIMEZONE})::date::text AS week_start,
      (
        SELECT COUNT(DISTINCT ((completed_at AT TIME ZONE 'UTC') AT TIME ZONE ${LOCAL_TIMEZONE})::date)
        FROM recipe_completions
        WHERE user_id = ${userId}
          AND ((completed_at AT TIME ZONE 'UTC') AT TIME ZONE ${LOCAL_TIMEZONE})::date
              >= date_trunc('week', NOW() AT TIME ZONE ${LOCAL_TIMEZONE})::date
      )::bigint AS cooking_days,
      (
        SELECT COUNT(*)
        FROM restaurant_reviews
        WHERE user_id = ${userId}
          AND ((created_at AT TIME ZONE 'UTC') AT TIME ZONE ${LOCAL_TIMEZONE})::date
              >= date_trunc('week', NOW() AT TIME ZONE ${LOCAL_TIMEZONE})::date
      )::bigint AS dining_reviews`;
  return rows[0] ?? { week_start: "", cooking_days: 0n, dining_reviews: 0n };
}

/** Per-day cooking/dining counts inside a single calendar month (used by the motivation progress view). */
export async function findMonthActivityCounts(
  userId: string,
  monthStart: Date,
  monthEndExclusive: Date,
): Promise<MonthActivityRow[]> {
  return prisma.$queryRaw<MonthActivityRow[]>`SELECT day::text AS day,
      SUM(recipes_count)::bigint AS recipes,
      SUM(dining_count)::bigint AS dining
    FROM (
      SELECT ((completed_at AT TIME ZONE 'UTC') AT TIME ZONE ${LOCAL_TIMEZONE})::date AS day, COUNT(*)::bigint AS recipes_count, 0::bigint AS dining_count
      FROM recipe_completions
      WHERE user_id = ${userId} AND completed_at >= ${monthStart} AND completed_at < ${monthEndExclusive}
      GROUP BY 1
      UNION ALL
      SELECT ((created_at AT TIME ZONE 'UTC') AT TIME ZONE ${LOCAL_TIMEZONE})::date AS day, 0::bigint AS recipes_count, COUNT(*)::bigint AS dining_count
      FROM restaurant_reviews
      WHERE user_id = ${userId} AND created_at >= ${monthStart} AND created_at < ${monthEndExclusive}
      GROUP BY 1
    ) x
    GROUP BY day
    ORDER BY day ASC`;
}
