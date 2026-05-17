import type { RecipeGraph, RecipeNode } from "../graph/recipeGraph.js";
import { DIETARY_CULTURAL_CONSTRAINT_KEYWORDS } from "./dietaryConstraintKeywords.js";
import { INGREDIENT_TEXTURES, TEXTURE_VALUES, type TextureValue } from "./ingredientTextures.js";

/** Normalize free-form food text for matching (lowercase, strip punctuation, collapse whitespace). */
export function normalizeFoodText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokenize normalized food text into a de-duplicated set (drops 1-char tokens to reduce noise). */
export function tokenSet(s: string): Set<string> {
  const t = new Set<string>();
  for (const w of normalizeFoodText(s).split(" ")) {
    if (w.length > 1) t.add(w);
  }
  return t;
}

/** Heuristic: ingredient line matches a library food name (substring or shared token). */
export function ingredientMatchesFood(
  ingredientLabel: string,
  ingredientDetail: string,
  foodName: string,
): boolean {
  const hay = normalizeFoodText(`${ingredientLabel} ${ingredientDetail}`);
  const needle = normalizeFoodText(foodName);
  if (!hay || !needle) return false;
  if (hay.includes(needle) || needle.includes(hay)) return true;
  const a = tokenSet(`${ingredientLabel} ${ingredientDetail}`);
  const b = tokenSet(foodName);
  for (const tok of b) {
    if (tok.length > 2 && a.has(tok)) return true;
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
      Object.keys(DIETARY_CULTURAL_CONSTRAINT_KEYWORDS).find((k) => normalizeFoodText(k) === fallback) ?? ""
    ];

  if (mapped?.length) {
    const set = new Set<string>();
    for (const m of mapped) {
      const n = normalizeFoodText(m);
      if (n.length >= 2) set.add(n);
    }
    if (fallback.length >= 2) set.add(fallback);
    return [...set];
  }
  return fallback.length >= 2 ? [fallback] : [];
}

/** Check whether an ingredient’s label/detail contains any of the normalized “needle” patterns for a constraint. */
export function ingredientMatchesConstraint(
  ingredientLabel: string,
  ingredientDetail: string,
  constraint: string,
): boolean {
  const hay = normalizeFoodText(`${ingredientLabel} ${ingredientDetail}`);
  if (!hay) return false;
  for (const needle of constraintMatchNeedles(constraint)) {
    if (hay.includes(needle)) return true;
  }
  return false;
}

/** Return only the ingredient nodes from a parsed recipe graph. */
export function recipeIngredientNodes(graph: RecipeGraph): RecipeNode[] {
  return graph.nodes.filter((n) => n.type === "ingredient");
}

const TEXTURE_UNSAFE_PREFIX = "unsafe:";

const PROFILE_TEXTURE_EXTRAS = ["Powdery"] as const;
export type ProfileTextureValue = TextureValue | (typeof PROFILE_TEXTURE_EXTRAS)[number];

/** Decode stored texture prefs in the form `unsafe:<Texture>` into a de-duplicated list of allowed values. */
export function decodeUnsafeTexturePrefs(prefs: unknown): ProfileTextureValue[] {
  const out: ProfileTextureValue[] = [];
  const allowed = new Set<string>([...TEXTURE_VALUES, ...PROFILE_TEXTURE_EXTRAS]);
  if (!Array.isArray(prefs)) return out;
  for (const raw of prefs) {
    if (typeof raw !== "string") continue;
    if (!raw.startsWith(TEXTURE_UNSAFE_PREFIX)) continue;
    const v = raw.slice(TEXTURE_UNSAFE_PREFIX.length).trim();
    if (allowed.has(v) && !out.includes(v as ProfileTextureValue)) out.push(v as ProfileTextureValue);
  }
  return out;
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
  const out: TextureConflict[] = [];
  if (!unsafeTextures.length || !lines.length) return out;

  const unsafeSet = new Set<string>(unsafeTextures);
  const ingredientNames = Object.keys(INGREDIENT_TEXTURES);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.trim()) continue;
    for (const ingName of ingredientNames) {
      if (!ingredientMatchesFood(line, "", ingName)) continue;
      const texes = INGREDIENT_TEXTURES[ingName] ?? [];
      const matched = texes.find((t) => unsafeSet.has(t));
      if (matched) {
        out.push({
          nodeId: `ing-line-${i}`,
          label: line,
          matchedIngredient: ingName,
          matchedTexture: matched,
        });
      }
      break;
    }
  }
  return out;
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
  const watch = foods
    .filter((f) => f.status === "UNSAFE" || f.status === "UNSURE")
    .sort((a, b) => (a.status === "UNSAFE" ? 0 : 1) - (b.status === "UNSAFE" ? 0 : 1));

  for (const node of recipeIngredientNodes(graph)) {
    const label = node.label ?? "";
    const detail = node.detail ?? "";
    for (const f of watch) {
      if (ingredientMatchesFood(label, detail, f.name)) {
        sensory.push({
          nodeId: node.id,
          label,
          kind: f.status === "UNSAFE" ? "unsafe" : "unsure",
          matchedFood: f.name,
        });
        break;
      }
    }
    for (const c of dietaryNeeds) {
      if (c.trim() && ingredientMatchesConstraint(label, detail, c)) {
        dietary.push({
          nodeId: node.id,
          label,
          constraint: c,
          kind: "dietary",
        });
      }
    }
    for (const c of culturalRequirements) {
      if (c.trim() && ingredientMatchesConstraint(label, detail, c)) {
        dietary.push({
          nodeId: node.id,
          label,
          constraint: c,
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
  const hasUnsafeSensory = sensory.some((s) => s.kind === "unsafe");
  const hasUnsureSensory = sensory.some((s) => s.kind === "unsure");
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
  const out: string[] = [];
  for (const d of dietary) {
    const tag = d.kind === "cultural" ? `${d.constraint} (cultural)` : d.constraint;
    if (!out.includes(tag)) out.push(tag);
  }
  for (const s of sensory) {
    const tag = `Food: ${s.matchedFood}`;
    if (!out.includes(tag)) out.push(tag);
  }
  for (const t of textures) {
    const tag = `Texture: ${t.matchedTexture}`;
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}

/** Profile check using plain ingredient lines (e.g. TheMealDB strIngredient + measure). */
export function computeSensoryConflictsFromIngredientLines(
  lines: string[],
  foods: Array<{ name: string; status: "SAFE" | "UNSURE" | "UNSAFE" }>,
  dietaryNeeds: string[],
  culturalRequirements: string[],
): { sensory: SensoryFoodConflict[]; dietary: DietaryConflict[] } {
  const nodes: RecipeNode[] = lines.map((line, i) => ({
    id: `ing-line-${i}`,
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
