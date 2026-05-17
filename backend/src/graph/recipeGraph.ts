import { z } from "zod";

const nodeTypes = z.enum([
  "ingredient",
  "prep",
  "cook",
  "wait",
  "assemble",
  "serve",
]);
const edgeTypes = z.enum(["requires", "uses"]);

export const recipeNodeSchema = z.object({
  id: z.string(),
  type: nodeTypes,
  label: z.string(),
  detail: z.string(),
  emoji: z.string().optional(),
  lane: z.string().nullable().optional(),
  timeMinutes: z.number().nullable().optional(),
  ingredientIds: z.array(z.string()).optional(),
  pantryStatus: z
    .enum(["in_stock", "low", "missing", "untracked"])
    .optional(),
  icon: z.string().optional(),
  imageUrl: z.string().optional(),
});

export const recipeEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  type: edgeTypes,
});

export const recipeGraphSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  sourceUrl: z.string().nullable().optional(),
  heroImageUrl: z.string().nullable().optional(),
  totalTimeMinutes: z.number().nullable().optional(),
  servings: z.number().nullable().optional(),
  nodes: z.array(recipeNodeSchema),
  edges: z.array(recipeEdgeSchema),
});

export type RecipeGraph = z.infer<typeof recipeGraphSchema>;
export type RecipeNode = z.infer<typeof recipeNodeSchema>;
export type RecipeEdge = z.infer<typeof recipeEdgeSchema>;

export function parseRecipeGraph(input: unknown): RecipeGraph {
  return recipeGraphSchema.parse(input);
}

export function validateDag(graph: RecipeGraph): void {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  for (const e of graph.edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) {
      throw new Error(
        `Invalid edge: missing node for ${e.source} -> ${e.target}`,
      );
    }
  }
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of graph.edges) {
    adj.get(e.source)!.push(e.target);
  }
  const state = new Map<string, "visiting" | "done">();
  function visit(u: string): void {
    if (state.get(u) === "visiting") throw new Error("Graph contains a cycle");
    if (state.get(u) === "done") return;
    state.set(u, "visiting");
    for (const v of adj.get(u) ?? []) visit(v);
    state.set(u, "done");
  }
  for (const id of nodeIds) {
    if (!state.has(id)) visit(id);
  }
}
