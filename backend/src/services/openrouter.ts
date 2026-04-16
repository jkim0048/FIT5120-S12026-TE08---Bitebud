import { parseRecipeGraph, type RecipeGraph, validateDag } from "../graph/recipeGraph.js";
import { requireEnv } from "../env.js";
import { repairIngredientNodesFromRecipeText } from "./graphRepair.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const DEFAULT_OPENROUTER_MODELS = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
] as const;

/** Build an ordered list of OpenRouter models to try (env override first, then fallbacks; de-duplicated). */
function openRouterModelCandidates(): string[] {
  const preferred = process.env.OPENROUTER_MODEL?.trim();
  const out = preferred
    ? [preferred, ...DEFAULT_OPENROUTER_MODELS.filter((m) => m !== preferred)]
    : [...DEFAULT_OPENROUTER_MODELS];
  return [...new Set(out)];
}

/** Parse a model response into JSON, tolerating optional ```json fences. */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  const raw = fence ? fence[1].trim() : trimmed;
  return JSON.parse(raw) as unknown;
}

/** Classify transient OpenRouter failures that are worth retrying with backoff and/or model fallback. */
function isRetryableOpenRouterError(e: unknown): boolean {
  const s = String(e);
  return (
    s.includes("429") ||
    s.includes("503") ||
    s.toLowerCase().includes("rate limit") ||
    s.toLowerCase().includes("overloaded") ||
    s.toLowerCase().includes("timeout")
  );
}

/** Sleep helper for backoff between retry attempts. */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Add bounded jitter to a base delay to avoid retry thundering-herd behavior. */
function jitter(ms: number): number {
  const spread = Math.max(50, Math.floor(ms * 0.25));
  return ms + Math.floor((Math.random() * 2 - 1) * spread);
}

/**
 * Call OpenRouter chat completions and return the model’s message content as a string.
 *
 * Enforces a timeout, throws on non-2xx responses, and validates that `choices[0].message.content` exists.
 */
async function postOpenRouterJson(opts: {
  model: string;
  prompt: string;
  timeoutMs: number;
}): Promise<string> {
  const apiKey = requireEnv("OPENROUTER_API_KEY");
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs);
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Optional (but harmless) headers OpenRouter recommends:
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost",
        "X-Title": process.env.OPENROUTER_APP_NAME ?? "BiteBud",
      },
      body: JSON.stringify({
        model: opts.model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "Return ONLY valid JSON. No markdown fences. No extra text. If unsure, still return best-effort JSON that matches the schema.",
          },
          { role: "user", content: opts.prompt },
        ],
        response_format: { type: "json_object" },
      }),
      signal: ac.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`OpenRouter request failed: ${res.status} ${text}`);
    }
    const data = JSON.parse(text) as any;
    const content = data?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      throw new Error(`OpenRouter response missing content: ${text.slice(0, 500)}`);
    }
    return content;
  } finally {
    clearTimeout(t);
  }
}

const TEXT_PARSE_INSTRUCTIONS = `You are a recipe parser. Convert the following recipe into a directed acyclic graph (DAG) for a visual flowchart. Return ONLY valid JSON matching the schema below (no markdown fences).

Rules:
- Each ingredient becomes a node with type "ingredient"
- For ingredient nodes: label is the ingredient name only (e.g. "Eggs", "Smoked salmon"); detail includes quantity/notes (e.g. "4 large eggs")
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

/**
 * Parse recipe text into a validated `RecipeGraph` using OpenRouter-hosted models.
 *
 * Tries model candidates with up to 3 attempts each (retryable errors only), performs one “repair invalid JSON”
 * pass if initial parsing fails, then applies ingredient-node repair and DAG validation.
 */
export async function parseRecipeTextToGraphViaOpenRouter(
  text: string,
  sourceUrl?: string | null,
): Promise<RecipeGraph> {
  const prompt = `${TEXT_PARSE_INSTRUCTIONS}

Recipe to parse:
${text}
${sourceUrl ? `\nSource URL hint: ${sourceUrl}` : ""}`;

  let lastErr: unknown;
  for (const model of openRouterModelCandidates()) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const raw = await postOpenRouterJson({
          model,
          prompt,
          timeoutMs: 25_000,
        });
        let graph: RecipeGraph;
        try {
          graph = parseRecipeGraph(extractJson(raw));
        } catch (first) {
          // One repair attempt using the same model.
          const fixPrompt = `Fix to valid RecipeGraph JSON only. Error: ${String(first)}\n${raw.slice(0, 40_000)}`;
          const fixed = await postOpenRouterJson({
            model,
            prompt: fixPrompt,
            timeoutMs: 25_000,
          });
          graph = parseRecipeGraph(extractJson(fixed));
        }
        if (sourceUrl) graph = { ...graph, sourceUrl };
        graph = repairIngredientNodesFromRecipeText(graph, text);
        validateDag(graph);
        return graph;
      } catch (e) {
        lastErr = e;
        if (!isRetryableOpenRouterError(e)) break;
        const backoff = jitter(600 * 2 ** attempt);
        await sleep(backoff);
      }
    }
  }
  throw lastErr;
}

