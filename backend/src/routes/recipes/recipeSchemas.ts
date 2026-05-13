import { z } from "zod";
import { zSearchQuery, zUserRecipeText } from "../../validation/text.js";

/** Body schema for `POST /api/recipes/visualise`: raw recipe text + optional source URL. */
export const visualiseBody = z.object({
  text: zUserRecipeText,
  sourceUrl: z.string().optional().nullable(),
});

/** Body schema for `POST /api/recipes/import/themealdb`: the upstream MealDB id. */
export const importBody = z.object({
  mealDbId: z.string().min(1),
});

/** Query schema for `GET /api/recipes/browse`: pagination + filter knobs for My Recipes. */
export const browseQuery = z.object({
  q: z.string().optional(),
  filter: z.enum(["safeDishes", "showAll"]).optional().default("safeDishes"),
  maxMinutes: z.coerce.number().int().positive().optional(),
  complexity: z.string().optional(),
  heatLevel: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(24),
  skip: z.coerce.number().int().min(0).optional().default(0),
  sort: z.enum(["recommended", "newest"]).optional().default("newest"),
});

/** Query schema for `GET /api/recipes/search`: free-text + pagination + sensory filter knobs. */
export const searchQuery = z.object({
  q: zSearchQuery.optional(),
  page: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().min(1).max(100).optional().default(24),
  maxMinutes: z.coerce.number().int().positive().optional(),
  complexity: z.string().optional(),
  heatLevel: z.string().optional(),
  filter: z.enum(["safeDishes", "showAll"]).optional().default("safeDishes"),
});

/** Body schema for `POST /api/recipes/:id/progress`: list of completed graph node ids. */
export const progressBody = z.object({
  completedNodeIds: z.array(z.string()),
});

/** Enum of "what worked" feedback tags the UI can attach to a completion. */
export const completionWorkedTaxonomy = z.enum([
  "low-prep",
  "few-ingredients",
  "one-pan",
  "sweet-savoury",
  "comforting-texture",
  "matched-sensory-profile",
  "easy-cleanup",
  "clear-steps",
]);

/** Enum of "what didn't work" feedback tags the UI can attach to a completion. */
export const completionDidntWorkTaxonomy = z.enum([
  "too-many-steps",
  "too-many-ingredients",
  "too-long",
  "thick-sauce",
  "unfamiliar-method",
  "texture-issue",
  "flavour-too-strong",
  "ingredient-issue",
]);

/** Body schema for `POST /api/recipes/:id/completions`: rating, worked/didn't-work tags, notes. */
export const completionBody = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  wouldRepeat: z.boolean().optional(),
  worked: z.array(completionWorkedTaxonomy).optional(),
  didntWork: z.array(completionDidntWorkTaxonomy).optional(),
  notes: z.string().max(2000).optional(),
});
