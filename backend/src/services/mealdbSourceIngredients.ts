import { fetchUrlAsRecipePlainText } from "./recipeUrlFetch.js";
import { mealToRecipeText, type MealDbMeal } from "./themealdb.js";

type MealRecipeText = ReturnType<typeof mealToRecipeText>;

/** Start of real ingredient list — avoid nav links that contain the word "Ingredients". */
function findRecipeIngredientSectionStart(t: string): number {
  const methodM = /\b(?:Ad\s+)?Method\b|\bNutrition:\s*per\b|\bNutrition facts\b/i.exec(t);
  const limit = methodM ? methodM.index : t.length;
  const head = t.slice(0, limit);

  const subsection = /\bfor the [^0-9\n]{3,160}?(filling|base|crust|topping|sauce|icing|dressing|cheesecake|brownie|batter|ganache)\b/i.exec(
    head,
  );
  if (subsection) return subsection.index;

  let best = -1;
  const re = /\bingredients\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(head)) !== null) {
    const tail = head.slice(m.index, m.index + 500);
    if (/\d\s*(g|ml|kg|tbsp|tsp|cup|oz)\b/i.test(tail) || /\n\s*[-•*]/i.test(tail)) best = m.index;
  }
  return best;
}

/** Rejoin lines split inside “(about 2 tsp)” style parentheticals. */
function mergeBrokenParenthetical(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let cur = lines[i]!;
    while (i + 1 < lines.length) {
      const open = (cur.match(/\(/g) ?? []).length;
      const shut = (cur.match(/\)/g) ?? []).length;
      if (open <= shut) break;
      const next = lines[i + 1]!;
      if (next.length > 90) break;
      cur = `${cur} ${next}`.trim();
      i++;
    }
    out.push(cur);
  }
  return out;
}

/** BBC-style pages often ship one line of text; split before each new quantity / subsection. */
function splitRunInIngredientLines(block: string): string[] {
  const trimmed = block.trim();
  if (!trimmed) return [];

  const dense = !trimmed.includes("\n") || trimmed.split(/\n/).filter((x) => x.trim()).length < 3;

  if (!dense) {
    return trimmed
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  }

  const tspLead = new RegExp(
    String.raw`\s+(?=(?:\d+\s*\u00bd|\d+\s+\u00bc|\d+\s+\u00be|\d+\s+\d/\d+|\d+)\s*(?:tbsp|tsp|tablespoons?|teaspoons?)\b)`,
    "gi",
  );
  const lined = trimmed
    .replace(/\s+(?=\bfor the\b)/gi, "\n")
    .replace(/(?<=[a-z)])(\s+)(?=\d+(?:\.\d+)?\s*(?:g|kg|mg|ml|cl|l|oz)\b)/gi, "\n")
    .replace(tspLead, "\n")
    .replace(/\s+(?=\d+\s+(?:large|medium|small)\s+)/gi, "\n")
    .replace(/\s+(?=finely grated\b|\ba handful\b|\ba pinch\b)/gi, "\n");

  return lined
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 2);
}

/**
 * Heuristic: pull ingredient lines from scraped recipe page plain text (e.g. BBC Good Food).
 * Returns null when the block looks empty or unreliable.
 */
function extractIngredientLinesFromPagePlainText(plain: string): string[] | null {
  const t = plain.replace(/\r/g, "").replace(/\u00a0/g, " ");

  const start = findRecipeIngredientSectionStart(t);
  if (start < 0) return null;

  const tailFromStart = t.slice(start);
  const methodM = /\b(?:Ad\s+)?Method\b|\bNutrition:\s*per\b|\bNutrition facts\b/i.exec(tailFromStart);
  const promoM = /\bKeep the screen awake\b|\bcook mode on the\b/i.exec(tailFromStart);
  let cut = tailFromStart.length;
  if (methodM) cut = Math.min(cut, methodM.index);
  if (promoM) cut = Math.min(cut, promoM.index);
  let block = tailFromStart.slice(0, cut).trim();

  const rawLines = mergeBrokenParenthetical(splitRunInIngredientLines(block));
  const out: string[] = [];
  let headingOnlySeen = false;
  let sectionPrefix = "";

  for (const raw of rawLines) {
    if (/^ingredients:?$/i.test(raw)) {
      headingOnlySeen = true;
      continue;
    }
    if (/advertisement|^cookie|^subscribe/i.test(raw)) continue;

    const cleaned = raw.replace(/^[-–—•*\u2022]+\s*/, "").replace(/^\(?\s*\d+\s*\)?[.)]\s+/, "").trim();
    if (!cleaned || cleaned.length < 3) continue;

    if (/^(for the|for\s+)/i.test(cleaned) && cleaned.length < 120 && !/\d\s*(?:ml|g|kg|cup|tbsp|tsp)\b/i.test(cleaned)) {
      sectionPrefix = cleaned.replace(/\s*:?\s*$/, "").trim();
      continue;
    }

    const lower = cleaned.toLowerCase();
    const looksLikeMetaHead =
      (/^(prep|cook time|prep time|prep:|ready in|cooks in|nutrition|nutrition information|equipment)\b/i.test(cleaned) &&
        cleaned.length < 60) ||
      (/^serves\b/i.test(cleaned) && /\d/.test(cleaned) && cleaned.length < 40);

    if (looksLikeMetaHead && out.length === 0) continue;

    const looksLikeIngredient =
      /\d/.test(cleaned) ||
      /^for the\b/i.test(cleaned) ||
      /\b(tsp|tablespoons?|tablespoon|tbsp|tbs|teaspoons?|teaspoon|cup|grams?|g\b|kg|ml|cl|oz|ounces?|litre|liter|litres|liters|dash|splash|pinch|handful|stalk|cloves?|small|large|medium|carton)\b/i.test(
        lower,
      );

    if (!looksLikeIngredient && out.length === 0 && !headingOnlySeen) continue;
    if (!looksLikeIngredient && out.length === 0) continue;

    const lineOut = sectionPrefix ? `${sectionPrefix}: ${cleaned}` : cleaned;
    out.push(lineOut);
    if (out.length > 45) break;
  }

  if (out.length < 2) return null;
  return out;
}

/**
 * When MealDB provides an HTTP source URL, try to fetch the page and use its ingredient list
 * when extraction succeeds; otherwise keep MealDB-only ingredients. When `strSource` is missing
 * or not a usable page URL, callers should use plain `mealToRecipeText` (this function does that).
 */
export async function mealToRecipeTextPreferSource(meal: MealDbMeal): Promise<MealRecipeText> {
  const base = mealToRecipeText(meal);
  const raw = typeof meal.strSource === "string" ? meal.strSource.trim() : "";
  if (!raw || !/^https?:\/\//i.test(raw)) return base;
  if (/youtube\.com|youtu\.be/i.test(raw)) return base;

  const fetched = await fetchUrlAsRecipePlainText(raw);
  if (!fetched.ok) return base;

  const lines = extractIngredientLinesFromPagePlainText(fetched.text);
  if (!lines || lines.length < 2) return base;

  const title = meal.strMeal || base.title;
  const instructions = String(meal.strInstructions ?? "").trim();
  const text = [
    title,
    "",
    "Ingredients:",
    ...lines.map((x) => `- ${x}`),
    "",
    "Instructions:",
    instructions || "(No instructions provided.)",
  ].join("\n");

  return {
    title,
    text,
    sourceUrl: base.sourceUrl ?? null,
    imageUrl: base.imageUrl ?? null,
  };
}
