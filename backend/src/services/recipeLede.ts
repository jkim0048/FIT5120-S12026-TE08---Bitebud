import { GoogleGenerativeAI } from "@google/generative-ai";
import { requireEnv } from "../env.js";
import { isGeminiBusyError } from "./gemini.js";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-pro";
const FALLBACK_GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-flash-latest",
  "gemini-3-flash-preview",
  "gemini-3-flash-lite-preview",
  "gemini-2.0-flash",
] as const;

function geminiModelCandidates(): string[] {
  const preferred = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const out = [preferred, ...FALLBACK_GEMINI_MODELS.filter((m) => m !== preferred)];
  return [...new Set(out)];
}

function normalizeOneSentence(raw: string): string {
  const line = raw.replace(/\s+/g, " ").trim();
  const stripped = line.replace(/^["'“”]+|["'“”]+$/g, "").trim();
  return stripped;
}

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

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

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

async function generateLedeViaOpenRouter(opts: { title: string; rawText: string }): Promise<string> {
  const apiKey = requireEnv("OPENROUTER_API_KEY");
  const model = process.env.OPENROUTER_MODEL?.trim() || "google/gemma-4-26b-a4b-it:free";

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
      temperature: 0.4,
      max_tokens: 70,
      messages: [
        {
          role: "system",
          content:
            'Return ONLY one sentence of plain text. No quotes, no markdown, no emojis.',
        },
        {
          role: "user",
          content: `Write ONE sentence describing the dish "${opts.title}" for a calm cooking app. Max 25 words. Food-focused.\n\nRecipe text:\n${opts.rawText.slice(0, 10_000)}`,
        },
      ],
    }),
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
  return normalizeOneSentence(content);
}

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

  if (process.env.OPENROUTER_API_KEY?.trim()) {
    try {
      return await generateLedeViaOpenRouter({ title: opts.title, rawText: text });
    } catch (e) {
      if (!isRetryableOpenRouterError(e)) return null;
      return null;
    }
  }

  return null;
}

