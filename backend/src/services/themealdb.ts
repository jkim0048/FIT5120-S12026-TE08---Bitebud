const BASE = "https://www.themealdb.com/api/json/v1";

/** Resolve TheMealDB API key from env, falling back to the public development key (`1`). */
function apiKey(): string {
  // TheMealDB supports the public test key '1' for development.
  return (process.env.THEMEALDB_API_KEY ?? "1").trim() || "1";
}

export type MealDbSearchHit = {
  id: string;
  title: string;
  image?: string;
  minutes?: number | null;
  complexity?: "low" | "medium";
  heatLevel?: "none" | "low" | "medium";
};

export type MealDbMeal = {
  idMeal: string;
  strMeal: string;
  strMealThumb?: string | null;
  strInstructions?: string | null;
  strSource?: string | null;
  strYoutube?: string | null;
  [k: string]: unknown;
};

/** Ingredient lines as in recipe text (measure + name) for profile matching. */
export function mealIngredientLines(meal: MealDbMeal): string[] {
  const lines: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const ing = String((meal as Record<string, unknown>)[`strIngredient${i}`] ?? "").trim();
    const meas = String((meal as Record<string, unknown>)[`strMeasure${i}`] ?? "").trim();
    if (!ing) continue;
    lines.push(`${meas ? `${meas} ` : ""}${ing}`.trim());
  }
  return lines;
}

/** Looser normalization for cross-source matching (ingredient names, labels), used for substring contains checks. */
function normalizeLoose(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Build the canonical TheMealDB ingredient image URL for a raw ingredient name. */
function mealDbIngredientImageUrl(name: string): string {
  // TheMealDB ingredient images use this pattern.
  // Example: https://www.themealdb.com/images/ingredients/Smoked%20Salmon-Small.png
  return `https://www.themealdb.com/images/ingredients/${encodeURIComponent(name.trim())}-Small.png`;
}

/** Fetch JSON from a TheMealDB endpoint, throwing a readable error on non-2xx responses. */
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`TheMealDB request failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

/** Title + instructions + strMeasure1–20 (times often appear in measures). */
function mealTimeTextBlob(meal: MealDbMeal): string {
  const title = String(meal.strMeal ?? "").trim();
  const instructions = String(meal.strInstructions ?? "").trim();
  const measures: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const m = String((meal as Record<string, unknown>)[`strMeasure${i}`] ?? "").trim();
    if (m) measures.push(m);
  }
  return [title, instructions, ...measures].join("\n");
}

/**
 * Explicit durations: labeled prep/cook, ranges (upper bound per range, summed),
 * compact h/m and NN min, else legacy hour/minute scan (whole text).
 */
function parseExplicitMinutesFromText(text: string): number | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return null;

  let labeledSum = 0;
  const labeledRe =
    /(?:prep|preparation|active|cook|cooking|bake|chill|rest|marinate)\D{0,45}?(\d+)\s*(?:minute|minutes|min)\b/gi;
  let lm: RegExpExecArray | null;
  while ((lm = labeledRe.exec(t)) !== null) {
    const n = Number(lm[1]);
    if (Number.isFinite(n) && n > 0) labeledSum += Math.round(n);
  }

  let rangeSum = 0;
  const rangeRe = /(\d+)\s*[-–to]\s*(\d+)\s*(?:minute|minutes|mins?)\b/gi;
  let rm: RegExpExecArray | null;
  while ((rm = rangeRe.exec(t)) !== null) {
    const a = Number(rm[1]);
    const b = Number(rm[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
      rangeSum += Math.max(a, b);
    }
  }

  let compactBest = 0;
  const hmRe = /\b(\d{1,2})\s*h\s*(\d{1,2})\s*m\b/gi;
  let hm: RegExpExecArray | null;
  while ((hm = hmRe.exec(t)) !== null) {
    const total = Number(hm[1]) * 60 + Number(hm[2]);
    if (Number.isFinite(total) && total > 0) compactBest = Math.max(compactBest, Math.round(total));
  }
  const min2Re = /\b(\d{2,3})\s*min\b/gi;
  let m2: RegExpExecArray | null;
  while ((m2 = min2Re.exec(t)) !== null) {
    const n = Number(m2[1]);
    if (Number.isFinite(n) && n >= 10 && n <= 200) compactBest = Math.max(compactBest, Math.round(n));
  }

  const structured = Math.max(labeledSum, rangeSum, compactBest);
  if (structured > 0) return Math.max(5, Math.min(240, structured));

  let legacy = 0;
  let found = false;
  const hourRe = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b|(\d+(?:\.\d+)?)\s*h\b(?!\w)/gi;
  let m: RegExpExecArray | null;
  while ((m = hourRe.exec(t)) !== null) {
    const n = Number(m[1] ?? m[2]);
    if (Number.isFinite(n) && n > 0) {
      legacy += Math.round(n * 60);
      found = true;
    }
  }
  const minRe = /(\d+)\s*(?:minutes?|mins?)\b|(\d+)\s*m\b(?!\w)/gi;
  while ((m = minRe.exec(t)) !== null) {
    const n = Number(m[1] ?? m[2]);
    if (Number.isFinite(n) && n > 0) {
      legacy += Math.round(n);
      found = true;
    }
  }
  if (!found) return null;
  return Math.max(5, Math.min(240, legacy));
}

/** Step count without splitting on every period (avoids huge counts from one paragraph). */
function countInstructionSteps(instructions: string): number {
  const raw = instructions.trim();
  if (!raw) return 1;
  const lines = raw
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length >= 2) return Math.min(lines.length, 24);
  const numbered = raw.match(/(?:^|\n)\s*\d+[\).\]]\s+/g);
  if (numbered && numbered.length >= 2) return Math.min(numbered.length, 24);
  const sentences = raw
    .split(/[.!?]+\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return Math.max(1, Math.min(sentences.length, 12));
}

/**
 * Fallback minutes: kitchen base + capped step/ingredient estimate, then one method bump (highest priority wins).
 * Tiers (priority desc): long-wait/marinate/overnight (+35, cap 115) > marinating/slow cook (+28) > simmer/stew (+16) >
 * boil (+14) > bake/roast (+17) > grill/deep fry (+14) > sauté/stir-fry (+8) > cold/assemble (−8).
 */
function inferFallbackMinutes(instructions: string, steps: number, ingredientCount: number): number {
  const KITCHEN_BASE = 15;
  const MIN_PER_STEP = 4.5;
  const STEP_CAP = 48;
  const ING_SQRT_FACTOR = 6;
  const ING_MAX = 12;
  const ING_PREP_CAP = 20;
  const BASE_MIN = 18;
  const BASE_MAX = 80;
  const OUT_MIN = 15;
  const OUT_MAX_DEFAULT = 95;
  const OUT_MAX_LONG_WAIT = 115;

  const stepPart = Math.min(STEP_CAP, Math.round(steps * MIN_PER_STEP));
  const ingPart = Math.min(
    ING_PREP_CAP,
    Math.round(ING_SQRT_FACTOR * Math.sqrt(Math.min(Math.max(ingredientCount, 0), ING_MAX))),
  );
  let base = KITCHEN_BASE + stepPart + ingPart;
  base = Math.max(BASE_MIN, Math.min(BASE_MAX, base));

  const low = instructions.toLowerCase();
  type MethodTier = { priority: number; bump: number; longWait: boolean; test: (s: string) => boolean };
  const tiers: MethodTier[] = [
    {
      priority: 100,
      bump: 35,
      longWait: true,
      test: (s) =>
        /\b(overnight|refrigerate overnight|slow cook for|marinate for|proof for|prove for|rising for|rise for|bulk ferment)\b/.test(
          s,
        ) || /\b(marinate|proof|prove|rise)\b.*\b(hour|hours|overnight)\b/.test(s),
    },
    {
      priority: 90,
      bump: 28,
      longWait: true,
      test: (s) => /\b(marinating|proofing|proving|slow cook)\b/.test(s),
    },
    {
      priority: 75,
      bump: 16,
      longWait: false,
      test: (s) => /\b(simmer|stew|braise|slowly simmer)\b/.test(s),
    },
    {
      priority: 70,
      bump: 14,
      longWait: false,
      test: (s) => /\b(rolling boil|boil until|boil for)\b/.test(s) || /\bboil\b/.test(s),
    },
    {
      priority: 65,
      bump: 17,
      longWait: false,
      test: (s) => /\b(bake|baking|roast|roasting|oven at|in the oven|preheated oven)\b/.test(s),
    },
    {
      priority: 55,
      bump: 14,
      longWait: false,
      test: (s) => /\b(grill|grilling|broil|broiling|deep[- ]?fry|deep fry)\b/.test(s),
    },
    {
      priority: 45,
      bump: 8,
      longWait: false,
      test: (s) => /\b(saut[eé]|sautee|pan[- ]?fry|stir[- ]?fry|fry until|frying)\b/.test(s),
    },
    {
      priority: 15,
      bump: -8,
      longWait: false,
      test: (s) =>
        /\b(serve cold|no[- ]?cook|mix together|combine in (a )?bowl|toss with|just mix|salad)\b/.test(s),
    },
  ];

  tiers.sort((a, b) => b.priority - a.priority);
  let bump = 0;
  let longWait = false;
  for (const tier of tiers) {
    if (tier.test(low)) {
      bump = tier.bump;
      longWait = tier.longWait;
      break;
    }
  }

  const maxOut = longWait ? OUT_MAX_LONG_WAIT : OUT_MAX_DEFAULT;
  const total = base + bump;
  return Math.max(OUT_MIN, Math.min(maxOut, total));
}

/** Infer total minutes for a MealDB meal using explicit time parsing first, then a heuristic fallback estimate. */
function inferMinutes(meal: MealDbMeal): number {
  const instructions = String(meal.strInstructions ?? "").trim();
  const blob = mealTimeTextBlob(meal);
  const explicit = parseExplicitMinutesFromText(blob);
  if (explicit != null) return explicit;

  const steps = countInstructionSteps(instructions);
  let ingredients = 0;
  for (let i = 1; i <= 20; i++) {
    const ing = String((meal as Record<string, unknown>)[`strIngredient${i}`] ?? "").trim();
    if (ing) ingredients += 1;
  }
  return inferFallbackMinutes(instructions, steps, ingredients);
}

/** Coarse “heat” level based on cooking-method keywords in the instructions. */
function inferHeatLevel(meal: MealDbMeal): "none" | "low" | "medium" {
  const text = String(meal.strInstructions ?? "").toLowerCase();
  if (/(fry|boil|bake|roast|grill|saute|simmer)/.test(text)) return "medium";
  if (/(warm|heat gently|low heat)/.test(text)) return "low";
  return "none";
}

/** Coarse complexity based on estimated instruction step count. */
function inferComplexity(meal: MealDbMeal): "low" | "medium" {
  const instructions = String(meal.strInstructions ?? "").trim();
  const steps = countInstructionSteps(instructions);
  return steps > 8 ? "medium" : "low";
}

/** Compute derived fields used by search hit cards (time/heat/complexity). */
export function mealSearchHitFields(meal: MealDbMeal): {
  minutes: number;
  heatLevel: "none" | "low" | "medium";
  complexity: "low" | "medium";
} {
  return {
    minutes: inferMinutes(meal),
    heatLevel: inferHeatLevel(meal),
    complexity: inferComplexity(meal),
  };
}

/**
 * Search meals by free-text query and map to lightweight hit cards.
 *
 * Applies optional time/complexity/heat filters and uses best-effort time inference when API data lacks it.
 */
export async function searchMeals(
  query: string,
  filters?: { maxMinutes?: number; complexity?: string; heatLevel?: string },
): Promise<MealDbSearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `${BASE}/${encodeURIComponent(apiKey())}/search.php?s=${encodeURIComponent(q)}`;
  const data = await getJson<{ meals: MealDbMeal[] | null }>(
    url,
  );
  const meals = data.meals ?? [];
  const mapped = meals.map((m) => {
    const minutes = inferMinutes(m);
    const heatLevel = inferHeatLevel(m);
    const complexity = inferComplexity(m);
    return {
      id: String(m.idMeal),
      title: m.strMeal,
      image: m.strMealThumb ?? undefined,
      minutes,
      heatLevel,
      complexity,
    };
  });
  return mapped.filter((m) => {
    if (filters?.maxMinutes != null && (m.minutes ?? 999) > filters.maxMinutes) return false;
    if (filters?.complexity && filters.complexity !== "any" && m.complexity !== filters.complexity) return false;
    if (filters?.heatLevel && filters.heatLevel !== "any" && m.heatLevel !== filters.heatLevel) return false;
    return true;
  });
}

/** Convert a list of MealDB rows to filtered `MealDbSearchHit`s with inferred fields (shared by multiple endpoints). */
function mapMealsToHits(
  meals: MealDbMeal[],
  filters?: { maxMinutes?: number; complexity?: string; heatLevel?: string },
): MealDbSearchHit[] {
  const mapped = meals.map((m) => {
    const minutes = inferMinutes(m);
    const heatLevel = inferHeatLevel(m);
    const complexity = inferComplexity(m);
    return {
      id: String(m.idMeal),
      title: m.strMeal,
      image: m.strMealThumb ?? undefined,
      minutes,
      heatLevel,
      complexity,
    };
  });
  return mapped.filter((m) => {
    if (filters?.maxMinutes != null && (m.minutes ?? 999) > filters.maxMinutes) return false;
    if (filters?.complexity && filters.complexity !== "any" && m.complexity !== filters.complexity) return false;
    if (filters?.heatLevel && filters.heatLevel !== "any" && m.heatLevel !== filters.heatLevel) return false;
    return true;
  });
}

/** Meals whose names start with a single letter (TheMealDB search.php?f=) */
export async function searchMealsByFirstLetter(
  letter: string,
  filters?: { maxMinutes?: number; complexity?: string; heatLevel?: string },
): Promise<MealDbSearchHit[]> {
  const L = letter.trim().toLowerCase().slice(0, 1);
  if (!L || !/[a-z]/.test(L)) return [];
  const url = `${BASE}/${encodeURIComponent(apiKey())}/search.php?f=${encodeURIComponent(L)}`;
  const data = await getJson<{ meals: MealDbMeal[] | null }>(url);
  const meals = data.meals ?? [];
  return mapMealsToHits(meals, filters);
}

/** Browse catalog without a query: rotate by letter index for pagination */
export async function browseMealsPage(
  page: number,
  limit: number,
  filters?: { maxMinutes?: number; complexity?: string; heatLevel?: string },
): Promise<MealDbSearchHit[]> {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const letter = letters[Math.abs(page) % 26] ?? "a";
  const all = await searchMealsByFirstLetter(letter, filters);
  return all.slice(0, limit);
}

/** Same ordering as `searchMeals` hits, with full meal rows for ingredient-based profile checks. */
export async function searchMealsOrdered(
  query: string,
  filters?: { maxMinutes?: number; complexity?: string; heatLevel?: string },
): Promise<MealDbMeal[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `${BASE}/${encodeURIComponent(apiKey())}/search.php?s=${encodeURIComponent(q)}`;
  const data = await getJson<{ meals: MealDbMeal[] | null }>(url);
  const meals = data.meals ?? [];
  const hits = mapMealsToHits(meals, filters);
  const byId = new Map(meals.map((m) => [String(m.idMeal), m]));
  return hits.map((h) => byId.get(h.id)).filter((m): m is MealDbMeal => Boolean(m));
}

/** Same ordering as `browseMealsPage`, with full meal rows. */
export async function browseMealsOrdered(
  page: number,
  limit: number,
  filters?: { maxMinutes?: number; complexity?: string; heatLevel?: string },
): Promise<MealDbMeal[]> {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const letter = letters[Math.abs(page) % 26] ?? "a";
  const url = `${BASE}/${encodeURIComponent(apiKey())}/search.php?f=${encodeURIComponent(letter)}`;
  const data = await getJson<{ meals: MealDbMeal[] | null }>(url);
  const meals = data.meals ?? [];
  const hits = mapMealsToHits(meals, filters);
  const top = hits.slice(0, limit);
  const byId = new Map(meals.map((m) => [String(m.idMeal), m]));
  return top.map((h) => byId.get(h.id)).filter((m): m is MealDbMeal => Boolean(m));
}

/** Look up a single meal by id (throws when id is empty or meal is missing). */
export async function lookupMealById(id: string): Promise<MealDbMeal> {
  const mealId = id.trim();
  if (!mealId) throw new Error("MealDB id required");
  const url = `${BASE}/${encodeURIComponent(apiKey())}/lookup.php?i=${encodeURIComponent(mealId)}`;
  const data = await getJson<{ meals: MealDbMeal[] | null }>(url);
  const meal = (data.meals ?? [])[0];
  if (!meal) throw new Error("Meal not found");
  return meal;
}

/**
 * Convert a MealDB row into a plain-text recipe block suitable for downstream graph parsing.
 *
 * Includes an Ingredients section, an Instructions section, and returns optional source/image URLs for UI attribution.
 */
export function mealToRecipeText(meal: MealDbMeal): {
  title: string;
  text: string;
  sourceUrl?: string | null;
  imageUrl?: string | null;
} {
  const title = meal.strMeal || "Recipe";
  const ingredients: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const ing = String((meal as Record<string, unknown>)[`strIngredient${i}`] ?? "").trim();
    const meas = String((meal as Record<string, unknown>)[`strMeasure${i}`] ?? "").trim();
    if (!ing) continue;
    ingredients.push(`${meas ? `${meas} ` : ""}${ing}`.trim());
  }
  const instructions = String(meal.strInstructions ?? "").trim();
  const sourceUrl =
    (typeof meal.strSource === "string" && meal.strSource.trim()) ? meal.strSource.trim() :
    (typeof meal.strYoutube === "string" && meal.strYoutube.trim()) ? meal.strYoutube.trim() :
    null;

  const text = [
    title,
    "",
    "Ingredients:",
    ...ingredients.map((x) => `- ${x}`),
    "",
    "Instructions:",
    instructions || "(No instructions provided.)",
  ].join("\n");

  return {
    title,
    text,
    sourceUrl,
    imageUrl: typeof meal.strMealThumb === "string" && meal.strMealThumb.trim() ? meal.strMealThumb.trim() : null,
  };
}

/**
 * Enrich a parsed recipe graph with MealDB-derived images.
 *
 * Sets `heroImageUrl` from the meal thumbnail and adds per-ingredient `imageUrl` matches using normalized
 * substring matching (prefers the longest matching ingredient token).
 */
export function enrichGraphWithMealDbImages<TGraph extends { heroImageUrl?: string | null; nodes: Array<any> }>(
  meal: MealDbMeal,
  graph: TGraph,
): TGraph {
  const hero = typeof meal.strMealThumb === "string" ? meal.strMealThumb.trim() : "";
  const heroImageUrl = hero ? hero : null;

  const mealIngredients: Array<{ raw: string; norm: string; imageUrl: string }> = [];
  for (let i = 1; i <= 20; i++) {
    const raw = String((meal as Record<string, unknown>)[`strIngredient${i}`] ?? "").trim();
    if (!raw) continue;
    mealIngredients.push({ raw, norm: normalizeLoose(raw), imageUrl: mealDbIngredientImageUrl(raw) });
  }

  const nodes = graph.nodes.map((n: any) => {
    if (n?.type !== "ingredient") return n;
    const label = String(n.label ?? "").trim();
    if (!label) return n;
    const labelNorm = normalizeLoose(label);

    // Prefer best (longest) ingredient name that appears within the node label.
    let best: { len: number; imageUrl: string } | null = null;
    for (const mi of mealIngredients) {
      if (!mi.norm) continue;
      if (!labelNorm.includes(mi.norm)) continue;
      if (!best || mi.norm.length > best.len) best = { len: mi.norm.length, imageUrl: mi.imageUrl };
    }
    if (!best) return n;
    return { ...n, imageUrl: best.imageUrl };
  });

  return { ...(graph as any), heroImageUrl, nodes } as TGraph;
}

