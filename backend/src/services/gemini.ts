import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  parseRecipeGraph,
  type RecipeGraph,
  validateDag,
} from "../graph/recipeGraph.js";
import { requireEnv } from "../env.js";
import {
  repairIngredientNodesFromRecipeText,
  syncIngredientNodesWithSourceLines,
} from "./graphRepair.js";

/** Override with env `GEMINI_MODEL`. Default matches README; falls back if quota/API rejects. */
const DEFAULT_MODEL = "gemini-2.5-flash";
/**
 * Keep this list to models that are commonly available on the Gemini API.
 * (Preview/retired IDs can hard-fail with 404 for many keys.)
 */
const FALLBACK_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-flash-latest",
  "gemini-2.0-flash",
  "gemini-2.5-pro"
] as const;

/** Build an ordered list of model names to try (env override first, then known fallbacks; de-duplicated). */
function modelCandidates(): string[] {
  const preferredRaw = process.env.GEMINI_MODEL?.trim();
  const allow = new Set<string>([DEFAULT_MODEL, ...FALLBACK_MODELS]);
  const preferred = preferredRaw && allow.has(preferredRaw) ? preferredRaw : DEFAULT_MODEL;
  const out = [preferred, ...FALLBACK_MODELS.filter((m) => m !== preferred)];
  return [...new Set(out)];
}

/** Treat common quota/model-retired failures as retryable by switching to a fallback model. */
function isRetryableModelSwitch(err: unknown): boolean {
  const s = String(err);
  if (
    s.includes("429") ||
    s.includes("Quota") ||
    s.includes("RESOURCE_EXHAUSTED") ||
    s.toLowerCase().includes("quota")
  ) {
    return true;
  }
  if (s.includes("404") && s.toLowerCase().includes("not found")) return true;
  return false;
}

/**
 * Generate JSON (as a text string) from Gemini using `responseMimeType: application/json`.
 *
 * Retries across model candidates on quota/404-retired errors; rethrows non-retryable errors.
 */
async function generateJsonText(
  genAI: GoogleGenerativeAI,
  prompt: string,
): Promise<string> {
  let lastErr: unknown;
  for (const modelName of modelCandidates()) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { responseMimeType: "application/json" },
      });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (e) {
      lastErr = e;
      if (!isRetryableModelSwitch(e)) throw e;
    }
  }
  throw lastErr;
}

const TEXT_PARSE_INSTRUCTIONS = `You are a recipe parser. Convert the following recipe into a directed acyclic graph (DAG) for a visual flowchart. Return ONLY valid JSON matching the schema below (no markdown fences).

Rules:
- Each ingredient becomes a node with type "ingredient"
- For ingredient nodes: label is the ingredient name only (e.g. "Eggs", "Smoked salmon"); detail includes quantity/notes (e.g. "4 large eggs")
- If the Ingredients section lists the same ingredient more than once with different amounts or usage notes (e.g. two soured cream lines: one for filling, one for topping), create a SEPARATE ingredient node for each line. Reuse the same short label when the item is the same (e.g. "Soured cream") but copy the full line into detail each time so each checklist row stays distinct—never merge those into one node.
- Always include an emoji for ingredients
- Each instruction step becomes a node with type prep, cook, wait, assemble, or serve
- Each step gets an action emoji from: knife work, pan cooking, pot cooking, oven/grill, mixing, liquid/pour, seasoning, waiting, steam, serve (use single emoji each)
- Break compound instructions into atomic single-action steps
- Detect parallel tasks and group them into named lanes (lane field on step nodes)
- Create edges from ingredients to steps that use them (type "uses")
- Create edges between steps that depend on each other (type "requires")
- Estimate time in minutes per step when possible (timeMinutes), else null
- ingredientIds on each step lists ingredient node ids that step uses
- Do NOT create standalone step nodes that only say "Step 1", "Step 2", etc. Every step node must include the full actionable instruction in detail (label can be a short action title).

Schema (JSON object shape):
{
  "title": "string",
  "sourceUrl": "string or null",
  "totalTimeMinutes": "number or null",
  "servings": "number or null",
  "nodes": [
    {
      "id": "string",
      "type": "ingredient | prep | cook | wait | assemble | serve",
      "label": "string",
      "detail": "string",
      "emoji": "string",
      "lane": "string or null",
      "timeMinutes": "number | null",
      "ingredientIds": ["string"]
    }
  ],
  "edges": [
    { "source": "node id", "target": "node id", "type": "requires | uses" }
  ]
}`;

/** Parse a Gemini response into JSON, tolerating optional ```json fences. */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  const raw = fence ? fence[1].trim() : trimmed;
  return JSON.parse(raw) as unknown;
}

/**
 * Parse recipe text into a validated `RecipeGraph` using Gemini.
 *
 * Uses a strict JSON schema prompt, attempts one “fix invalid JSON” repair pass if needed, then runs
 * post-processing (`repairIngredientNodesFromRecipeText`) and DAG validation.
 */
export async function parseRecipeTextToGraph(
  text: string,
  sourceUrl?: string | null,
): Promise<RecipeGraph> {
  const apiKey = requireEnv("GEMINI_API_KEY");
  const genAI = new GoogleGenerativeAI(apiKey);
  const prompt = `${TEXT_PARSE_INSTRUCTIONS}

Recipe to parse:
${text}
${sourceUrl ? `\nSource URL hint: ${sourceUrl}` : ""}`;
  const textOut = await generateJsonText(genAI, prompt);
  let graph: RecipeGraph;
  try {
    graph = parseRecipeGraph(extractJson(textOut));
  } catch (first) {
    const fixPrompt = `The previous output was invalid. Fix it to valid JSON matching the schema. Previous output:\n${textOut}\nError: ${String(first)}`;
    const fixed = await generateJsonText(genAI, fixPrompt);
    graph = parseRecipeGraph(extractJson(fixed));
  }
  if (sourceUrl) graph = { ...graph, sourceUrl };
  graph = repairIngredientNodesFromRecipeText(graph, text);
  graph = syncIngredientNodesWithSourceLines(graph, text);
  validateDag(graph);
  return graph;
}

/** Best-effort classification of “Gemini is busy / retry later” errors for graceful fallback paths. */
export function isGeminiBusyError(e: unknown): boolean {
  const s = String(e);
  return (
    s.includes("503") ||
    s.toLowerCase().includes("high demand") ||
    s.includes("429") ||
    s.toLowerCase().includes("resource_exhausted") ||
    s.toLowerCase().includes("quota") ||
    s.toLowerCase().includes("timeout")
  );
}
