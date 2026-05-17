import { localCalendarDateString } from "../calendarDate.js";
import {
  findActiveCalendarDays,
  findActivityTotals,
} from "../database/userActivityDatabase.js";
import type { RecipeGraph, RecipeNode } from "../graph/recipeGraph.js";

const COOKING_METHOD_PATTERNS: Array<[string, RegExp]> = [
  ["bake", /\bbake\b/],
  ["roast", /\broast\b/],
  ["fry", /\bfry\b/],
  ["pan", /\bpan\b/],
  ["stovetop", /\bstove(?:top)?\b/],
  ["grill", /\bgrill\b/],
  ["steam", /\bsteam\b/],
  ["boil", /\bboil\b/],
];

const MORNING_HOUR_START = 5;
const MORNING_HOUR_END_EXCLUSIVE = 11;
const MIDDAY_HOUR_END_EXCLUSIVE = 16;
const EVENING_HOUR_END_EXCLUSIVE = 22;

/** Subtracts `days` calendar days from an ISO date string, returning the new ISO date. */
export function isoCalendarMinusDays(isoDateString: string, days: number): string {
  const [year, month, dayOfMonth] = isoDateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, dayOfMonth));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * Current streak: consecutive Melbourne-local days with at least one completion or review,
 * counting backward from today only. If nothing is logged today (Melbourne date), streak is 0.
 */
export function computeCurrentActivityStreak(
  activeIsoDays: Iterable<string>,
  now: Date = new Date(),
): number {
  const activeDays = new Set(activeIsoDays);
  const todayIsoDate = localCalendarDateString(now);
  if (!activeDays.has(todayIsoDate)) return 0;

  let streak = 0;
  let cursor = todayIsoDate;
  while (activeDays.has(cursor)) {
    streak += 1;
    cursor = isoCalendarMinusDays(cursor, 1);
  }
  return streak;
}

/** Monday-anchored, midnight-local start of the ISO week containing `date`. */
export function startOfIsoWeek(date: Date): Date {
  const weekStart = new Date(date);
  weekStart.setHours(0, 0, 0, 0);
  const weekday = weekStart.getDay();
  const daysSinceMonday = (weekday + 6) % 7;
  weekStart.setDate(weekStart.getDate() - daysSinceMonday);
  return weekStart;
}

/** Coarse time-of-day bucket used to cluster recipe completions for the insights page. */
export function timeOfDayBucket(date: Date): "morning" | "midday" | "evening" | "night" {
  const hour = date.getHours();
  if (hour >= MORNING_HOUR_START && hour < MORNING_HOUR_END_EXCLUSIVE) return "morning";
  if (hour >= MORNING_HOUR_END_EXCLUSIVE && hour < MIDDAY_HOUR_END_EXCLUSIVE) return "midday";
  if (hour >= MIDDAY_HOUR_END_EXCLUSIVE && hour < EVENING_HOUR_END_EXCLUSIVE) return "evening";
  return "night";
}

/** Normalise an ingredient label for grouping: lowercase, drop parenthesised text, collapse non-alphanumerics. */
export function normalizeIngredientLabel(rawLabel: string): string {
  return rawLabel
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Pick out just the ingredient nodes from a parsed recipe graph. */
export function ingredientNodes(graph: RecipeGraph): RecipeNode[] {
  return (graph.nodes ?? []).filter((node) => node.type === "ingredient");
}

/** Infer a set of cooking-method tags ("bake", "fry", ...) from labels/details across the graph. */
export function methodKeysFromGraph(graph: RecipeGraph): Set<string> {
  const methods = new Set<string>();
  for (const node of graph.nodes ?? []) {
    const nodeText = `${node.label ?? ""} ${node.detail ?? ""}`.toLowerCase();
    for (const [methodKey, pattern] of COOKING_METHOD_PATTERNS) {
      if (pattern.test(nodeText)) methods.add(methodKey);
    }
  }
  return methods;
}

/** Render an ordinal week label, e.g. 1 -> "first", 2 -> "second", 4 -> "4th". */
export function ordinalThisWeek(ordinalNumber: number): string {
  if (ordinalNumber === 1) return "first";
  if (ordinalNumber === 2) return "second";
  if (ordinalNumber === 3) return "third";
  return `${ordinalNumber}th`;
}

export type ActivityPayload = {
  dayStreak: number;
  activitiesThisMonth: number;
  hasAny: boolean;
};

/** Compose the response body for `GET /api/me/activity`. */
export async function assembleActivityPayload(userId: string): Promise<ActivityPayload> {
  const activeDayRows = await findActiveCalendarDays(userId);
  const activityTotals = await findActivityTotals(userId);

  const dayStreak = computeCurrentActivityStreak(
    (activeDayRows ?? []).map((row) => row.day),
  );
  const activitiesThisMonth =
    Number(activityTotals.completions_30) + Number(activityTotals.reviews_30);
  const hasAny =
    Number(activityTotals.completions_ever) + Number(activityTotals.reviews_ever) > 0;

  return { dayStreak, activitiesThisMonth, hasAny };
}
