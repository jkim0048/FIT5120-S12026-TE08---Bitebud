import type { RecipeGraph, RecipeNode } from "../graph/recipeGraph.js";
import { DIETARY_CULTURAL_CONSTRAINT_KEYWORDS } from "./dietaryConstraintKeywords.js";
import { INGREDIENT_TEXTURES, TEXTURE_VALUES, type TextureValue } from "./ingredientTextures.js";

/** Normalize free-form food text for matching (lowercase, strip punctuation, collapse whitespace). */
export function normalizeFoodText(rawText: string): string {
  return rawText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokenize normalized food text into a de-duplicated set (drops 1-char tokens to reduce noise). */
export function tokenSet(rawText: string): Set<string> {
  const tokens = new Set<string>();
  for (const word of normalizeFoodText(rawText).split(" ")) {
    if (word.length > 1) tokens.add(word);
  }
  return tokens;
}

/** Heuristic: ingredient line matches a library food name (substring or shared token). */
export function ingredientMatchesFood(
  ingredientLabel: string,
  ingredientDetail: string,
  foodName: string,
): boolean {
  const haystack = normalizeFoodText(`${ingredientLabel} ${ingredientDetail}`);
  const needle = normalizeFoodText(foodName);
  if (!haystack || !needle) return false;
  if (haystack.includes(needle) || needle.includes(haystack)) return true;
  const ingredientTokens = tokenSet(`${ingredientLabel} ${ingredientDetail}`);
  const foodTokens = tokenSet(foodName);
  for (const token of foodTokens) {
    if (token.length > 2 && ingredientTokens.has(token)) return true;
  }
  return false;
}

/** Normalized substrings to match in ingredient text for a given profile chip label. */
export function constraintMatchNeedles(constraint: string): string[] {
  const key = constraint.trim();
  const fallback = normalizeFoodText(constraint);

  // Accept different casing/punctuation in saved labels (e.g. "No beef" vs "No Beef").
  const mapped =
    DIETARY_CULTURAL_CONSTRAINT_KEYWORDS[key] ??
    DIETARY_CULTURAL_CONSTRAINT_KEYWORDS[
      Object.keys(DIETARY_CULTURAL_CONSTRAINT_KEYWORDS).find(
        (mappingKey) => normalizeFoodText(mappingKey) === fallback,
      ) ?? ""
    ];

  if (mapped?.length) {
    const needles = new Set<string>();
    for (const keyword of mapped) {
      const normalized = normalizeFoodText(keyword);
      if (normalized.length >= 2) needles.add(normalized);
    }
    if (fallback.length >= 2) needles.add(fallback);
    return [...needles];
  }
  return fallback.length >= 2 ? [fallback] : [];
}

/** Check whether an ingredient’s label/detail contains any of the normalized “needle” patterns for a constraint. */
export function ingredientMatchesConstraint(
  ingredientLabel: string,
  ingredientDetail: string,
  constraint: string,
): boolean {
  const haystack = normalizeFoodText(`${ingredientLabel} ${ingredientDetail}`);
  if (!haystack) return false;
  for (const needle of constraintMatchNeedles(constraint)) {
    if (haystack.includes(needle)) return true;
  }
  return false;
}

/** Return only the ingredient nodes from a parsed recipe graph. */
export function recipeIngredientNodes(graph: RecipeGraph): RecipeNode[] {
  return graph.nodes.filter((node) => node.type === "ingredient");
}

const TEXTURE_UNSAFE_PREFIX = "unsafe:";

const PROFILE_TEXTURE_EXTRAS = ["Powdery"] as const;
export type ProfileTextureValue = TextureValue | (typeof PROFILE_TEXTURE_EXTRAS)[number];

/** Decode stored texture prefs in the form `unsafe:<Texture>` into a de-duplicated list of allowed values. */
export function decodeUnsafeTexturePrefs(prefs: unknown): ProfileTextureValue[] {
  const unsafeTextures: ProfileTextureValue[] = [];
  const allowed = new Set<string>([...TEXTURE_VALUES, ...PROFILE_TEXTURE_EXTRAS]);
  if (!Array.isArray(prefs)) return unsafeTextures;
  for (const rawPref of prefs) {
    if (typeof rawPref !== "string") continue;
    if (!rawPref.startsWith(TEXTURE_UNSAFE_PREFIX)) continue;
    const textureValue = rawPref.slice(TEXTURE_UNSAFE_PREFIX.length).trim();
    if (
      allowed.has(textureValue) &&
      !unsafeTextures.includes(textureValue as ProfileTextureValue)
    ) {
      unsafeTextures.push(textureValue as ProfileTextureValue);
    }
  }
  return unsafeTextures;
}

export type SensoryFoodConflict = {
  nodeId: string;
  label: string;
  kind: "unsafe" | "unsure";
  matchedFood: string;
};

export type DietaryConflict = {
  nodeId: string;
  label: string;
  constraint: string;
  kind: "dietary" | "cultural";
};

export type TextureConflict = {
  nodeId: string;
  label: string;
  matchedIngredient: string;
  matchedTexture: TextureValue;
};

/**
 * Detect texture conflicts from plain ingredient lines by matching against the ingredient→texture library.
 *
 * Uses the same “ingredientMatchesFood” heuristic and returns synthetic node ids (`ing-line-N`) for UI attribution.
 */
export function computeTextureConflictsFromIngredientLines(
  lines: string[],
  unsafeTextures: readonly ProfileTextureValue[],
): TextureConflict[] {
  const conflicts: TextureConflict[] = [];
  if (!unsafeTextures.length || !lines.length) return conflicts;

  const unsafeSet = new Set<string>(unsafeTextures);
  const ingredientNames = Object.keys(INGREDIENT_TEXTURES);
  for (const [lineIndex, lineRaw] of lines.entries()) {
    const line = lineRaw ?? "";
    if (!line.trim()) continue;
    for (const ingredientName of ingredientNames) {
      if (!ingredientMatchesFood(line, "", ingredientName)) continue;
      const textures = INGREDIENT_TEXTURES[ingredientName] ?? [];
      const matchedTexture = textures.find((texture) => unsafeSet.has(texture));
      if (matchedTexture) {
        conflicts.push({
          nodeId: `ing-line-${lineIndex}`,
          label: line,
          matchedIngredient: ingredientName,
          matchedTexture,
        });
      }
      break;
    }
  }
  return conflicts;
}

/**
 * Compute profile conflicts (sensory unsafe/unsure, and dietary/cultural constraints) from a parsed recipe graph.
 *
 * Outputs two arrays of conflicts keyed by ingredient node id for UI highlighting and safety scoring.
 */
export function computeSensoryConflicts(
  graph: RecipeGraph,
  foods: Array<{ name: string; status: "SAFE" | "UNSURE" | "UNSAFE" }>,
  dietaryNeeds: string[],
  culturalRequirements: string[],
): { sensory: SensoryFoodConflict[]; dietary: DietaryConflict[] } {
  const sensory: SensoryFoodConflict[] = [];
  const dietary: DietaryConflict[] = [];
  const watchList = foods
    .filter((food) => food.status === "UNSAFE" || food.status === "UNSURE")
    .sort(
      (firstFood, secondFood) =>
        (firstFood.status === "UNSAFE" ? 0 : 1) - (secondFood.status === "UNSAFE" ? 0 : 1),
    );

  for (const node of recipeIngredientNodes(graph)) {
    const label = node.label ?? "";
    const detail = node.detail ?? "";
    for (const food of watchList) {
      if (ingredientMatchesFood(label, detail, food.name)) {
        sensory.push({
          nodeId: node.id,
          label,
          kind: food.status === "UNSAFE" ? "unsafe" : "unsure",
          matchedFood: food.name,
        });
        break;
      }
    }
    for (const dietaryConstraint of dietaryNeeds) {
      if (dietaryConstraint.trim() && ingredientMatchesConstraint(label, detail, dietaryConstraint)) {
        dietary.push({
          nodeId: node.id,
          label,
          constraint: dietaryConstraint,
          kind: "dietary",
        });
      }
    }
    for (const culturalConstraint of culturalRequirements) {
      if (
        culturalConstraint.trim() &&
        ingredientMatchesConstraint(label, detail, culturalConstraint)
      ) {
        dietary.push({
          nodeId: node.id,
          label,
          constraint: culturalConstraint,
          kind: "cultural",
        });
      }
    }
  }

  return { sensory, dietary };
}

/** Collapse conflict lists into a coarse overall match status used by the UI (“safe”/“sometimes”/“unsafe”). */
export function matchStatusFromConflicts(
  sensory: SensoryFoodConflict[],
  dietary: DietaryConflict[],
  textures: TextureConflict[] = [],
): "safe" | "sometimes" | "unsafe" {
  const hasUnsafeSensory = sensory.some((conflict) => conflict.kind === "unsafe");
  const hasUnsureSensory = sensory.some((conflict) => conflict.kind === "unsure");
  const hasDietary = dietary.length > 0;
  const hasTexture = textures.length > 0;
  if (hasUnsafeSensory || hasDietary || hasTexture) return "unsafe";
  if (hasUnsureSensory) return "sometimes";
  return "safe";
}

/** Turn conflicts into de-duplicated, human-readable warning tags suitable for a small UI chip list. */
export function profileWarningsFromConflicts(
  sensory: SensoryFoodConflict[],
  dietary: DietaryConflict[],
  textures: TextureConflict[] = [],
): string[] {
  const warnings: string[] = [];
  for (const dietaryConflict of dietary) {
    const tag =
      dietaryConflict.kind === "cultural"
        ? `${dietaryConflict.constraint} (cultural)`
        : dietaryConflict.constraint;
    if (!warnings.includes(tag)) warnings.push(tag);
  }
  for (const sensoryConflict of sensory) {
    const tag = `Food: ${sensoryConflict.matchedFood}`;
    if (!warnings.includes(tag)) warnings.push(tag);
  }
  for (const textureConflict of textures) {
    const tag = `Texture: ${textureConflict.matchedTexture}`;
    if (!warnings.includes(tag)) warnings.push(tag);
  }
  return warnings;
}

/** Profile check using plain ingredient lines (e.g. TheMealDB strIngredient + measure). */
export function computeSensoryConflictsFromIngredientLines(
  lines: string[],
  foods: Array<{ name: string; status: "SAFE" | "UNSURE" | "UNSAFE" }>,
  dietaryNeeds: string[],
  culturalRequirements: string[],
): { sensory: SensoryFoodConflict[]; dietary: DietaryConflict[] } {
  const nodes: RecipeNode[] = lines.map((line, lineIndex) => ({
    id: `ing-line-${lineIndex}`,
    type: "ingredient",
    label: line,
    detail: "",
  }));
  const graph: RecipeGraph = {
    title: "catalog",
    nodes,
    edges: [],
  };
  return computeSensoryConflicts(graph, foods, dietaryNeeds, culturalRequirements);
}
