import { GoogleGenerativeAI } from "@google/generative-ai";
import { requireEnv } from "../env.js";
import { isGeminiBusyError } from "./gemini.js";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
/**
 * Keep this list to models that are commonly available on the Gemini API.
 * (Preview/retired IDs can hard-fail with 404 for many keys.)
 */
const FALLBACK_GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-flash-latest",
  "gemini-2.0-flash",
  "gemini-2.5-pro"
] as const;

/** Build an ordered list of Gemini models to try for lede generation (env override first, then fallbacks). */
function geminiModelCandidates(): string[] {
  const preferredRaw = process.env.GEMINI_MODEL?.trim();
  const allow = new Set<string>([DEFAULT_GEMINI_MODEL, ...FALLBACK_GEMINI_MODELS]);
  const preferred = preferredRaw && allow.has(preferredRaw) ? preferredRaw : DEFAULT_GEMINI_MODEL;
  const out = [preferred, ...FALLBACK_GEMINI_MODELS.filter((m) => m !== preferred)];
  return [...new Set(out)];
}

/** Normalize the model output to a single clean sentence (trim, collapse whitespace, strip surrounding quotes). */
function normalizeOneSentence(raw: string): string {
  const line = raw.replace(/\s+/g, " ").trim();
  const stripped = line.replace(/^["'“”]+|["'“”]+$/g, "").trim();
  return stripped;
}

/**
 * Generate a one-sentence dish “lede” using Gemini, retrying across model fallbacks on busy/quota errors.
 *
 * The prompt is constrained (≤25 words, no emojis/quotes) and only the returned sentence is emitted.
 */
async function generateLedeViaGemini(opts: { title: string; rawText: string }): Promise<string> {
  const apiKey = requireEnv("GEMINI_API_KEY");
  const genAI = new GoogleGenerativeAI(apiKey);

  const prompt = `Write ONE sentence describing the dish "${opts.title}" for a calm cooking app.

Rules:
- Food-focused (taste/texture/cuisine), not instructions.
- Max 25 words.
- No emojis.
- No quotes.
- Return only the sentence.

Recipe text (context):
${opts.rawText.slice(0, 10_000)}`;

  let lastErr: unknown;
  for (const modelName of geminiModelCandidates()) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { temperature: 0.4 },
      });
      const result = await model.generateContent(prompt);
      return normalizeOneSentence(result.response.text());
    } catch (e) {
      lastErr = e;
      if (!isGeminiBusyError(e)) throw e;
    }
  }
  throw lastErr;
}

/**
 * Generate a recipe lede via Gemini with graceful fallback across Gemini models.
 *
 * Returns `null` when input text is empty or Gemini is transiently busy; rethrows
 * non-busy Gemini errors to surface genuine configuration issues.
 */
export async function generateRecipeLedeResilient(opts: {
  title: string;
  rawText: string | null | undefined;
}): Promise<string | null> {
  const text = opts.rawText?.trim();
  if (!text) return null;

  try {
    return await generateLedeViaGemini({ title: opts.title, rawText: text });
  } catch (e) {
    if (!isGeminiBusyError(e)) throw e;
  }

  return null;
}

