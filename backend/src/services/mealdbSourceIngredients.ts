import { fetchUrlAsRecipePlainText } from "./recipeUrlFetch.js";
import { mealToRecipeText, type MealDbMeal } from "./themealdb.js";

type MealRecipeText = ReturnType<typeof mealToRecipeText>;

const INGREDIENT_LOOKAHEAD_LENGTH = 500;

/** Start of real ingredient list — avoid nav links that contain the word "Ingredients". */
function findRecipeIngredientSectionStart(text: string): number {
  const methodMatch = /\b(?:Ad\s+)?Method\b|\bNutrition:\s*per\b|\bNutrition facts\b/i.exec(text);
  const limit = methodMatch ? methodMatch.index : text.length;
  const head = text.slice(0, limit);

  const subsection = /\bfor the [^0-9\n]{3,160}?(filling|base|crust|topping|sauce|icing|dressing|cheesecake|brownie|batter|ganache)\b/i.exec(
    head,
  );
  if (subsection) return subsection.index;

  let bestIndex = -1;
  const ingredientsRegex = /\bingredients\b/gi;
  let match: RegExpExecArray | null;
  while ((match = ingredientsRegex.exec(head)) !== null) {
    const tail = head.slice(match.index, match.index + INGREDIENT_LOOKAHEAD_LENGTH);
    if (/\d\s*(g|ml|kg|tbsp|tsp|cup|oz)\b/i.test(tail) || /\n\s*[-•*]/i.test(tail)) {
      bestIndex = match.index;
    }
  }
  return bestIndex;
}

/** Rejoin lines split inside “(about 2 tsp)” style parentheticals. */
const MERGE_NEXT_LINE_MAX_LENGTH = 90;

/** Rejoin ingredient lines split mid-parenthesis (e.g. quantity wrapped across two lines). */
function mergeBrokenParenthetical(lines: string[]): string[] {
  const merged: string[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    let current = lines[lineIndex]!;
    while (lineIndex + 1 < lines.length) {
      const openParenCount = (current.match(/\(/g) ?? []).length;
      const closeParenCount = (current.match(/\)/g) ?? []).length;
      if (openParenCount <= closeParenCount) break;
      const nextLine = lines[lineIndex + 1]!;
      if (nextLine.length > MERGE_NEXT_LINE_MAX_LENGTH) break;
      current = `${current} ${nextLine}`.trim();
      lineIndex++;
    }
    merged.push(current);
  }
  return merged;
}

const MIN_LINE_LENGTH = 2;
const DENSE_LINE_THRESHOLD = 3;

/**
 * Split a scraped ingredient block into lines; when the page is one dense paragraph,
 * insert breaks before quantities, “for the …” subsections, and common unit patterns.
 */
function splitRunInIngredientLines(block: string): string[] {
  const trimmed = block.trim();
  if (!trimmed) return [];

  const isDense =
    !trimmed.includes("\n") ||
    trimmed.split(/\n/).filter((line) => line.trim()).length < DENSE_LINE_THRESHOLD;

  if (!isDense) {
    return trimmed
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  const teaspoonLeadRegex = new RegExp(
    String.raw`\s+(?=(?:\d+\s*\u00bd|\d+\s+\u00bc|\d+\s+\u00be|\d+\s+\d/\d+|\d+)\s*(?:tbsp|tsp|tablespoons?|teaspoons?)\b)`,
    "gi",
  );
  const lined = trimmed
    .replace(/\s+(?=\bfor the\b)/gi, "\n")
    .replace(/(?<=[a-z)])(\s+)(?=\d+(?:\.\d+)?\s*(?:g|kg|mg|ml|cl|l|oz)\b)/gi, "\n")
    .replace(teaspoonLeadRegex, "\n")
    .replace(/\s+(?=\d+\s+(?:large|medium|small)\s+)/gi, "\n")
    .replace(/\s+(?=finely grated\b|\ba handful\b|\ba pinch\b)/gi, "\n");

  return lined
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > MIN_LINE_LENGTH);
}

const CLEANED_LINE_MIN_LENGTH = 3;
const SECTION_PREFIX_MAX_LENGTH = 120;
const META_HEAD_MAX_LENGTH = 60;
const SERVES_MAX_LENGTH = 40;
const MAX_INGREDIENT_LINES = 45;
const MIN_USABLE_LINES = 2;

/**
 * Heuristic: pull ingredient lines from scraped recipe page plain text (e.g. BBC Good Food).
 * Returns null when the block looks empty or unreliable.
 */
function extractIngredientLinesFromPagePlainText(plain: string): string[] | null {
  const text = plain.replace(/\r/g, "").replace(/\u00a0/g, " ");

  const start = findRecipeIngredientSectionStart(text);
  if (start < 0) return null;

  const tailFromStart = text.slice(start);
  const methodMatch = /\b(?:Ad\s+)?Method\b|\bNutrition:\s*per\b|\bNutrition facts\b/i.exec(tailFromStart);
  const promoMatch = /\bKeep the screen awake\b|\bcook mode on the\b/i.exec(tailFromStart);
  let cutIndex = tailFromStart.length;
  if (methodMatch) cutIndex = Math.min(cutIndex, methodMatch.index);
  if (promoMatch) cutIndex = Math.min(cutIndex, promoMatch.index);
  const block = tailFromStart.slice(0, cutIndex).trim();

  const rawLines = mergeBrokenParenthetical(splitRunInIngredientLines(block));
  const ingredientLines: string[] = [];
  let headingOnlySeen = false;
  let sectionPrefix = "";

  for (const rawLine of rawLines) {
    if (/^ingredients:?$/i.test(rawLine)) {
      headingOnlySeen = true;
      continue;
    }
    if (/advertisement|^cookie|^subscribe/i.test(rawLine)) continue;

    const cleaned = rawLine
      .replace(/^[-–—•*\u2022]+\s*/, "")
      .replace(/^\(?\s*\d+\s*\)?[.)]\s+/, "")
      .trim();
    if (!cleaned || cleaned.length < CLEANED_LINE_MIN_LENGTH) continue;

    if (
      /^(for the|for\s+)/i.test(cleaned) &&
      cleaned.length < SECTION_PREFIX_MAX_LENGTH &&
      !/\d\s*(?:ml|g|kg|cup|tbsp|tsp)\b/i.test(cleaned)
    ) {
      sectionPrefix = cleaned.replace(/\s*:?\s*$/, "").trim();
      continue;
    }

    const lowerCased = cleaned.toLowerCase();
    const looksLikeMetaHead =
      (/^(prep|cook time|prep time|prep:|ready in|cooks in|nutrition|nutrition information|equipment)\b/i.test(
        cleaned,
      ) &&
        cleaned.length < META_HEAD_MAX_LENGTH) ||
      (/^serves\b/i.test(cleaned) && /\d/.test(cleaned) && cleaned.length < SERVES_MAX_LENGTH);

    if (looksLikeMetaHead && ingredientLines.length === 0) continue;

    const looksLikeIngredient =
      /\d/.test(cleaned) ||
      /^for the\b/i.test(cleaned) ||
      /\b(tsp|tablespoons?|tablespoon|tbsp|tbs|teaspoons?|teaspoon|cup|grams?|g\b|kg|ml|cl|oz|ounces?|litre|liter|litres|liters|dash|splash|pinch|handful|stalk|cloves?|small|large|medium|carton)\b/i.test(
        lowerCased,
      );

    if (!looksLikeIngredient && ingredientLines.length === 0 && !headingOnlySeen) continue;
    if (!looksLikeIngredient && ingredientLines.length === 0) continue;

    const lineOut = sectionPrefix ? `${sectionPrefix}: ${cleaned}` : cleaned;
    ingredientLines.push(lineOut);
    if (ingredientLines.length > MAX_INGREDIENT_LINES) break;
  }

  if (ingredientLines.length < MIN_USABLE_LINES) return null;
  return ingredientLines;
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

  const ingredientLines = extractIngredientLinesFromPagePlainText(fetched.text);
  if (!ingredientLines || ingredientLines.length < MIN_USABLE_LINES) return base;

  const title = meal.strMeal || base.title;
  const instructions = String(meal.strInstructions ?? "").trim();
  const text = [
    title,
    "",
    "Ingredients:",
    ...ingredientLines.map((line) => `- ${line}`),
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
