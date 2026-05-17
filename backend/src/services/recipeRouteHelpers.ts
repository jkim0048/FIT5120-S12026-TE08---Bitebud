import { readFile } from "node:fs/promises";
import { recipeDatabase } from "../database/recipeDatabase.js";
import type { RecipeGraph } from "../graph/recipeGraph.js";
import { isGeminiBusyError, parseRecipeTextToGraph } from "./gemini.js";
import { basicRecipeTextToGraph } from "./basicRecipeParser.js";
import { applyIconMappings } from "./icons.js";
import { deriveRecipeMetadata, type RecipeMetadata } from "./recipeMetadata.js";

const MEAL_DB_JSON_PATH = "../data/mealdb.json";

let mealDbMinutesCache: Map<string, number> | null = null;
let mealDbServingsCache: Map<string, number> | null = null;

/** Return only strings from an unknown JSON-like array; used when reading stored arrays from the DB. */
export function jsonStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** Concatenate label + detail for every ingredient node in a graph (used for sensory matching). */
export function graphIngredientLines(graph: RecipeGraph): string[] {
  return (graph.nodes ?? [])
    .filter((node) => node.type === "ingredient")
    .map((node) => `${node.label ?? ""} ${node.detail ?? ""}`.trim())
    .filter(Boolean);
}

/** Lazy-load and cache the MealDB → total time (minutes) map from the bundled `mealdb.json` snapshot. */
export async function getMealDbMinutes(): Promise<Map<string, number>> {
  if (mealDbMinutesCache) return mealDbMinutesCache;
  const jsonUrl = new URL(MEAL_DB_JSON_PATH, import.meta.url);
  const rawJson = await readFile(jsonUrl, "utf8");
  const parsedRows = JSON.parse(rawJson) as unknown;
  if (!Array.isArray(parsedRows)) throw new Error("mealdb.json must be an array");
  const minutesById = new Map<string, number>();
  for (const row of parsedRows) {
    if (row == null || typeof row !== "object") continue;
    const rowFields = row as Record<string, unknown>;
    const mealDbId = typeof rowFields.mealdb_id === "string" ? rowFields.mealdb_id.trim() : "";
    const rawMinutes =
      typeof rowFields.total_time_minutes === "number"
        ? rowFields.total_time_minutes
        : Number(rowFields.total_time_minutes);
    if (!mealDbId) continue;
    if (!Number.isFinite(rawMinutes)) continue;
    const minutes = Math.round(rawMinutes);
    if (minutes <= 0) continue;
    minutesById.set(mealDbId, minutes);
  }
  mealDbMinutesCache = minutesById;
  return minutesById;
}

/** Lazy-load and cache the MealDB → servings count map from the bundled `mealdb.json` snapshot. */
export async function getMealDbServings(): Promise<Map<string, number>> {
  if (mealDbServingsCache) return mealDbServingsCache;
  const jsonUrl = new URL(MEAL_DB_JSON_PATH, import.meta.url);
  const rawJson = await readFile(jsonUrl, "utf8");
  const parsedRows = JSON.parse(rawJson) as unknown;
  if (!Array.isArray(parsedRows)) throw new Error("mealdb.json must be an array");
  const servingsById = new Map<string, number>();
  for (const row of parsedRows) {
    if (row == null || typeof row !== "object") continue;
    const rowFields = row as Record<string, unknown>;
    const mealDbId = typeof rowFields.mealdb_id === "string" ? rowFields.mealdb_id.trim() : "";
    const rawServings =
      typeof rowFields.servings === "number" ? rowFields.servings : Number(rowFields.servings);
    if (!mealDbId) continue;
    if (!Number.isFinite(rawServings)) continue;
    const servings = Math.round(rawServings);
    if (servings <= 0) continue;
    servingsById.set(mealDbId, servings);
  }
  mealDbServingsCache = servingsById;
  return servingsById;
}

/** Insert a recipe row from a parsed graph, then rewrite its `graph` column with the assigned id. */
export async function persistGraph(
  graph: RecipeGraph,
  opts: {
    mealDbId?: string | null;
    rawText?: string | null;
    refined?: boolean;
    metadata?: RecipeMetadata;
    lede?: string | null;
  } = {},
): Promise<{ recipeId: string; graph: RecipeGraph }> {
  const derivedMetadata = deriveRecipeMetadata(graph);
  const metadata = opts.metadata ?? {};
  const recipe = await recipeDatabase.recipeCreate({
    data: {
      title: graph.title,
      lede: opts.lede ?? null,
      imageUrl: metadata.imageUrl ?? null,
      sourceUrl: graph.sourceUrl ?? null,
      totalTimeMinutes: graph.totalTimeMinutes ?? null,
      complexity: metadata.complexity ?? derivedMetadata.complexity ?? null,
      heatLevel: metadata.heatLevel ?? derivedMetadata.heatLevel ?? null,
      tags: (metadata.tags ?? derivedMetadata.tags ?? []) as unknown as object,
      servings: graph.servings ?? null,
      graph: graph as object,
      mealDbId: opts.mealDbId ?? null,
      rawText: opts.rawText ?? null,
      refined: opts.refined ?? true,
    } as unknown as Parameters<typeof recipeDatabase.recipeCreate>[0]["data"],
  });
  const fullGraph: RecipeGraph = { ...graph, id: recipe.id };
  await recipeDatabase.recipeUpdate({
    where: { id: recipe.id },
    data: { graph: fullGraph as object },
  });
  return { recipeId: recipe.id, graph: fullGraph };
}

/** Apply user-aware icon mappings to a parsed recipe graph (delegates to icon service). */
export async function withIcons(graph: RecipeGraph, userId: string | null): Promise<RecipeGraph> {
  return applyIconMappings(graph, userId);
}

/** Ensure a `RecipeProgress` row exists for `(recipeId, userId)` so My Recipes can list the recipe. */
export async function linkRecipeToUser(recipeId: string, userId: string | null): Promise<void> {
  if (!userId) return;
  await recipeDatabase.recipeProgressUpsert({
    where: { recipeId_userId: { recipeId, userId } },
    create: {
      recipeId,
      userId,
      completedNodeIds: [],
    },
    update: {},
  });
}

/**
 * Parse raw recipe text with Gemini; fall back to the basic heuristic parser when Gemini is busy.
 *
 * `refined: true` indicates Gemini produced the graph; `false` indicates the heuristic fallback.
 */
export async function parseRecipeTextToGraphResilient(
  text: string,
  sourceUrl?: string | null,
): Promise<{ graph: RecipeGraph; refined: boolean; parserSource: "gemini" | "basic" }> {
  try {
    const graph = await parseRecipeTextToGraph(text, sourceUrl);
    return { graph, refined: true, parserSource: "gemini" };
  } catch (parseError) {
    if (!isGeminiBusyError(parseError)) throw parseError;
    const graph = basicRecipeTextToGraph({ text, sourceUrl: sourceUrl ?? null });
    return { graph, refined: false, parserSource: "basic" };
  }
}
