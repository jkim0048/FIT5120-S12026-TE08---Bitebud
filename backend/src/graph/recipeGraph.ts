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

/** Zod schema for a single node in a recipe DAG (ingredient, prep, cook, wait, assemble, serve). */
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

/** Zod schema for a directed edge between two recipe DAG nodes (`requires` or `uses`). */
export const recipeEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  type: edgeTypes,
});

/** Zod schema for the full recipe graph (title, metadata, nodes, edges). */
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

/** Parse and validate an arbitrary value as a `RecipeGraph`; throws a `ZodError` on bad shape. */
export function parseRecipeGraph(input: unknown): RecipeGraph {
  return recipeGraphSchema.parse(input);
}

/** Throw if the recipe graph references missing nodes or contains a directed cycle. */
export function validateDag(graph: RecipeGraph): void {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new Error(
        `Invalid edge: missing node for ${edge.source} -> ${edge.target}`,
      );
    }
  }
  const adjacency = new Map<string, string[]>();
  for (const nodeId of nodeIds) adjacency.set(nodeId, []);
  for (const edge of graph.edges) {
    adjacency.get(edge.source)!.push(edge.target);
  }
  const visitState = new Map<string, "visiting" | "done">();
  function visit(nodeId: string): void {
    if (visitState.get(nodeId) === "visiting") throw new Error("Graph contains a cycle");
    if (visitState.get(nodeId) === "done") return;
    visitState.set(nodeId, "visiting");
    for (const neighbour of adjacency.get(nodeId) ?? []) visit(neighbour);
    visitState.set(nodeId, "done");
  }
  for (const nodeId of nodeIds) {
    if (!visitState.has(nodeId)) visit(nodeId);
  }
}
