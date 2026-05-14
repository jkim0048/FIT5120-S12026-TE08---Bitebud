import {
  addDays,
  isoDateOnly,
  localCalendarDateString,
} from "../calendarDate.js";
import { recipeDatabase } from "../database/recipeDatabase.js";
import { restaurantDatabase } from "../database/restaurantDatabase.js";
import {
  findActivityBreakdown,
  findDailyActivityAggregate,
  findLifetimeActivityStats,
  findThisWeekActivityStats,
  findWeeklyActivityAggregate,
} from "../database/userActivityDatabase.js";
import { parseRecipeGraph } from "../graph/recipeGraph.js";
import { inferFlavorProfileHeuristic } from "./flavorProfile.js";
import {
  ingredientNodes,
  methodKeysFromGraph,
  normalizeIngredientLabel,
  timeOfDayBucket,
} from "./userActivityService.js";

const MS_PER_DAY = 86_400_000;
const WEEK_DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const COOKING_THRESHOLD = 3;
const DINING_THRESHOLD = 2;
const PROGRESS_THRESHOLD = 3;
const COMPLETION_FETCH_LIMIT = 250;
const REVIEW_FETCH_LIMIT = 250;
const MIN_HIGH_RATING = 4;
const MAX_LOW_RATING = 3;
const WEEKS_OF_WEEKLY_BARS = 12;
const HIGH_INGREDIENT_RATIO_THRESHOLD = 0.6;
const FLAVOR_DOMINANCE_RATIO = 0.5;
const SECONDARY_FLAVOR_RATIO = 0.8;
const PREP_TIME_LOW_AVERAGE = 30;
const PREP_TIME_HIGH_AVERAGE = 60;
const LE6_INGREDIENT_CEILING = 6;
const GE10_INGREDIENT_FLOOR = 10;
const TIME_CLUSTER_DOMINANCE = 0.4;
const TAG_REPEAT_THRESHOLD = 3;
const METHOD_REPEAT_THRESHOLD = 3;
const SENSORY_MIN_SAMPLE_SIZE = 3;
const SENSORY_MIN_CORRELATION = 0.35;
const CUISINE_REPEAT_THRESHOLD = 2;
const TIME_BUCKET_REPEAT_THRESHOLD = 2;
const TOP_INSIGHT_CARDS = 3;

export type InsightCard = {
  id: string;
  category: string;
  headline: string;
  detail: string;
  recordCount: number;
};

export type InsightsPayload = {
  range: { from: string; to: string };
  progress: {
    calendar: Array<{ date: string; recipes: number; dining: number }>;
    weeklyBars: Array<{ weekStart: string; recipes: number; dining: number }>;
    typeBreakdown: { recipes: number; dining: number };
  };
  cooking: { works: InsightCard[]; doesntWork: InsightCard[] };
  dining: { works: InsightCard[] };
  thresholds: {
    cooking: { have: number; need: number };
    dining: { have: number; need: number };
    progress: { have: number; need: number };
  };
  lifetime: {
    cookingDaysTotal: number;
    diningDaysTotal: number;
    diningTotal: number;
    firstActivityDate: string | null;
    daysSinceFirstActivity: number;
  };
  thisWeek: {
    weekStart: string | null;
    cookingDays: number;
    diningReviews: number;
  };
};

/** Slice an array to at most `maxCount` elements (non-negative). */
export function clampTopN<T>(items: T[], maxCount: number): T[] {
  return items.slice(0, Math.max(0, maxCount));
}

/** Return the top `maxEntries` entries of a count map, sorted by descending count. */
export function countTopN(
  map: Map<string, number>,
  maxEntries: number,
): Array<{ key: string; count: number }> {
  return clampTopN(
    Array.from(map.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((first, second) => second.count - first.count),
    maxEntries,
  );
}

/** Pearson correlation between two equal-length numeric series; returns 0 for degenerate input. */
export function pearson(xs: number[], ys: number[]): number {
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

export type InsightsRequest = {
  userId: string;
  rangeFromInclusive: Date;
  rangeTo: Date;
  dismissedCardIds: Set<string>;
};

/** Build the full `/api/me/insights` response payload from the user's recent activity. */
export async function buildInsightsPayload(request: InsightsRequest): Promise<InsightsPayload> {
  const { userId, rangeFromInclusive, rangeTo, dismissedCardIds } = request;
  const rangeToExclusive = addDays(rangeTo, 1);

  const [
    ratedCompletionsCount,
    reviewsCount,
    completionsCount,
    lifetimeStats,
    thisWeekRow,
  ] = await Promise.all([
    recipeDatabase.recipeCompletionCount({
      where: {
        userId,
        rating: { not: null },
        completedAt: { gte: rangeFromInclusive, lt: rangeToExclusive },
      },
    }),
    restaurantDatabase.restaurantReviewCount({
      where: { userId, createdAt: { gte: rangeFromInclusive, lt: rangeToExclusive } },
    }),
    recipeDatabase.recipeCompletionCount({
      where: { userId, completedAt: { gte: rangeFromInclusive, lt: rangeToExclusive } },
    }),
    findLifetimeActivityStats(userId),
    findThisWeekActivityStats(userId),
  ]);
  const totalActivities = completionsCount + reviewsCount;

  const thresholds = {
    cooking: { have: ratedCompletionsCount, need: COOKING_THRESHOLD },
    dining: { have: reviewsCount, need: DINING_THRESHOLD },
    progress: { have: totalActivities, need: PROGRESS_THRESHOLD },
  };

  const progressEnabled = thresholds.progress.have >= thresholds.progress.need;
  const cookingEnabled = thresholds.cooking.have >= thresholds.cooking.need;
  const diningEnabled = thresholds.dining.have >= thresholds.dining.need;

  const twelveWeeksAgo = new Date(
    Date.now() - 7 * WEEKS_OF_WEEKLY_BARS * 24 * 60 * 60 * 1000,
  );
  const weeklyFrom =
    rangeFromInclusive.getTime() > twelveWeeksAgo.getTime() ? rangeFromInclusive : twelveWeeksAgo;

  const progress = {
    calendar: [] as Array<{ date: string; recipes: number; dining: number }>,
    weeklyBars: [] as Array<{ weekStart: string; recipes: number; dining: number }>,
    typeBreakdown: { recipes: 0, dining: 0 },
  };

  if (totalActivities > 0) {
    const [dailyActivityAggregateRows, breakdownRow] = await Promise.all([
      findDailyActivityAggregate(userId, rangeFromInclusive, rangeToExclusive),
      findActivityBreakdown(userId, rangeFromInclusive, rangeToExclusive),
    ]);
    progress.calendar = (dailyActivityAggregateRows ?? []).map((calendarRow) => ({
      date: calendarRow.day,
      recipes: Number(calendarRow.recipes),
      dining: Number(calendarRow.dining),
    }));

    progress.typeBreakdown = {
      recipes: Number(breakdownRow.recipes),
      dining: Number(breakdownRow.dining),
    };
  }

  if (progressEnabled) {
    const weeklyActivityAggregateRows = await findWeeklyActivityAggregate(
      userId,
      weeklyFrom,
      rangeToExclusive,
    );
    progress.weeklyBars = (weeklyActivityAggregateRows ?? []).map((weeklyRow) => ({
      weekStart: weeklyRow.week_start,
      recipes: Number(weeklyRow.recipes),
      dining: Number(weeklyRow.dining),
    }));
  }

  const cooking = { works: [] as InsightCard[], doesntWork: [] as InsightCard[] };
  if (cookingEnabled) {
    const ratedRecipeCompletions = await recipeDatabase.recipeCompletionFindMany({
      where: {
        userId,
        rating: { not: null },
        completedAt: { gte: rangeFromInclusive, lt: rangeToExclusive },
      },
      orderBy: { completedAt: "desc" },
      take: COMPLETION_FETCH_LIMIT,
      select: {
        id: true,
        rating: true,
        completedAt: true,
        worked: true,
        didntWork: true,
        recipe: { select: { id: true, totalTimeMinutes: true, graph: true } },
      },
    });

    const higherRatedCompletions = ratedRecipeCompletions.filter(
      (completion) => (completion.rating ?? 0) >= MIN_HIGH_RATING,
    );
    const lowerRatedCompletions = ratedRecipeCompletions.filter(
      (completion) => (completion.rating ?? 0) <= MAX_LOW_RATING,
    );

    const cardsWorks: InsightCard[] = [];
    const cardsDoesnt: InsightCard[] = [];

    if (higherRatedCompletions.length >= COOKING_THRESHOLD) {
      let countHigherRatedWithSixOrFewerIngredients = 0;
      for (const completion of higherRatedCompletions) {
        const recipeGraph = parseRecipeGraph(completion.recipe.graph);
        if (ingredientNodes(recipeGraph).length <= LE6_INGREDIENT_CEILING) {
          countHigherRatedWithSixOrFewerIngredients++;
        }
      }
      if (
        countHigherRatedWithSixOrFewerIngredients / higherRatedCompletions.length >=
        HIGH_INGREDIENT_RATIO_THRESHOLD
      ) {
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
      if (totalTimeMinutesList.length >= COOKING_THRESHOLD) {
        const averageMinutes =
          totalTimeMinutesList.reduce((sum, minutes) => sum + minutes, 0) /
          totalTimeMinutesList.length;
        if (averageMinutes <= PREP_TIME_LOW_AVERAGE) {
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
      for (const topWorkedTag of countTopN(workedTagCounts, TOP_INSIGHT_CARDS)) {
        if (topWorkedTag.count < TAG_REPEAT_THRESHOLD) continue;
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
      for (const topIngredient of countTopN(ingredientCounts, TOP_INSIGHT_CARDS)) {
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
      if (
        busiestDayTimeBucket &&
        busiestDayTimeBucket.count / ratedRecipeCompletions.length >= TIME_CLUSTER_DOMINANCE
      ) {
        const [weekdayIndexString, timeOfDayLabel] = busiestDayTimeBucket.key.split("|");
        const weekdayIndex = Number(weekdayIndexString);
        cardsWorks.push({
          id: `cooking.time-cluster.${weekdayIndex}.${timeOfDayLabel}`,
          category: "time-of-week",
          headline: `Many of your recipe completions land on ${WEEK_DAY_NAMES[weekdayIndex]} ${timeOfDayLabel}.`,
          detail: `This pattern appears in ${busiestDayTimeBucket.count} of your recipe completions.`,
          recordCount: busiestDayTimeBucket.count,
        });
      }

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
        const inferredFlavorProfile = inferFlavorProfileHeuristic(ingredientsForFlavorInference);
        const flavorBuckets = Object.entries(inferredFlavorProfile)
          .map(([flavorKey, ingredientIds]) => ({
            flavorKey,
            idCount: Array.isArray(ingredientIds) ? ingredientIds.length : 0,
          }))
          .sort((first, second) => second.idCount - first.idCount);
        const primaryFlavorBucket = flavorBuckets[0]?.idCount ? flavorBuckets[0] : null;
        const secondaryFlavorBucket = flavorBuckets[1]?.idCount ? flavorBuckets[1] : null;
        const flavorSignature = primaryFlavorBucket
          ? secondaryFlavorBucket &&
            secondaryFlavorBucket.idCount >= primaryFlavorBucket.idCount * SECONDARY_FLAVOR_RATIO
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
      if (
        topFlavorSignature &&
        topFlavorSignature.count / higherRatedCompletions.length >= FLAVOR_DOMINANCE_RATIO
      ) {
        cardsWorks.push({
          id: `cooking.flavour.${topFlavorSignature.key}`,
          category: "flavour",
          headline: `Certain flavour profiles show up often in recipes you rate highly.`,
          detail: `“${topFlavorSignature.key}” appears in ${topFlavorSignature.count} of your higher-rated completions.`,
          recordCount: topFlavorSignature.count,
        });
      }

      const highRatingMethodCounts = new Map<string, number>();
      for (const completion of ratedRecipeCompletions) {
        const recipeGraph = parseRecipeGraph(completion.recipe.graph);
        const inferredMethodKeys = methodKeysFromGraph(recipeGraph);
        for (const cookingMethodKey of inferredMethodKeys) {
          if ((completion.rating ?? 0) >= MIN_HIGH_RATING) {
            highRatingMethodCounts.set(
              cookingMethodKey,
              (highRatingMethodCounts.get(cookingMethodKey) ?? 0) + 1,
            );
          }
        }
      }
      const topHighRatingMethod = countTopN(highRatingMethodCounts, 1)[0];
      if (topHighRatingMethod && topHighRatingMethod.count >= METHOD_REPEAT_THRESHOLD) {
        cardsWorks.push({
          id: `cooking.method.${topHighRatingMethod.key}.works`,
          category: "cooking-method",
          headline: `Recipes involving “${topHighRatingMethod.key}” show up often in your higher ratings.`,
          detail: `Based on tags inferred from your recipe steps.`,
          recordCount: topHighRatingMethod.count,
        });
      }
    }

    if (lowerRatedCompletions.length >= COOKING_THRESHOLD) {
      let countLowerRatedWithTenOrMoreIngredients = 0;
      for (const completion of lowerRatedCompletions) {
        const recipeGraph = parseRecipeGraph(completion.recipe.graph);
        if (ingredientNodes(recipeGraph).length >= GE10_INGREDIENT_FLOOR) {
          countLowerRatedWithTenOrMoreIngredients++;
        }
      }
      if (
        countLowerRatedWithTenOrMoreIngredients / lowerRatedCompletions.length >=
        HIGH_INGREDIENT_RATIO_THRESHOLD
      ) {
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
      if (lowerRatedTimeMinutesList.length >= COOKING_THRESHOLD) {
        const averageLowerRatedMinutes =
          lowerRatedTimeMinutesList.reduce((sum, minutes) => sum + minutes, 0) /
          lowerRatedTimeMinutesList.length;
        if (averageLowerRatedMinutes >= PREP_TIME_HIGH_AVERAGE) {
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
        const didntWorkTags = Array.isArray(completion.didntWork)
          ? (completion.didntWork as unknown[])
          : [];
        for (const didntWorkTag of didntWorkTags) {
          if (typeof didntWorkTag !== "string") continue;
          didntWorkTagCounts.set(didntWorkTag, (didntWorkTagCounts.get(didntWorkTag) ?? 0) + 1);
        }
      }
      for (const topDidntWorkTag of countTopN(didntWorkTagCounts, TOP_INSIGHT_CARDS)) {
        if (topDidntWorkTag.count < TAG_REPEAT_THRESHOLD) continue;
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
      for (const topLowerRatedIngredient of countTopN(
        lowerRatedIngredientCounts,
        TOP_INSIGHT_CARDS,
      )) {
        cardsDoesnt.push({
          id: `cooking.ingredient-avoid.${topLowerRatedIngredient.key}`,
          category: "ingredient-affinity",
          headline: `“${topLowerRatedIngredient.key}” shows up often in recipes you rate lower.`,
          detail: `Counted across your lower-rated recipe completions.`,
          recordCount: topLowerRatedIngredient.count,
        });
      }
    }

    const filterDismissedCards = (cards: InsightCard[]) =>
      cards.filter((card) => !dismissedCardIds.has(card.id));
    cooking.works = clampTopN(filterDismissedCards(cardsWorks), TOP_INSIGHT_CARDS);
    cooking.doesntWork = clampTopN(filterDismissedCards(cardsDoesnt), TOP_INSIGHT_CARDS);
  }

  const dining = { works: [] as InsightCard[] };
  if (diningEnabled) {
    const restaurantReviewsInRange = await restaurantDatabase.restaurantReviewFindMany({
      where: { userId, createdAt: { gte: rangeFromInclusive, lt: rangeToExclusive } },
      orderBy: { createdAt: "desc" },
      take: REVIEW_FETCH_LIMIT,
      include: { place: true },
    });

    const diningInsightCards: InsightCard[] = [];

    const sensoryDimensions: Array<{
      key: "noise" | "music" | "light" | "crowds" | "smells";
      label: string;
    }> = [
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
          (review) =>
            5 - Number((review as unknown as Record<string, number>)[`${dimension.key}Rating`] ?? 0),
        );
        return {
          key: dimension.key,
          label: dimension.label,
          correlation: pearson(sensoryCalmnessValues, overallRatings),
          sampleSize: sensoryCalmnessValues.length,
        };
      })
      .filter((row) => row.sampleSize >= SENSORY_MIN_SAMPLE_SIZE)
      .sort((first, second) => second.correlation - first.correlation);
    for (const sensoryCorrelation of sensoryCorrelationRows.slice(0, 2)) {
      if (sensoryCorrelation.correlation < SENSORY_MIN_CORRELATION) continue;
      diningInsightCards.push({
        id: `dining.sensory.${sensoryCorrelation.key}`,
        category: "sensory-match",
        headline: `You tend to rate places higher when ${sensoryCorrelation.label} is lower.`,
        detail: `This card is based on patterns across your restaurant reviews.`,
        recordCount: restaurantReviewsInRange.length,
      });
    }

    const cuisineCounts = new Map<string, number>();
    for (const review of restaurantReviewsInRange) {
      const cuisineLabel = (review.place.cuisine ?? "").trim();
      if (!cuisineLabel) continue;
      if (Number(review.overallRating) >= MIN_HIGH_RATING) {
        cuisineCounts.set(cuisineLabel, (cuisineCounts.get(cuisineLabel) ?? 0) + 1);
      }
    }
    const topCuisine = countTopN(cuisineCounts, 1)[0];
    if (topCuisine && topCuisine.count >= CUISINE_REPEAT_THRESHOLD) {
      diningInsightCards.push({
        id: `dining.cuisine.${topCuisine.key}`,
        category: "cuisine",
        headline: `You often rate ${topCuisine.key} places highly.`,
        detail: `Based on ${topCuisine.count} reviews with higher overall ratings.`,
        recordCount: topCuisine.count,
      });
    }

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
      (timeBucket) => timeBucket.count >= TIME_BUCKET_REPEAT_THRESHOLD,
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

    dining.works = clampTopN(
      diningInsightCards.filter((card) => !dismissedCardIds.has(card.id)),
      TOP_INSIGHT_CARDS,
    );
  }

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
            MS_PER_DAY,
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

  const thisWeek = {
    weekStart: thisWeekRow.week_start || null,
    cookingDays: Number(thisWeekRow.cooking_days ?? 0n),
    diningReviews: Number(thisWeekRow.dining_reviews ?? 0n),
  };

  return {
    range: { from: isoDateOnly(rangeFromInclusive), to: isoDateOnly(rangeTo) },
    progress,
    cooking,
    dining,
    thresholds,
    lifetime,
    thisWeek,
  };
}
