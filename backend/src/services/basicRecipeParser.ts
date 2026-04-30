import type { RecipeEdge, RecipeGraph, RecipeNode } from "../graph/recipeGraph.js";
import { repairIngredientNodesFromRecipeText } from "./graphRepair.js";

/** Choose a simple ingredient emoji based on keyword matches (fallback is a generic bowl). */
function pickEmojiForIngredient(label: string): string {
  const t = label.toLowerCase();
  if (/(beef|steak|meat|pork|bacon|ham)/.test(t)) return "🥩";
  if (/(chicken|turkey)/.test(t)) return "🍗";
  if (/(fish|salmon|tuna|shrimp|prawn|seafood)/.test(t)) return "🐟";
  if (/(milk|cheese|butter|cream|yogurt)/.test(t)) return "🥛";
  if (/(pasta|noodle)/.test(t)) return "🍝";
  if (/(rice)/.test(t)) return "🍚";
  if (/(egg)/.test(t)) return "🥚";
  if (/(tomato)/.test(t)) return "🍅";
  if (/(onion|garlic)/.test(t)) return "🧅";
  if (/(salt|pepper|spice|herb)/.test(t)) return "🧂";
  return "🥣";
}

/** Choose a single action emoji for a step based on coarse verb/method keywords (fallback arrow). */
function pickEmojiForStep(text: string): string {
  const t = text.toLowerCase();
  if (/(chop|slice|dice|mince)/.test(t)) return "🔪";
  if (/(mix|stir|whisk|combine)/.test(t)) return "🥣";
  if (/(bake|roast|oven)/.test(t)) return "🔥";
  if (/(boil|simmer|cook)/.test(t)) return "🍲";
  if (/(fry|saute|pan)/.test(t)) return "🍳";
  if (/(wait|rest|cool)/.test(t)) return "⏳";
  if (/(serve|plate)/.test(t)) return "🍽️";
  return "➡️";
}

/** Infer a step node “type” from step text using a small keyword heuristic. */
function pickStepType(text: string): RecipeNode["type"] {
  const t = text.toLowerCase();
  if (/(wait|rest|cool|set aside)/.test(t)) return "wait";
  if (/(serve|plate)/.test(t)) return "serve";
  if (/(mix|stir|combine|toss)/.test(t)) return "assemble";
  if (/(bake|roast|oven|boil|simmer|cook|fry|saute)/.test(t)) return "cook";
  return "prep";
}

/** Extract a single “NN minutes” value from step text if present (best-effort). */
function extractMinutes(text: string): number | null {
  const m = text.toLowerCase().match(/(\d+)\s*(min|mins|minutes)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Split raw text into non-empty trimmed lines (used for crude section/step parsing). */
function splitLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse a plain recipe text blob into a minimal `RecipeGraph` using simple heuristics.
 *
 * Intended as a fallback when LLM parsing is unavailable; produces a usable linear step chain and “uses” edges,
 * then applies `repairIngredientNodesFromRecipeText` to improve ingredient labeling.
 */
export function basicRecipeTextToGraph(input: {
  text: string;
  sourceUrl?: string | null;
}): RecipeGraph {
  const lines = splitLines(input.text);
  const title = lines[0]?.slice(0, 120) || "Recipe";

  // crude section detection
  const ingStart = lines.findIndex((l) => /^ingredients\b/i.test(l));
  const instrStart = lines.findIndex((l) => /^instructions\b/i.test(l) || /^method\b/i.test(l) || /^steps\b/i.test(l));

  const ingLines =
    ingStart >= 0
      ? lines.slice(ingStart + 1, instrStart >= 0 ? instrStart : undefined)
      : [];
  const instrLines =
    instrStart >= 0 ? lines.slice(instrStart + 1) : lines.slice(1);

  const ingredients = ingLines
    .map((l) => l.replace(/^[\-\*\u2022]\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 60);

  let steps = instrLines
    .map((l) => l.replace(/^\d+\.\s+/, "").trim())
    .filter(Boolean);

  // If instructions are one long paragraph, split on sentence-ish boundaries.
  if (steps.length <= 2) {
    const para = instrLines.join(" ");
    const parts = para.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= steps.length) steps = parts;
  }

  steps = steps.slice(0, 40);

  const nodes: RecipeNode[] = [];
  const edges: RecipeEdge[] = [];

  const ingredientIds: string[] = [];
  for (let i = 0; i < ingredients.length; i++) {
    const label = ingredients[i].slice(0, 80);
    const id = `i${i + 1}`;
    ingredientIds.push(id);
    nodes.push({
      id,
      type: "ingredient",
      label,
      detail: ingredients[i],
      emoji: pickEmojiForIngredient(label),
      lane: null,
      timeMinutes: null,
      ingredientIds: [],
    });
  }

  const stepIds: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const id = `s${i + 1}`;
    stepIds.push(id);
    const detail = steps[i];
    nodes.push({
      id,
      type: pickStepType(detail),
      label: detail.slice(0, 80),
      detail,
      emoji: pickEmojiForStep(detail),
      lane: null,
      timeMinutes: extractMinutes(detail),
      ingredientIds: ingredientIds.slice(0, Math.min(ingredientIds.length, 12)),
    });
  }

  // linear requires edges between steps
  for (let i = 1; i < stepIds.length; i++) {
    edges.push({ source: stepIds[i - 1], target: stepIds[i], type: "requires" });
  }
  // basic uses edges: every ingredient to first step (keeps graph usable)
  if (stepIds.length) {
    for (const iid of ingredientIds) {
      edges.push({ source: iid, target: stepIds[0], type: "uses" });
    }
  }

  const graph: RecipeGraph = {
    title,
    sourceUrl: input.sourceUrl ?? null,
    totalTimeMinutes: null,
    servings: null,
    nodes,
    edges,
  };

  return repairIngredientNodesFromRecipeText(graph, input.text);
}

