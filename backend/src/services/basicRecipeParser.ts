import type { RecipeEdge, RecipeGraph, RecipeNode } from "../graph/recipeGraph.js";
import {
  repairIngredientNodesFromRecipeText,
  syncIngredientNodesWithSourceLines,
} from "./graphRepair.js";

const TITLE_MAX_LENGTH = 120;
const MAX_INGREDIENTS = 60;
const MAX_STEPS = 40;
const LABEL_MAX_LENGTH = 80;
const MAX_INGREDIENT_IDS_PER_STEP = 12;

/** Choose a simple ingredient emoji based on keyword matches (fallback is a generic bowl). */
function pickEmojiForIngredient(label: string): string {
  const lowered = label.toLowerCase();
  if (/(beef|steak|meat|pork|bacon|ham)/.test(lowered)) return "🥩";
  if (/(chicken|turkey)/.test(lowered)) return "🍗";
  if (/(fish|salmon|tuna|shrimp|prawn|seafood)/.test(lowered)) return "🐟";
  if (/(milk|cheese|butter|cream|yogurt)/.test(lowered)) return "🥛";
  if (/(pasta|noodle)/.test(lowered)) return "🍝";
  if (/(rice)/.test(lowered)) return "🍚";
  if (/(egg)/.test(lowered)) return "🥚";
  if (/(tomato)/.test(lowered)) return "🍅";
  if (/(onion|garlic)/.test(lowered)) return "🧅";
  if (/(salt|pepper|spice|herb)/.test(lowered)) return "🧂";
  return "🥣";
}

/** Choose a single action emoji for a step based on coarse verb/method keywords (fallback arrow). */
function pickEmojiForStep(text: string): string {
  const lowered = text.toLowerCase();
  if (/(chop|slice|dice|mince)/.test(lowered)) return "🔪";
  if (/(mix|stir|whisk|combine)/.test(lowered)) return "🥣";
  if (/(bake|roast|oven)/.test(lowered)) return "🔥";
  if (/(boil|simmer|cook)/.test(lowered)) return "🍲";
  if (/(fry|saute|pan)/.test(lowered)) return "🍳";
  if (/(wait|rest|cool)/.test(lowered)) return "⏳";
  if (/(serve|plate)/.test(lowered)) return "🍽️";
  return "➡️";
}

/** Infer a step node "type" from step text using a small keyword heuristic. */
function pickStepType(text: string): RecipeNode["type"] {
  const lowered = text.toLowerCase();
  if (/(wait|rest|cool|set aside)/.test(lowered)) return "wait";
  if (/(serve|plate)/.test(lowered)) return "serve";
  if (/(mix|stir|combine|toss)/.test(lowered)) return "assemble";
  if (/(bake|roast|oven|boil|simmer|cook|fry|saute)/.test(lowered)) return "cook";
  return "prep";
}

/** Extract a single "NN minutes" value from step text if present (best-effort). */
function extractMinutes(text: string): number | null {
  const match = text.toLowerCase().match(/(\d+)\s*(min|mins|minutes)\b/);
  if (!match) return null;
  const minutes = Number(match[1]);
  return Number.isFinite(minutes) ? minutes : null;
}

/** Split raw text into non-empty trimmed lines (used for crude section/step parsing). */
function splitLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Parse a plain recipe text blob into a minimal `RecipeGraph` using simple heuristics.
 *
 * Intended as a fallback when LLM parsing is unavailable; produces a usable linear step chain and "uses" edges,
 * then applies `repairIngredientNodesFromRecipeText` to improve ingredient labeling.
 */
export function basicRecipeTextToGraph(input: {
  text: string;
  sourceUrl?: string | null;
}): RecipeGraph {
  const lines = splitLines(input.text);
  const title = lines[0]?.slice(0, TITLE_MAX_LENGTH) || "Recipe";

  const ingredientsHeaderIndex = lines.findIndex((line) => /^ingredients\b/i.test(line));
  const instructionsHeaderIndex = lines.findIndex(
    (line) => /^instructions\b/i.test(line) || /^method\b/i.test(line) || /^steps\b/i.test(line),
  );

  const ingredientLines =
    ingredientsHeaderIndex >= 0
      ? lines.slice(
          ingredientsHeaderIndex + 1,
          instructionsHeaderIndex >= 0 ? instructionsHeaderIndex : undefined,
        )
      : [];
  const instructionLines =
    instructionsHeaderIndex >= 0 ? lines.slice(instructionsHeaderIndex + 1) : lines.slice(1);

  const ingredients = ingredientLines
    .map((line) => line.replace(/^[\-\*\u2022]\s+/, "").trim())
    .filter(Boolean)
    .slice(0, MAX_INGREDIENTS);

  let steps = instructionLines
    .map((line) => line.replace(/^\d+\.\s+/, "").trim())
    .filter(Boolean);

  // If instructions are one long paragraph, split on sentence-ish boundaries.
  if (steps.length <= 2) {
    const paragraph = instructionLines.join(" ");
    const sentenceParts = paragraph
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
    if (sentenceParts.length >= steps.length) steps = sentenceParts;
  }

  steps = steps.slice(0, MAX_STEPS);

  const nodes: RecipeNode[] = [];
  const edges: RecipeEdge[] = [];

  const ingredientIds: string[] = [];
  for (const [ingredientIndex, ingredientLine] of ingredients.entries()) {
    const label = ingredientLine.slice(0, LABEL_MAX_LENGTH);
    const id = `i${ingredientIndex + 1}`;
    ingredientIds.push(id);
    nodes.push({
      id,
      type: "ingredient",
      label,
      detail: ingredientLine,
      emoji: pickEmojiForIngredient(label),
      lane: null,
      timeMinutes: null,
      ingredientIds: [],
    });
  }

  const stepIds: string[] = [];
  for (const [stepIndex, stepDetail] of steps.entries()) {
    const id = `s${stepIndex + 1}`;
    stepIds.push(id);
    nodes.push({
      id,
      type: pickStepType(stepDetail),
      label: stepDetail.slice(0, LABEL_MAX_LENGTH),
      detail: stepDetail,
      emoji: pickEmojiForStep(stepDetail),
      lane: null,
      timeMinutes: extractMinutes(stepDetail),
      ingredientIds: ingredientIds.slice(
        0,
        Math.min(ingredientIds.length, MAX_INGREDIENT_IDS_PER_STEP),
      ),
    });
  }

  for (let stepIndex = 1; stepIndex < stepIds.length; stepIndex++) {
    edges.push({
      source: stepIds[stepIndex - 1],
      target: stepIds[stepIndex],
      type: "requires",
    });
  }
  if (stepIds.length) {
    for (const ingredientId of ingredientIds) {
      edges.push({ source: ingredientId, target: stepIds[0], type: "uses" });
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

  return syncIngredientNodesWithSourceLines(
    repairIngredientNodesFromRecipeText(graph, input.text),
    input.text,
  );
}
