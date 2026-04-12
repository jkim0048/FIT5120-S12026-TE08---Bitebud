import type { RecipeGraph, RecipeNode } from "../graph/recipeGraph.js";
import { DIETARY_CULTURAL_CONSTRAINT_KEYWORDS } from "./dietaryConstraintKeywords.js";

export function normalizeFoodText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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
  const mapped = DIETARY_CULTURAL_CONSTRAINT_KEYWORDS[key];
  const fallback = normalizeFoodText(constraint);
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

export function recipeIngredientNodes(graph: RecipeGraph): RecipeNode[] {
  return graph.nodes.filter((n) => n.type === "ingredient");
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

export function matchStatusFromConflicts(
  sensory: SensoryFoodConflict[],
  dietary: DietaryConflict[],
): "safe" | "sometimes" | "unsafe" {
  const hasUnsafeSensory = sensory.some((s) => s.kind === "unsafe");
  const hasUnsureSensory = sensory.some((s) => s.kind === "unsure");
  const hasDietary = dietary.length > 0;
  if (hasUnsafeSensory || hasDietary) return "unsafe";
  if (hasUnsureSensory) return "sometimes";
  return "safe";
}

export function profileWarningsFromConflicts(
  sensory: SensoryFoodConflict[],
  dietary: DietaryConflict[],
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
