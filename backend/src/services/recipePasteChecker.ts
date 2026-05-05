function hasRecipeKeywords(t: string): boolean {
  return (
    /\bingredients?\b/i.test(t) ||
    /\binstructions?\b/i.test(t) ||
    /\bmethod\b/i.test(t) ||
    /\bdirections?\b/i.test(t)
  );
}

function countIngredientLikeLines(lines: string[]): number {
  const unitRx =
    /\b(g|kg|mg|ml|l|tsp|tbsp|tablespoon|teaspoon|cup|cups|oz|ounce|ounces|lb|pound|pounds|pinch|clove|cloves|slice|slices)\b/i;
  let n = 0;
  for (const raw of lines) {
    const s = raw.trim();
    if (!s) continue;
    // Typical ingredient formatting: bullets or a leading quantity/unit.
    const bullet = /^[-•*]\s+/.test(s);
    const qty = /^\d+([\/.]\d+)?\s*/.test(s);
    if (bullet || (qty && unitRx.test(s)) || unitRx.test(s)) n++;
  }
  return n;
}

function hasInstructionLikeText(t: string): boolean {
  // Small set of common cooking verbs; this is a cheap “shape” check, not NLP.
  return /\b(mix|stir|whisk|combine|chop|slice|mince|saute|sauté|fry|bake|roast|boil|simmer|grill|heat|preheat|cook|serve)\b/i.test(
    t,
  );
}

/**
 * Cheap “looks like a food recipe” heuristic to block obvious abuse without an extra LLM call.
 * Intentionally permissive: it should reject obvious non-recipes (code, essays, random text),
 * while accepting common recipe formats (with or without explicit headers).
 */
export function looksLikeFoodRecipe(text: string): boolean {
  const t = text.trim();
  if (t.length < 40) return false;
  const lines = t.split("\n").slice(0, 220);
  const ingredientLines = countIngredientLikeLines(lines);
  const keywordOk = hasRecipeKeywords(t);
  const instructionOk = hasInstructionLikeText(t);
  // Accept if we see enough ingredient-like structure and some instruction signal.
  if (ingredientLines >= 3 && (instructionOk || keywordOk)) return true;
  // Also accept very structured recipes with explicit headers.
  if (keywordOk && ingredientLines >= 2) return true;
  return false;
}

