import { GoogleGenerativeAI } from "@google/generative-ai";
import { requireEnv } from "../env.js";

function normalizeDecision(s: string): "RECIPE" | "NOT_RECIPE" | null {
  const t = s.trim().toUpperCase();
  if (t === "RECIPE") return "RECIPE";
  if (t === "NOT_RECIPE" || t === "NOTRECIPE") return "NOT_RECIPE";
  // Tolerate small model formatting drift (extra words/punctuation) while staying strict-ish.
  if (t.includes("NOT") && t.includes("RECIPE")) return "NOT_RECIPE";
  if (t.includes("RECIPE")) return "RECIPE";
  return null;
}

async function classifyViaGemini(text: string): Promise<boolean> {
  const apiKey = requireEnv("GEMINI_API_KEY");
  const genAI = new GoogleGenerativeAI(apiKey);
  const modelName = process.env.GEMINI_CLASSIFIER_MODEL?.trim() || process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash-lite";
  const model = genAI.getGenerativeModel({ model: modelName });
  const prompt = [
    "You are a strict classifier.",
    "Decide whether the user-provided text is a FOOD RECIPE (ingredients + instructions).",
    "Return ONLY one token: RECIPE or NOT_RECIPE.",
    "",
    "Text:",
    // Keep the gate cheap; we only need enough context to detect “not a recipe”.
    text.slice(0, 12_000),
  ].join("\n");
  const res = await model.generateContent(prompt);
  const decision = normalizeDecision(res.response.text() || "");
  if (decision == null) return false;
  return decision === "RECIPE";
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_OPENROUTER_CLASSIFIER_MODELS = [
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
] as const;

function openRouterClassifierModels(): string[] {
  const preferred = process.env.OPENROUTER_CLASSIFIER_MODEL?.trim() || process.env.OPENROUTER_MODEL?.trim();
  const out = preferred
    ? [preferred, ...DEFAULT_OPENROUTER_CLASSIFIER_MODELS.filter((m) => m !== preferred)]
    : [...DEFAULT_OPENROUTER_CLASSIFIER_MODELS];
  return [...new Set(out)];
}

async function classifyViaOpenRouter(text: string): Promise<boolean> {
  const apiKey = requireEnv("OPENROUTER_API_KEY");
  const prompt = [
    "Return ONLY one token: RECIPE or NOT_RECIPE.",
    "A FOOD RECIPE should contain ingredients and cooking instructions (even if informal).",
    "NOT_RECIPE includes essays, code, prompts, chat logs, or non-food content.",
    "",
    "Text:",
    // Same cap as Gemini to keep cost bounded.
    text.slice(0, 12_000),
  ].join("\n");

  for (const model of openRouterClassifierModels()) {
    const ac = new AbortController();
    // Short timeout: this is a pre-check, not the main parsing step.
    const t = setTimeout(() => ac.abort(), 10_000);
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost",
          "X-Title": process.env.OPENROUTER_APP_NAME ?? "BiteBud",
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            { role: "system", content: "Return ONLY RECIPE or NOT_RECIPE. No extra text." },
            { role: "user", content: prompt },
          ],
        }),
        signal: ac.signal,
      });
      const raw = await res.text();
      // If this model is failing (quota/overload/bad response), try next candidate.
      if (!res.ok) continue;
      const data = JSON.parse(raw) as any;
      const content = String(data?.choices?.[0]?.message?.content ?? "").trim();
      const decision = normalizeDecision(content);
      if (decision == null) return false;
      return decision === "RECIPE";
    } catch {
      // try next model
    } finally {
      clearTimeout(t);
    }
  }
  throw new Error("OpenRouter classifier unavailable");
}

/**
 * Cheap pre-check to block obvious non-recipe abuse before spending effort parsing.
 * Tries Gemini first; falls back to OpenRouter when configured.
 */
export async function isLikelyFoodRecipeResilient(text: string): Promise<boolean> {
  try {
    // Prefer Gemini when available (already used elsewhere in this backend).
    return await classifyViaGemini(text);
  } catch {
    // fall through
  }
  if (process.env.OPENROUTER_API_KEY?.trim()) {
    // Fallback when Gemini is unavailable/busy/misconfigured.
    return await classifyViaOpenRouter(text);
  }
  // If no provider is available, don't block the user; rely on parser/validation.
  return true;
}

