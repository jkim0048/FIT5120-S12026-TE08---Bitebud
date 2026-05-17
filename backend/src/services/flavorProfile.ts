import { GoogleGenerativeAI } from "@google/generative-ai";

export type FlavorKey = "sweet" | "salty" | "sour" | "bitter" | "spicy";

export type FlavorInferenceInput = {
  id: string;
  label: string;
  detail?: string | null;
};

export type FlavorInferenceResult = Record<FlavorKey, string[]>;

const FLAVORS: FlavorKey[] = ["sweet", "salty", "sour", "bitter", "spicy"];

function emptyResult(): FlavorInferenceResult {
  return { sweet: [], salty: [], sour: [], bitter: [], spicy: [] };
}

function uniquePush(arr: string[], value: string) {
  if (!arr.includes(value)) arr.push(value);
}

function normalizedText(x: FlavorInferenceInput): string {
  return `${x.label ?? ""} ${x.detail ?? ""}`.toLowerCase();
}

function heuristicInfer(ingredients: FlavorInferenceInput[]): FlavorInferenceResult {
  const out = emptyResult();
  for (const ing of ingredients) {
    const text = normalizedText(ing);
    if (/(sugar|honey|jaggery|syrup|sweetener|molasses|maple|dates?|raisins?)/.test(text)) {
      uniquePush(out.sweet, ing.id);
    }
    if (/(salt|soy sauce|brine|stock cube|bouillon|fish sauce|anchovy|miso)/.test(text)) {
      uniquePush(out.salty, ing.id);
    }
    if (
      /(lemon|lime|vinegar|tamarind|sumac|yogurt|curd|citric|sour(?:ed)?\s+cream|creme fraiche|cr[eè]me fra[iî]che|buttermilk|cream of tartar)/.test(
        text,
      )
    ) {
      uniquePush(out.sour, ing.id);
    }
    if (/(coffee|cocoa|dark chocolate|kale|fenugreek|radicchio|bitter gourd|turmeric)/.test(text)) {
      uniquePush(out.bitter, ing.id);
    }
    if (/(chilli|chili|pepper|jalape|serrano|cayenne|paprika|hot sauce|wasabi|mustard)/.test(text)) {
      uniquePush(out.spicy, ing.id);
    }
  }
  return out;
}

function sanitizeResult(raw: unknown, validIds: Set<string>): FlavorInferenceResult {
  const out = emptyResult();
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  for (const flavor of FLAVORS) {
    const arr = Array.isArray(obj[flavor]) ? obj[flavor] : [];
    for (const id of arr) {
      if (typeof id !== "string") continue;
      if (!validIds.has(id)) continue;
      uniquePush(out[flavor], id);
    }
  }
  return out;
}

export async function inferFlavorProfile(ingredients: FlavorInferenceInput[]): Promise<FlavorInferenceResult> {
  const validIds = new Set(ingredients.map((x) => x.id));
  const fallback = heuristicInfer(ingredients);
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return fallback;
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
      generationConfig: { responseMimeType: "application/json" },
    });
    const prompt = `Classify recipe ingredients into flavor groups.
Only output strict JSON with this shape:
{
  "sweet": ["ingredient-id"],
  "salty": ["ingredient-id"],
  "sour": ["ingredient-id"],
  "bitter": ["ingredient-id"],
  "spicy": ["ingredient-id"]
}
Rules:
- Use only IDs from the given list.
- Include an ingredient in a flavor only if it clearly contributes that flavor.
- If none for a flavor, return [].

Ingredients JSON:
${JSON.stringify(ingredients, null, 2)}`;
    const res = await model.generateContent(prompt);
    const parsed = JSON.parse(res.response.text()) as unknown;
    const llm = sanitizeResult(parsed, validIds);
    // Merge fallback to avoid empty output from LLM on obvious flavor ingredients.
    for (const flavor of FLAVORS) {
      for (const id of fallback[flavor]) uniquePush(llm[flavor], id);
    }
    return llm;
  } catch {
    return fallback;
  }
}
