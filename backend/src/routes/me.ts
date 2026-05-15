import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { parseBiteBudUserId } from "../biteBudUserId.js";
import { parseRecipeGraph, type RecipeGraph, type RecipeNode } from "../graph/recipeGraph.js";
import { inferFlavorProfile } from "../services/flavorProfile.js";
import {
  LOCAL_TIMEZONE,
  addDays,
  isoDateOnly,
  localCalendarDateString,
  parseIsoDateOnly,
  pgDateColumnToYmd,
  todayMelbourneDate,
} from "../calendarDate.js";

/** Subtracts `days` calendar days from an ISO date string, returning the new ISO date. */
function isoCalendarMinusDays(isoDateString: string, days: number): string {
  const [year, month, dayOfMonth] = isoDateString.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, dayOfMonth));
  dt.setUTCDate(dt.getUTCDate() - days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Current streak: consecutive Melbourne-local days with at least one completion or review,
 * counting backward from today only. If nothing is logged today (Melbourne date), streak is 0.
 */
function computeCurrentActivityStreak(activeIsoDays: Iterable<string>, now: Date = new Date()): number {
  const set = new Set(activeIsoDays);
  const todayStr = localCalendarDateString(now);
  if (!set.has(todayStr)) return 0;

  let streak = 0;
  let cursor = todayStr;
  while (set.has(cursor)) {
    streak += 1;
    cursor = isoCalendarMinusDays(cursor, 1);
  }
  return streak;
}

function startOfIsoWeek(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const weekday = start.getDay(); // 0 Sun ... 6 Sat
  const daysSinceMonday = (weekday + 6) % 7; // Mon=0 ... Sun=6
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

function timeOfDayBucket(date: Date): "morning" | "midday" | "evening" | "night" {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 16) return "midday";
  if (hour >= 16 && hour < 22) return "evening";
  return "night";
}

function normalizeIngredientLabel(rawLabel: string): string {
  return rawLabel
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function ingredientNodes(graph: RecipeGraph): RecipeNode[] {
  return (graph.nodes ?? []).filter((node) => node.type === "ingredient");
}

function methodKeysFromGraph(graph: RecipeGraph): Set<string> {
  const methods = new Set<string>();
  const patterns: Array<[string, RegExp]> = [
    ["bake", /\bbake\b/],
    ["roast", /\broast\b/],
    ["fry", /\bfry\b/],
    ["pan", /\bpan\b/],
    ["stovetop", /\bstove(?:top)?\b/],
    ["grill", /\bgrill\b/],
    ["steam", /\bsteam\b/],
    ["boil", /\bboil\b/],
  ];
  for (const node of graph.nodes ?? []) {
    const nodeText = `${node.label ?? ""} ${node.detail ?? ""}`.toLowerCase();
    for (const [methodKey, pattern] of patterns) {
      if (pattern.test(nodeText)) methods.add(methodKey);
    }
  }
  return methods;
}

function ordinalThisWeek(ordinalNumber: number): string {
  if (ordinalNumber === 1) return "first";
  if (ordinalNumber === 2) return "second";
  if (ordinalNumber === 3) return "third";
  return `${ordinalNumber}th`;
}

type InsightCard = {
  id: string;
  category: string;
  headline: string;
  detail: string;
  recordCount: number;
};

function clampTopN<T>(items: T[], maxCount: number): T[] {
  return items.slice(0, Math.max(0, maxCount));
}

function countTopN(map: Map<string, number>, maxEntries: number): Array<{ key: string; count: number }> {
  return clampTopN(
    Array.from(map.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((first, second) => second.count - first.count),
    maxEntries,
  );
}

function pearson(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return 0;
  const pairCount = xs.length;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / pairCount;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / pairCount;
  let numerator = 0;
  let sumSquaredDeviationX = 0;
  let sumSquaredDeviationY = 0;
  for (let pairIndex = 0; pairIndex < pairCount; pairIndex++) {
    const deviationX = xs[pairIndex] - meanX;
    const deviationY = ys[pairIndex] - meanY;
    numerator += deviationX * deviationY;
    sumSquaredDeviationX += deviationX * deviationX;
    sumSquaredDeviationY += deviationY * deviationY;
  }
  const denominator = Math.sqrt(sumSquaredDeviationX) * Math.sqrt(sumSquaredDeviationY);
  if (!Number.isFinite(denominator) || denominator === 0) return 0;
  return numerator / denominator;
}

export async function registerMeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/me/activity", async (request, reply) => {
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) return reply.status(400).send({ error: "Missing or invalid X-User-Id" });

    const activeDayRows = await prisma.$queryRaw<
      Array<{ day: string }>
    >`SELECT DISTINCT day::text AS day FROM (
        SELECT ((completed_at AT TIME ZONE 'UTC') AT TIME ZONE ${LOCAL_TIMEZONE})::date AS day
        FROM recipe_completions
        WHERE user_id = ${userId} AND completed_at >= NOW() - INTERVAL '400 days'
        UNION
        SELECT ((created_at AT TIME ZONE 'UTC') AT TIME ZONE ${LOCAL_TIMEZONE})::date AS day
        FROM restaurant_reviews
        WHERE user_id = ${userId} AND created_at >= NOW() - INTERVAL '400 days'
      ) days`;

    const activityTotalsQueryRows = await prisma.$queryRaw<
      Array<{ completions_30: bigint; reviews_30: bigint; completions_ever: bigint; reviews_ever: bigint }>
    >`SELECT
        (SELECT COUNT(*) FROM recipe_completions WHERE user_id = ${userId} AND completed_at >= NOW() - INTERVAL '30 days') AS completions_30,
        (SELECT COUNT(*) FROM restaurant_reviews WHERE user_id = ${userId} AND created_at >= NOW() - INTERVAL '30 days') AS reviews_30,
        (SELECT COUNT(*) FROM recipe_completions WHERE user_id = ${userId}) AS completions_ever,
        (SELECT COUNT(*) FROM restaurant_reviews WHERE user_id = ${userId}) AS reviews_ever`;

    const activityTotals = activityTotalsQueryRows[0] ?? {
      completions_30: 0n,
      reviews_30: 0n,
      completions_ever: 0n,
      reviews_ever: 0n,
    };

    const dayStreak = computeCurrentActivityStreak((activeDayRows ?? []).map((row) => row.day));
    const activitiesThisMonth = Number(activityTotals.completions_30) + Number(activityTotals.reviews_30);
    const hasAny = Number(activityTotals.completions_ever) + Number(activityTotals.reviews_ever) > 0;

    return reply.send({ dayStreak, activitiesThisMonth, hasAny });
  });

  app.get("/api/me/insights", async (request, reply) => {
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) return reply.status(400).send({ error: "Missing or invalid X-User-Id" });

    const parsedQuery = z
      .object({
        dismissed: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse((request.query as Record<string, unknown>) ?? {});

    const todayUtc = todayMelbourneDate();
    const defaultFrom = addDays(todayUtc, -89); // inclusive range = 90 days
    const parsedFrom = parsedQuery.from ? parseIsoDateOnly(parsedQuery.from) : null;
    const parsedTo = parsedQuery.to ? parseIsoDateOnly(parsedQuery.to) : null;
    const rangeFrom = parsedFrom ?? defaultFrom;
    const rangeTo = parsedTo ?? todayUtc;
    if (!rangeFrom || !rangeTo) {
      return reply.status(400).send({ error: "Invalid from/to date" });
    }
    if (rangeFrom.getTime() > rangeTo.getTime()) {
      return reply.status(400).send({ error: "From date cannot be after To date" });
    }
    if (rangeTo.getTime() > todayUtc.getTime()) {
      return reply.status(400).send({ error: "To date cannot be in the future" });
    }

    const rangeFromInclusive = rangeFrom;
    const rangeToExclusive = addDays(rangeTo, 1);

    const dismissedIdsCsv = parsedQuery.dismissed;
    const dismissedCardIds = new Set(
      (dismissedIdsCsv ?? "")
        .split(",")
        .map((rawId) => rawId.trim())
        .filter(Boolean),
    );

    const ratedCompletionsCount = await prisma.recipeCompletion.count({
      where: {
        userId,
        rating: { not: null },
        completedAt: { gte: rangeFromInclusive, lt: rangeToExclusive },
      },
    });
    const reviewsCount = await prisma.restaurantReview.count({
      where: { userId, createdAt: { gte: rangeFromInclusive, lt: rangeToExclusive } },
    });
    const completionsCount = await prisma.recipeCompletion.count({
      where: { userId, completedAt: { gte: rangeFromInclusive, lt: rangeToExclusive } },
    });
    const totalActivities = completionsCount + reviewsCount;

    const thresholds = {
      cooking: { have: ratedCompletionsCount, need: 3 },
      dining: { have: reviewsCount, need: 2 },
      progress: { have: totalActivities, need: 3 },
    };

    const progressEnabled = thresholds.progress.have >= thresholds.progress.need;
    const cookingEnabled = thresholds.cooking.have >= thresholds.cooking.need;
    const diningEnabled = thresholds.dining.have >= thresholds.dining.need;

    const twelveWeeksAgo = new Date(Date.now() - 7 * 12 * 24 * 60 * 60 * 1000);
    const weeklyFrom = rangeFromInclusive.getTime() > twelveWeeksAgo.getTime() ? rangeFromInclusive : twelveWeeksAgo;

    const progress = {
      calendar: [] as Array<{ date: string; recipes: number; dining: number }>,
      weeklyBars: [] as Array<{ weekStart: string; recipes: number; dining: number }>,
      typeBreakdown: { recipes: 0, dining: 0 },
    };

    if (totalActivities > 0) {
      const dailyActivityAggregateRows = await prisma.$queryRaw<
        Array<{ day: string; recipes: bigint; dining: bigint }>
      >`SELECT day::text AS day,
          SUM(recipes_count)::bigint AS recipes,
          SUM(dining_count)::bigint AS dining
        FROM (
          SELECT ((completed_at AT TIME ZONE 'UTC') AT TIME ZONE ${LOCAL_TIMEZONE})::date AS day, COUNT(*)::bigint AS recipes_count, 0::bigint AS dining_count
          FROM recipe_completions
          WHERE user_id = ${userId} AND completed_at >= ${rangeFromInclusive} AND completed_at < ${rangeToExclusive}
          GROUP BY 1
          UNION ALL
          SELECT ((created_at AT TIME ZONE 'UTC') AT TIME ZONE ${LOCAL_TIMEZONE})::date AS day, 0::bigint AS recipes_count, COUNT(*)::bigint AS dining_count
          FROM restaurant_reviews
          WHERE user_id = ${userId} AND created_at >= ${rangeFromInclusive} AND created_at < ${rangeToExclusive}
          GROUP BY 1
        ) x
        GROUP BY day
        ORDER BY day ASC`;

      progress.calendar = (dailyActivityAggregateRows ?? []).map((calendarRow) => ({
        date: calendarRow.day,
        recipes: Number(calendarRow.recipes),
        dining: Number(calendarRow.dining),
      }));

      const breakdownRows = await prisma.$queryRaw<
        Array<{ recipes: bigint; dining: bigint }>
      >`SELECT
          (SELECT COUNT(*) FROM recipe_completions WHERE user_id = ${userId} AND completed_at >= ${rangeFromInclusive} AND completed_at < ${rangeToExclusive}) AS recipes,
          (SELECT COUNT(*) FROM restaurant_reviews WHERE user_id = ${userId} AND created_at >= ${rangeFromInclusive} AND created_at < ${rangeToExclusive}) AS dining`;
      const breakdownRow = breakdownRows[0] ?? { recipes: 0n, dining: 0n };
      progress.typeBreakdown = { recipes: Number(breakdownRow.recipes), dining: Number(breakdownRow.dining) };
    }

    if (progressEnabled) {
      const weeklyActivityAggregateRows = await prisma.$queryRaw<
        Array<{ week_start: string; recipes: bigint; dining: bigint }>
      >`SELECT week_start::text AS week_start,
          SUM(recipes_count)::bigint AS recipes,
          SUM(dining_count)::bigint AS dining
        FROM (
          SELECT date_trunc('week', (completed_at AT TIME ZONE 'UTC') AT TIME ZONE ${LOCAL_TIMEZONE})::date AS week_start, COUNT(*)::bigint AS recipes_count, 0::bigint AS dining_count
          FROM recipe_completions
          WHERE user_id = ${userId} AND completed_at >= ${weeklyFrom} AND completed_at < ${rangeToExclusive}
          GROUP BY 1
          UNION ALL
          SELECT date_trunc('week', (created_at AT TIME ZONE 'UTC') AT TIME ZONE ${LOCAL_TIMEZONE})::date AS week_start, 0::bigint AS recipes_count, COUNT(*)::bigint AS dining_count
          FROM restaurant_reviews
          WHERE user_id = ${userId} AND created_at >= ${weeklyFrom} AND created_at < ${rangeToExclusive}
          GROUP BY 1
        ) x
        GROUP BY week_start
        ORDER BY week_start ASC`;

      progress.weeklyBars = (weeklyActivityAggregateRows ?? []).map((weeklyRow) => ({
        weekStart: weeklyRow.week_start,
        recipes: Number(weeklyRow.recipes),
        dining: Number(weeklyRow.dining),
      }));
    }

    const cooking = { works: [] as InsightCard[], doesntWork: [] as InsightCard[] };
    if (cookingEnabled) {
      const ratedRecipeCompletions = await prisma.recipeCompletion.findMany({
        where: {
          userId,
          rating: { not: null },
          completedAt: { gte: rangeFromInclusive, lt: rangeToExclusive },
        },
        orderBy: { completedAt: "desc" },
        take: 250,
        select: {
          id: true,
          rating: true,
          completedAt: true,
          worked: true,
          didntWork: true,
          recipe: { select: { id: true, totalTimeMinutes: true, graph: true } },
        },
      });

      const higherRatedCompletions = ratedRecipeCompletions.filter((completion) => (completion.rating ?? 0) >= 4);
      const lowerRatedCompletions = ratedRecipeCompletions.filter((completion) => (completion.rating ?? 0) <= 3);

      const cardsWorks: InsightCard[] = [];
      const cardsDoesnt: InsightCard[] = [];

      if (higherRatedCompletions.length >= 3) {
        let countHigherRatedWithSixOrFewerIngredients = 0;
        for (const completion of higherRatedCompletions) {
          const recipeGraph = parseRecipeGraph(completion.recipe.graph);
          if (ingredientNodes(recipeGraph).length <= 6) countHigherRatedWithSixOrFewerIngredients++;
        }
        if (countHigherRatedWithSixOrFewerIngredients / higherRatedCompletions.length >= 0.6) {
          cardsWorks.push({
            id: "cooking.ingredient-count.le6",
            category: "ingredient-count",
            headline: "You finish recipes with 6 or fewer ingredients.",
            detail: `Drawn from your higher-rated recipe completions (n=${higherRatedCompletions.length}).`,
            recordCount: higherRatedCompletions.length,
          });
        }

        const totalTimeMinutesList = higherRatedCompletions
          .map((completion) => completion.recipe.totalTimeMinutes ?? null)
          .filter((minutes): minutes is number => typeof minutes === "number");
        if (totalTimeMinutesList.length >= 3) {
          const averageMinutes =
            totalTimeMinutesList.reduce((sum, minutes) => sum + minutes, 0) / totalTimeMinutesList.length;
          if (averageMinutes <= 30) {
            cardsWorks.push({
              id: "cooking.prep-time.le30",
              category: "prep-time",
              headline: "You tend to finish recipes that take 30 minutes or less.",
              detail: `Based on average total time across higher-rated recipe completions (n=${totalTimeMinutesList.length}).`,
              recordCount: totalTimeMinutesList.length,
            });
          }
        }

        const workedTagCounts = new Map<string, number>();
        for (const completion of ratedRecipeCompletions) {
          const workedTags = Array.isArray(completion.worked) ? (completion.worked as unknown[]) : [];
          for (const workedTag of workedTags) {
            if (typeof workedTag !== "string") continue;
            workedTagCounts.set(workedTag, (workedTagCounts.get(workedTag) ?? 0) + 1);
          }
        }
        for (const topWorkedTag of countTopN(workedTagCounts, 3)) {
          if (topWorkedTag.count < 3) continue;
          cardsWorks.push({
            id: `cooking.worked-tag.${topWorkedTag.key}`,
            category: "worked-tag",
            headline: `“${topWorkedTag.key}” comes up often in what worked for you.`,
            detail: `You’ve tagged this as working ${topWorkedTag.count} times in your recipe completions.`,
            recordCount: topWorkedTag.count,
          });
        }

        const ingredientCounts = new Map<string, number>();
        for (const completion of higherRatedCompletions) {
          const recipeGraph = parseRecipeGraph(completion.recipe.graph);
          for (const ingredient of ingredientNodes(recipeGraph)) {
            const normalizedLabel = normalizeIngredientLabel(ingredient.label);
            if (!normalizedLabel) continue;
            ingredientCounts.set(
              normalizedLabel,
              (ingredientCounts.get(normalizedLabel) ?? 0) + 1,
            );
          }
        }
        for (const topIngredient of countTopN(ingredientCounts, 3)) {
          cardsWorks.push({
            id: `cooking.ingredient-affinity.${topIngredient.key}`,
            category: "ingredient-affinity",
            headline: `“${topIngredient.key}” shows up often in recipes you rate highly.`,
            detail: `Counted across your higher-rated recipe completions.`,
            recordCount: topIngredient.count,
          });
        }

        const dayAndTimeBucketCounts = new Map<string, number>();
        for (const completion of ratedRecipeCompletions) {
          const completedAt = new Date(completion.completedAt);
          const dayAndTimeKey = `${completedAt.getDay()}|${timeOfDayBucket(completedAt)}`;
          dayAndTimeBucketCounts.set(
            dayAndTimeKey,
            (dayAndTimeBucketCounts.get(dayAndTimeKey) ?? 0) + 1,
          );
        }
        const busiestDayTimeBucket = countTopN(dayAndTimeBucketCounts, 1)[0];
        if (busiestDayTimeBucket && busiestDayTimeBucket.count / ratedRecipeCompletions.length >= 0.4) {
          const [weekdayIndexString, timeOfDayLabel] = busiestDayTimeBucket.key.split("|");
          const weekdayIndex = Number(weekdayIndexString);
          const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
          cardsWorks.push({
            id: `cooking.time-cluster.${weekdayIndex}.${timeOfDayLabel}`,
            category: "time-of-week",
            headline: `Many of your recipe completions land on ${weekdayNames[weekdayIndex]} ${timeOfDayLabel}.`,
            detail: `This pattern appears in ${busiestDayTimeBucket.count} of your recipe completions.`,
            recordCount: busiestDayTimeBucket.count,
          });
        }

        // Flavor dominance in higher-rated completions (≥50%).
        const flavorSignatureCounts = new Map<string, number>();
        for (const completion of higherRatedCompletions) {
          const recipeGraph = parseRecipeGraph(completion.recipe.graph);
          const ingredientsForFlavorInference = ingredientNodes(recipeGraph)
            .map((ingredientNode) => ({
              id: ingredientNode.id,
              label: ingredientNode.label,
              detail: ingredientNode.detail,
            }))
            .filter((ingredientRow) => ingredientRow.id && ingredientRow.label);
          const inferredFlavorProfile = await inferFlavorProfile(ingredientsForFlavorInference);
          const flavorBuckets = Object.entries(inferredFlavorProfile)
            .map(([flavorKey, ingredientIds]) => ({
              flavorKey,
              idCount: Array.isArray(ingredientIds) ? ingredientIds.length : 0,
            }))
            .sort((first, second) => second.idCount - first.idCount);
          const primaryFlavorBucket = flavorBuckets[0]?.idCount ? flavorBuckets[0] : null;
          const secondaryFlavorBucket = flavorBuckets[1]?.idCount ? flavorBuckets[1] : null;
          const flavorSignature = primaryFlavorBucket
            ? secondaryFlavorBucket && secondaryFlavorBucket.idCount >= primaryFlavorBucket.idCount * 0.8
              ? `${primaryFlavorBucket.flavorKey}+${secondaryFlavorBucket.flavorKey}`
              : `${primaryFlavorBucket.flavorKey}`
            : "";
          if (!flavorSignature) continue;
          flavorSignatureCounts.set(
            flavorSignature,
            (flavorSignatureCounts.get(flavorSignature) ?? 0) + 1,
          );
        }
        const topFlavorSignature = countTopN(flavorSignatureCounts, 1)[0];
        if (topFlavorSignature && topFlavorSignature.count / higherRatedCompletions.length >= 0.5) {
          cardsWorks.push({
            id: `cooking.flavour.${topFlavorSignature.key}`,
            category: "flavour",
            headline: `Certain flavour profiles show up often in recipes you rate highly.`,
            detail: `“${topFlavorSignature.key}” appears in ${topFlavorSignature.count} of your higher-rated completions.`,
            recordCount: topFlavorSignature.count,
          });
        }

        // Method preference by rating distribution.
        const highRatingMethodCounts = new Map<string, number>();
        for (const completion of ratedRecipeCompletions) {
          const recipeGraph = parseRecipeGraph(completion.recipe.graph);
          const inferredMethodKeys = methodKeysFromGraph(recipeGraph);
          for (const cookingMethodKey of inferredMethodKeys) {
            if ((completion.rating ?? 0) >= 4)
              highRatingMethodCounts.set(
                cookingMethodKey,
                (highRatingMethodCounts.get(cookingMethodKey) ?? 0) + 1,
              );
          }
        }
        const topHighRatingMethod = countTopN(highRatingMethodCounts, 1)[0];
        if (topHighRatingMethod && topHighRatingMethod.count >= 3) {
          cardsWorks.push({
            id: `cooking.method.${topHighRatingMethod.key}.works`,
            category: "cooking-method",
            headline: `Recipes involving “${topHighRatingMethod.key}” show up often in your higher ratings.`,
            detail: `Based on tags inferred from your recipe steps.`,
            recordCount: topHighRatingMethod.count,
          });
        }
      }

      if (lowerRatedCompletions.length >= 3) {
        let countLowerRatedWithTenOrMoreIngredients = 0;
        for (const completion of lowerRatedCompletions) {
          const recipeGraph = parseRecipeGraph(completion.recipe.graph);
          if (ingredientNodes(recipeGraph).length >= 10) countLowerRatedWithTenOrMoreIngredients++;
        }
        if (countLowerRatedWithTenOrMoreIngredients / lowerRatedCompletions.length >= 0.6) {
          cardsDoesnt.push({
            id: "cooking.ingredient-count.ge10",
            category: "ingredient-count",
            headline: "Recipes with 10 or more ingredients often rate lower for you.",
            detail: `Drawn from your lower-rated recipe completions (n=${lowerRatedCompletions.length}).`,
            recordCount: lowerRatedCompletions.length,
          });
        }

        const lowerRatedTimeMinutesList = lowerRatedCompletions
          .map((completion) => completion.recipe.totalTimeMinutes ?? null)
          .filter((minutes): minutes is number => typeof minutes === "number");
        if (lowerRatedTimeMinutesList.length >= 3) {
          const averageLowerRatedMinutes =
            lowerRatedTimeMinutesList.reduce((sum, minutes) => sum + minutes, 0) /
            lowerRatedTimeMinutesList.length;
          if (averageLowerRatedMinutes >= 60) {
            cardsDoesnt.push({
              id: "cooking.prep-time.ge60",
              category: "prep-time",
              headline: "Longer recipes often rate lower for you.",
              detail: `Based on average total time across lower-rated recipe completions (n=${lowerRatedTimeMinutesList.length}).`,
              recordCount: lowerRatedTimeMinutesList.length,
            });
          }
        }

        const didntWorkTagCounts = new Map<string, number>();
        for (const completion of ratedRecipeCompletions) {
          const didntWorkTags = Array.isArray(completion.didntWork) ? (completion.didntWork as unknown[]) : [];
          for (const didntWorkTag of didntWorkTags) {
            if (typeof didntWorkTag !== "string") continue;
            didntWorkTagCounts.set(didntWorkTag, (didntWorkTagCounts.get(didntWorkTag) ?? 0) + 1);
          }
        }
        for (const topDidntWorkTag of countTopN(didntWorkTagCounts, 3)) {
          if (topDidntWorkTag.count < 3) continue;
          cardsDoesnt.push({
            id: `cooking.didnt-work-tag.${topDidntWorkTag.key}`,
            category: "didnt-work-tag",
            headline: `“${topDidntWorkTag.key}” comes up often in what didn’t work for you.`,
            detail: `You’ve tagged this ${topDidntWorkTag.count} times in your recipe completions.`,
            recordCount: topDidntWorkTag.count,
          });
        }

        const lowerRatedIngredientCounts = new Map<string, number>();
        for (const completion of lowerRatedCompletions) {
          const recipeGraph = parseRecipeGraph(completion.recipe.graph);
          for (const ingredient of ingredientNodes(recipeGraph)) {
            const normalizedLabel = normalizeIngredientLabel(ingredient.label);
            if (!normalizedLabel) continue;
            lowerRatedIngredientCounts.set(
              normalizedLabel,
              (lowerRatedIngredientCounts.get(normalizedLabel) ?? 0) + 1,
            );
          }
        }
        for (const topLowerRatedIngredient of countTopN(lowerRatedIngredientCounts, 3)) {
          cardsDoesnt.push({
            id: `cooking.ingredient-avoid.${topLowerRatedIngredient.key}`,
            category: "ingredient-affinity",
            headline: `“${topLowerRatedIngredient.key}” shows up often in recipes you rate lower.`,
            detail: `Counted across your lower-rated recipe completions.`,
            recordCount: topLowerRatedIngredient.count,
          });
        }
      }

      const filterDismissedCards = (insightCards: InsightCard[]) =>
        insightCards.filter((card) => !dismissedCardIds.has(card.id));
      cooking.works = clampTopN(filterDismissedCards(cardsWorks), 3);
      cooking.doesntWork = clampTopN(filterDismissedCards(cardsDoesnt), 3);
    }

    const dining = { works: [] as InsightCard[] };
    if (diningEnabled) {
      const restaurantReviewsInRange = await prisma.restaurantReview.findMany({
        where: { userId, createdAt: { gte: rangeFromInclusive, lt: rangeToExclusive } },
        orderBy: { createdAt: "desc" },
        take: 250,
        include: { place: true },
      });

      const diningInsightCards: InsightCard[] = [];

      // Sensory match: dimensions where lower values correlate with higher overall ratings.
      const sensoryDimensions: Array<{ key: "noise" | "music" | "light" | "crowds" | "smells"; label: string }> = [
        { key: "noise", label: "noise" },
        { key: "music", label: "music" },
        { key: "light", label: "light" },
        { key: "crowds", label: "crowds" },
        { key: "smells", label: "smells" },
      ];
      const overallRatings = restaurantReviewsInRange.map((review) => Number(review.overallRating));
      const sensoryCorrelationRows = sensoryDimensions
        .map((dimension) => {
          const sensoryCalmnessValues = restaurantReviewsInRange.map(
            (review) => 5 - Number((review as any)[`${dimension.key}Rating`] ?? 0),
          );
          return {
            key: dimension.key,
            label: dimension.label,
            correlation: pearson(sensoryCalmnessValues, overallRatings),
            sampleSize: sensoryCalmnessValues.length,
          };
        })
        .filter((row) => row.sampleSize >= 3)
        .sort((first, second) => second.correlation - first.correlation);
      for (const sensoryCorrelation of sensoryCorrelationRows.slice(0, 2)) {
        if (sensoryCorrelation.correlation < 0.35) continue;
        diningInsightCards.push({
          id: `dining.sensory.${sensoryCorrelation.key}`,
          category: "sensory-match",
          headline: `You tend to rate places higher when ${sensoryCorrelation.label} is lower.`,
          detail: `This card is based on patterns across your restaurant reviews.`,
          recordCount: restaurantReviewsInRange.length,
        });
      }

      // Cuisine: favourites or repeated higher ratings.
      const cuisineCounts = new Map<string, number>();
      for (const review of restaurantReviewsInRange) {
        const cuisineLabel = (review.place.cuisine ?? "").trim();
        if (!cuisineLabel) continue;
        if (Number(review.overallRating) >= 4) {
          cuisineCounts.set(cuisineLabel, (cuisineCounts.get(cuisineLabel) ?? 0) + 1);
        }
      }
      const topCuisine = countTopN(cuisineCounts, 1)[0];
      if (topCuisine && topCuisine.count >= 2) {
        diningInsightCards.push({
          id: `dining.cuisine.${topCuisine.key}`,
          category: "cuisine",
          headline: `You often rate ${topCuisine.key} places highly.`,
          detail: `Based on ${topCuisine.count} reviews with higher overall ratings.`,
          recordCount: topCuisine.count,
        });
      }

      // Best windows: aggregate bestTimesOfDay.
      const preferredTimeSlotCounts = new Map<string, number>();
      for (const review of restaurantReviewsInRange) {
        const bestTimeChoices = Array.isArray(review.bestTimesOfDay)
          ? (review.bestTimesOfDay as unknown[])
          : [];
        for (const timeChoice of bestTimeChoices) {
          if (typeof timeChoice !== "string") continue;
          const trimmedTimeLabel = timeChoice.trim();
          if (!trimmedTimeLabel) continue;
          preferredTimeSlotCounts.set(
            trimmedTimeLabel,
            (preferredTimeSlotCounts.get(trimmedTimeLabel) ?? 0) + 1,
          );
        }
      }
      const topPreferredTimeSlots = countTopN(preferredTimeSlotCounts, 2).filter(
        (timeBucket) => timeBucket.count >= 2,
      );
      if (topPreferredTimeSlots.length) {
        const combinedTimeLabels = topPreferredTimeSlots.map((timeBucket) => timeBucket.key).join(" and ");
        const totalBestTimeSelections = topPreferredTimeSlots.reduce(
          (runningTotal, timeBucket) => runningTotal + timeBucket.count,
          0,
        );
        diningInsightCards.push({
          id: `dining.best-windows.${topPreferredTimeSlots.map((timeBucket) => timeBucket.key).join("+")}`,
          category: "best-windows",
          headline: `You often choose ${combinedTimeLabels} as a good time to go.`,
          detail: `Based on what you’ve picked in your reviews.`,
          recordCount: totalBestTimeSelections,
        });
      }

      dining.works = clampTopN(diningInsightCards.filter((card) => !dismissedCardIds.has(card.id)), 3);
    }

    const lifetimeStatsRows = await prisma.$queryRaw<
      Array<{
        cooking_days_total: bigint;
        dining_days_total: bigint;
        dining_total: bigint;
        first_activity_day: string | null;
      }>
    >`SELECT
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

    const lifetimeStats = lifetimeStatsRows[0] ?? {
      cooking_days_total: 0n,
      dining_days_total: 0n,
      dining_total: 0n,
      first_activity_day: null,
    };

    const cookingDaysTotalLifetime = Number(lifetimeStats.cooking_days_total ?? 0n);
    const diningDaysTotalLifetime = Number(lifetimeStats.dining_days_total ?? 0n);
    const diningTotalLifetime = Number(lifetimeStats.dining_total ?? 0n);
    const firstActivityIsoDay = lifetimeStats.first_activity_day ?? null;
    const todayMelbourneIso = localCalendarDateString(new Date());
    const daysSinceFirstActivity = firstActivityIsoDay
      ? Math.max(
          1,
          Math.round(
            (Date.UTC(
              Number(todayMelbourneIso.slice(0, 4)),
              Number(todayMelbourneIso.slice(5, 7)) - 1,
              Number(todayMelbourneIso.slice(8, 10)),
            ) -
              Date.UTC(
                Number(firstActivityIsoDay.slice(0, 4)),
                Number(firstActivityIsoDay.slice(5, 7)) - 1,
                Number(firstActivityIsoDay.slice(8, 10)),
              )) /
              86_400_000,
          ) + 1,
        )
      : 0;

    const lifetime = {
      cookingDaysTotal: cookingDaysTotalLifetime,
      diningDaysTotal: diningDaysTotalLifetime,
      diningTotal: diningTotalLifetime,
      firstActivityDate: firstActivityIsoDay,
      daysSinceFirstActivity,
    };

    // Current-week (Monday-anchored, Melbourne local) counters for the progress gauges.
    // These reset to 0 every Monday at midnight local time.
    const thisWeekRows = await prisma.$queryRaw<
      Array<{ week_start: string; cooking_days: bigint; dining_reviews: bigint }>
    >`SELECT
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

    const thisWeekRow = thisWeekRows[0] ?? { week_start: null, cooking_days: 0n, dining_reviews: 0n };
    const thisWeek = {
      weekStart: thisWeekRow.week_start ?? null,
      cookingDays: Number(thisWeekRow.cooking_days ?? 0n),
      diningReviews: Number(thisWeekRow.dining_reviews ?? 0n),
    };

    return reply.send({
      range: { from: isoDateOnly(rangeFromInclusive), to: isoDateOnly(rangeTo) },
      progress,
      cooking,
      dining,
      thresholds,
      lifetime,
      thisWeek,
    });
  });
}

