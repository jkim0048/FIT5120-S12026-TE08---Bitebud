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
/** Minimum reviews with overall rating at/below `MAX_LOW_RATING` needed to show dining "doesn't work" cards. */
const DINING_NEGATIVE_MIN_REVIEWS = 3;
const PROGRESS_THRESHOLD = 3;
const COMPLETION_FETCH_LIMIT = 250;
const REVIEW_FETCH_LIMIT = 250;
/** When insights run over lifetime (no dated window), fetch more rows for patterns (still capped). */
const COMPLETION_FETCH_LIMIT_FULL_HISTORY = 5000;
const REVIEW_FETCH_LIMIT_FULL_HISTORY = 5000;
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
  /** Optional gentle suggestion for the user (plain language). */
  takeaway?: string;
};

export type InsightsPayload = {
  range: { from: string; to: string };
  progress: {
    calendar: Array<{ date: string; recipes: number; dining: number }>;
    weeklyBars: Array<{ weekStart: string; recipes: number; dining: number }>;
    typeBreakdown: { recipes: number; dining: number };
  };
  cooking: { works: InsightCard[]; doesntWork: InsightCard[] };
  dining: { works: InsightCard[]; doesntWork: InsightCard[] };
  thresholds: {
    cooking: { have: number; need: number };
    dining: { have: number; need: number };
    progress: { have: number; need: number };
    /** Rated recipe completions in range with stars at/below `MAX_LOW_RATING` (watch-out gate). */
    cookingLowRated: { have: number; need: number };
    /** Restaurant reviews in range with overall at/below `MAX_LOW_RATING` (dining watch-out gate). */
    diningLowRated: { have: number; need: number };
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

/** Lower sort key = higher priority when picking diverse insight cards. */
const INSIGHT_CATEGORY_PRIORITY: Record<string, number> = {
  "worked-tag": 1,
  "didnt-work-tag": 1,
  "ingredient-affinity": 2,
  "ingredient-count": 3,
  "prep-time": 4,
  "sensory-match": 4,
  "sensory-mismatch": 4,
  cuisine: 5,
  "cuisine-mismatch": 5,
  "time-of-week": 6,
  "best-windows": 6,
  flavour: 7,
  "cooking-method": 8,
};

/** Skip noisy ingredient labels before ingredient-affinity cards (e.g. "to taste salt"). */
export function isUsableIngredientInsightLabel(normalizedLabel: string): boolean {
  const label = normalizedLabel.trim();
  if (label.length < 3) return false;
  if (/^to taste\b/.test(label)) return false;
  if (/\bto taste\b/.test(label) && label.split(/\s+/).length <= 4) return false;
  if (/^(optional|garnish|serving|as needed)$/.test(label)) return false;
  return true;
}

function capitalizeWord(word: string): string {
  if (!word.length) return "";
  return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`;
}

/**
 * Readable title-style phrase for user-facing insight copy: spaces, hyphens, underscores,
 * and camelCase boundaries (e.g. `lowPrep`, `low-prep`, `chicken breast` → `Low Prep`, `Chicken Breast`).
 */
function formatInsightLabelPhrase(raw: string): string {
  const withCamelSplits = raw
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return withCamelSplits
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(capitalizeWord)
    .join(" ");
}

function humanizeChipLabel(chipKey: string): string {
  return formatInsightLabelPhrase(chipKey);
}

function titleCaseWords(value: string): string {
  return formatInsightLabelPhrase(value);
}

function humanizeFlavorSignature(signature: string): string {
  return signature
    .split("+")
    .filter(Boolean)
    .map((part) => humanizeChipLabel(part.trim()))
    .join(" and ");
}

function mealsRatedDetail(count: number, highRated: boolean): string {
  const band = highRated ? "4–5 stars" : "3 stars or below";
  const mealWord = count === 1 ? "meal" : "meals";
  return `Based on ${count} ${mealWord} you rated ${band} in this period.`;
}

function reviewsDetail(count: number, highRated: boolean): string {
  const band = highRated ? "4 or above" : "3 or below";
  const reviewWord = count === 1 ? "review" : "reviews";
  return `Based on ${count} ${reviewWord} you rated ${band} overall in this period.`;
}

function ingredientAppearedDetail(
  ingredientLabel: string,
  mealCount: number,
  highRated: boolean,
): string {
  const name = titleCaseWords(ingredientLabel);
  const mealWord = mealCount === 1 ? "meal" : "meals";
  const band = highRated ? "4–5 stars" : "3 stars or below";
  return `${name} appeared in ${mealCount} ${mealWord} you rated ${band} in this period.`;
}

function cuisineAppearedDetail(cuisineLabel: string, reviewCount: number, highRated: boolean): string {
  const name = titleCaseWords(cuisineLabel);
  const reviewWord = reviewCount === 1 ? "review" : "reviews";
  const band = highRated ? "4 or above" : "3 or below";
  return `${name} showed up in ${reviewCount} ${reviewWord} you rated ${band} overall in this period.`;
}

const INSIGHT_TAKEAWAYS: Record<string, { works: string; doesnt: string }> = {
  "ingredient-count": {
    works: "When you plan meals, shorter ingredient lists may feel more manageable.",
    doesnt: "Consider simpler recipes or splitting a big shop across two sessions.",
  },
  "prep-time": {
    works: "Quick wins on busy days may suit you better than long cooks.",
    doesnt: "On tougher days, look for recipes under an hour or prep ahead.",
  },
  "worked-tag": {
    works: "If this keeps showing up, lean on it when you plan your next meal.",
    doesnt: "",
  },
  "didnt-work-tag": {
    works: "",
    doesnt: "If this keeps coming up, factor it in before you start cooking.",
  },
  "ingredient-affinity": {
    works: "This may be a reliable ingredient when planning simple meals.",
    doesnt: "You might simplify the dish or try a different protein or main ingredient.",
  },
  "time-of-week": {
    works: "You could batch prep or plan favourites for that day and time.",
    doesnt: "",
  },
  flavour: {
    works: "Meals with these flavour notes tended to land well for you.",
    doesnt: "",
  },
  "cooking-method": {
    works: "Recipes using this method showed up in meals you loved.",
    doesnt: "",
  },
  "sensory-match": {
    works: "Quieter or calmer settings on this dimension may suit you best.",
    doesnt: "",
  },
  "sensory-mismatch": {
    works: "",
    doesnt: "Check reviews or photos for noise and vibe before you book.",
  },
  cuisine: {
    works: "This cuisine has lined up with your higher scores recently.",
    doesnt: "",
  },
  "cuisine-mismatch": {
    works: "",
    doesnt: "You might try a different cuisine or a more familiar option next time.",
  },
  "best-windows": {
    works: "Going at these times may improve how a meal out feels.",
    doesnt: "",
  },
};

function takeawayFor(category: string, works: boolean): string | undefined {
  const row = INSIGHT_TAKEAWAYS[category];
  if (!row) return undefined;
  const text = (works ? row.works : row.doesnt).trim();
  return text || undefined;
}

/**
 * Pick up to `maxCount` cards: prefer one per category, then highest recordCount,
 * then fill remaining slots.
 */
export function selectDiverseInsightCards(
  cards: InsightCard[],
  maxCount: number,
): InsightCard[] {
  if (cards.length <= maxCount) return cards;
  const sorted = [...cards].sort((first, second) => {
    const priorityDiff =
      (INSIGHT_CATEGORY_PRIORITY[first.category] ?? 99) -
      (INSIGHT_CATEGORY_PRIORITY[second.category] ?? 99);
    if (priorityDiff !== 0) return priorityDiff;
    return second.recordCount - first.recordCount;
  });
  const picked: InsightCard[] = [];
  const seenCategories = new Set<string>();
  for (const card of sorted) {
    if (picked.length >= maxCount) break;
    if (seenCategories.has(card.category)) continue;
    seenCategories.add(card.category);
    picked.push(card);
  }
  if (picked.length < maxCount) {
    for (const card of sorted) {
      if (picked.length >= maxCount) break;
      if (picked.some((existing) => existing.id === card.id)) continue;
      picked.push(card);
    }
  }
  return picked;
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
  /** Omitted-range insights: widen rows pulled for completions/reviews pattern mining. */
  fullHistoryInsights?: boolean;
};

/** Build the full `/api/me/insights` response payload from the user's recent activity. */
export async function buildInsightsPayload(request: InsightsRequest): Promise<InsightsPayload> {
  const {
    userId,
    rangeFromInclusive,
    rangeTo,
    dismissedCardIds,
    fullHistoryInsights = false,
  } = request;
  const rangeToExclusive = addDays(rangeTo, 1);
  const completionTake = fullHistoryInsights ? COMPLETION_FETCH_LIMIT_FULL_HISTORY : COMPLETION_FETCH_LIMIT;
  const reviewTake = fullHistoryInsights ? REVIEW_FETCH_LIMIT_FULL_HISTORY : REVIEW_FETCH_LIMIT;

  const [
    ratedCompletionsCount,
    ratedCompletionsLowCount,
    reviewsCount,
    reviewsLowCount,
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
    recipeDatabase.recipeCompletionCount({
      where: {
        userId,
        rating: { not: null, lte: MAX_LOW_RATING },
        completedAt: { gte: rangeFromInclusive, lt: rangeToExclusive },
      },
    }),
    restaurantDatabase.restaurantReviewCount({
      where: { userId, createdAt: { gte: rangeFromInclusive, lt: rangeToExclusive } },
    }),
    restaurantDatabase.restaurantReviewCount({
      where: {
        userId,
        overallRating: { lte: MAX_LOW_RATING },
        createdAt: { gte: rangeFromInclusive, lt: rangeToExclusive },
      },
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
    cookingLowRated: { have: ratedCompletionsLowCount, need: COOKING_THRESHOLD },
    diningLowRated: { have: reviewsLowCount, need: DINING_NEGATIVE_MIN_REVIEWS },
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
      take: completionTake,
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
          headline: "Simpler recipes suit you (usually 6 ingredients or fewer).",
          detail: mealsRatedDetail(higherRatedCompletions.length, true),
          recordCount: higherRatedCompletions.length,
          takeaway: takeawayFor("ingredient-count", true),
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
            headline: "Quicker meals suit you (often under 30 minutes).",
            detail: mealsRatedDetail(totalTimeMinutesList.length, true),
            recordCount: totalTimeMinutesList.length,
            takeaway: takeawayFor("prep-time", true),
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
          headline: `What you said helped: ${humanizeChipLabel(topWorkedTag.key)}`,
          detail: `You chose this ${topWorkedTag.count} time${topWorkedTag.count === 1 ? "" : "s"} when finishing a recipe in this period.`,
          recordCount: topWorkedTag.count,
          takeaway: takeawayFor("worked-tag", true),
        });
      }

      const ingredientCounts = new Map<string, number>();
      for (const completion of higherRatedCompletions) {
        const recipeGraph = parseRecipeGraph(completion.recipe.graph);
        for (const ingredient of ingredientNodes(recipeGraph)) {
          const normalizedLabel = normalizeIngredientLabel(ingredient.label);
          if (!normalizedLabel || !isUsableIngredientInsightLabel(normalizedLabel)) continue;
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
          headline: `Often in meals you loved: ${titleCaseWords(topIngredient.key)}`,
          detail: ingredientAppearedDetail(topIngredient.key, topIngredient.count, true),
          recordCount: topIngredient.count,
          takeaway: takeawayFor("ingredient-affinity", true),
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
          headline: `You often cook on ${WEEK_DAY_NAMES[weekdayIndex]} ${humanizeChipLabel(timeOfDayLabel)}.`,
          detail: `${busiestDayTimeBucket.count} of your rated completions in this period were at that time.`,
          recordCount: busiestDayTimeBucket.count,
          takeaway: takeawayFor("time-of-week", true),
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
          headline: `Flavours you enjoy: ${humanizeFlavorSignature(topFlavorSignature.key)}`,
          detail: mealsRatedDetail(topFlavorSignature.count, true),
          recordCount: topFlavorSignature.count,
          takeaway: takeawayFor("flavour", true),
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
          headline: `Cooking style that suits you: ${humanizeChipLabel(topHighRatingMethod.key)}`,
          detail: `Found in ${topHighRatingMethod.count} highly rated meal${topHighRatingMethod.count === 1 ? "" : "s"} from your recipe steps.`,
          recordCount: topHighRatingMethod.count,
          takeaway: takeawayFor("cooking-method", true),
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
          headline: "Big shopping lists are harder (10+ ingredients).",
          detail: mealsRatedDetail(lowerRatedCompletions.length, false),
          recordCount: lowerRatedCompletions.length,
          takeaway: takeawayFor("ingredient-count", false),
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
            headline: "Long cooks are harder (often over 60 minutes).",
            detail: mealsRatedDetail(lowerRatedTimeMinutesList.length, false),
            recordCount: lowerRatedTimeMinutesList.length,
            takeaway: takeawayFor("prep-time", false),
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
          headline: `What you said didn’t help: ${humanizeChipLabel(topDidntWorkTag.key)}`,
          detail: `You chose this ${topDidntWorkTag.count} time${topDidntWorkTag.count === 1 ? "" : "s"} when finishing a recipe in this period.`,
          recordCount: topDidntWorkTag.count,
          takeaway: takeawayFor("didnt-work-tag", false),
        });
      }

      const lowerRatedIngredientCounts = new Map<string, number>();
      for (const completion of lowerRatedCompletions) {
        const recipeGraph = parseRecipeGraph(completion.recipe.graph);
        for (const ingredient of ingredientNodes(recipeGraph)) {
          const normalizedLabel = normalizeIngredientLabel(ingredient.label);
          if (!normalizedLabel || !isUsableIngredientInsightLabel(normalizedLabel)) continue;
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
          headline: `Often in meals you found harder: ${titleCaseWords(topLowerRatedIngredient.key)}`,
          detail: ingredientAppearedDetail(
            topLowerRatedIngredient.key,
            topLowerRatedIngredient.count,
            false,
          ),
          recordCount: topLowerRatedIngredient.count,
          takeaway: takeawayFor("ingredient-affinity", false),
        });
      }
    }

    const filterDismissedCards = (cards: InsightCard[]) =>
      cards.filter((card) => !dismissedCardIds.has(card.id));
    cooking.works = selectDiverseInsightCards(
      filterDismissedCards(cardsWorks),
      TOP_INSIGHT_CARDS,
    );
    cooking.doesntWork = selectDiverseInsightCards(
      filterDismissedCards(cardsDoesnt),
      TOP_INSIGHT_CARDS,
    );
  }

  const dining = { works: [] as InsightCard[], doesntWork: [] as InsightCard[] };
  if (diningEnabled) {
    const restaurantReviewsInRange = await restaurantDatabase.restaurantReviewFindMany({
      where: { userId, createdAt: { gte: rangeFromInclusive, lt: rangeToExclusive } },
      orderBy: { createdAt: "desc" },
      take: reviewTake,
      include: { place: true },
    });

    const diningWorksCards: InsightCard[] = [];
    const diningDoesntCards: InsightCard[] = [];

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
      const dimLabel = humanizeChipLabel(sensoryCorrelation.label);
      diningWorksCards.push({
        id: `dining.sensory.${sensoryCorrelation.key}`,
        category: "sensory-match",
        headline: `Calmer ${dimLabel} suits you when dining out.`,
        detail: `Across ${restaurantReviewsInRange.length} review${restaurantReviewsInRange.length === 1 ? "" : "s"} in this period, higher scores line up with lower ${dimLabel}.`,
        recordCount: restaurantReviewsInRange.length,
        takeaway: takeawayFor("sensory-match", true),
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
      diningWorksCards.push({
        id: `dining.cuisine.${topCuisine.key}`,
        category: "cuisine",
        headline: `Cuisine you enjoy: ${titleCaseWords(topCuisine.key)}`,
        detail: cuisineAppearedDetail(topCuisine.key, topCuisine.count, true),
        recordCount: topCuisine.count,
        takeaway: takeawayFor("cuisine", true),
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
      const combinedTimeLabels = topPreferredTimeSlots
        .map((timeBucket) => humanizeChipLabel(timeBucket.key))
        .join(" and ");
      const totalBestTimeSelections = topPreferredTimeSlots.reduce(
        (runningTotal, timeBucket) => runningTotal + timeBucket.count,
        0,
      );
      diningWorksCards.push({
        id: `dining.best-windows.${topPreferredTimeSlots.map((timeBucket) => timeBucket.key).join("+")}`,
        category: "best-windows",
        headline: `Good times to go out: ${combinedTimeLabels}`,
        detail: `You picked these as best times in ${totalBestTimeSelections} review${totalBestTimeSelections === 1 ? "" : "s"} in this period.`,
        recordCount: totalBestTimeSelections,
        takeaway: takeawayFor("best-windows", true),
      });
    }

    const lowRatedReviews = restaurantReviewsInRange.filter(
      (review) => Number(review.overallRating) <= MAX_LOW_RATING,
    );
    if (lowRatedReviews.length >= DINING_NEGATIVE_MIN_REVIEWS) {
      const inverseSensoryRows = sensoryDimensions
        .map((dimension) => {
          const stressValues = restaurantReviewsInRange.map(
            (review) =>
              Number((review as unknown as Record<string, number>)[`${dimension.key}Rating`] ?? 0),
          );
          return {
            key: dimension.key,
            label: dimension.label,
            correlation: pearson(stressValues, overallRatings),
            sampleSize: stressValues.length,
          };
        })
        .filter((row) => row.sampleSize >= SENSORY_MIN_SAMPLE_SIZE)
        .sort((first, second) => first.correlation - second.correlation);
      for (const row of inverseSensoryRows.slice(0, 2)) {
        if (row.correlation > -SENSORY_MIN_CORRELATION) continue;
        const dimLabel = humanizeChipLabel(row.label);
        diningDoesntCards.push({
          id: `dining.negsensory.${row.key}`,
          category: "sensory-mismatch",
          headline: `Higher ${dimLabel} can make dining harder for you.`,
          detail: `Across ${restaurantReviewsInRange.length} review${restaurantReviewsInRange.length === 1 ? "" : "s"} in this period, lower scores line up with higher ${dimLabel}.`,
          recordCount: restaurantReviewsInRange.length,
          takeaway: takeawayFor("sensory-mismatch", false),
        });
      }

      const lowCuisineCounts = new Map<string, number>();
      for (const review of lowRatedReviews) {
        const cuisineLabel = (review.place.cuisine ?? "").trim();
        if (!cuisineLabel) continue;
        lowCuisineCounts.set(cuisineLabel, (lowCuisineCounts.get(cuisineLabel) ?? 0) + 1);
      }
      const topLowCuisine = countTopN(lowCuisineCounts, 1)[0];
      if (topLowCuisine && topLowCuisine.count >= CUISINE_REPEAT_THRESHOLD) {
        diningDoesntCards.push({
          id: `dining.low-cuisine.${topLowCuisine.key}`,
          category: "cuisine-mismatch",
          headline: `Cuisine that’s been harder: ${titleCaseWords(topLowCuisine.key)}`,
          detail: cuisineAppearedDetail(topLowCuisine.key, topLowCuisine.count, false),
          recordCount: topLowCuisine.count,
          takeaway: takeawayFor("cuisine-mismatch", false),
        });
      }
    }

    const filterDismissedDining = (cards: InsightCard[]) =>
      cards.filter((card) => !dismissedCardIds.has(card.id));
    dining.works = selectDiverseInsightCards(
      filterDismissedDining(diningWorksCards),
      TOP_INSIGHT_CARDS,
    );
    dining.doesntWork = selectDiverseInsightCards(
      filterDismissedDining(diningDoesntCards),
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
