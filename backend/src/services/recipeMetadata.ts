import type { RecipeGraph } from "../graph/recipeGraph.js";

export type RecipeMetadata = {
  imageUrl?: string | null;
  complexity?: string | null;
  heatLevel?: string | null;
  tags?: string[];
};

export function deriveRecipeMetadata(graph: RecipeGraph): Omit<RecipeMetadata, "imageUrl"> {
  const steps = graph.nodes.filter((n) => n.type !== "ingredient");
  const text = steps.map((s) => `${s.label} ${s.detail}`.toLowerCase()).join(" ");
  const complexity =
    steps.length <= 6 ? "low" : steps.length <= 10 ? "medium" : "high";
  const heatLevel = text.includes("boil") || text.includes("fry") || text.includes("medium")
    ? "medium"
    : text.includes("low") || text.includes("simmer")
      ? "low"
      : "none";

  const tags: string[] = [];
  if (text.includes("smooth") || text.includes("blend")) tags.push("Smooth");
  if (text.includes("soft") || text.includes("mash") || text.includes("boil")) tags.push("Soft");
  tags.push("Profile friendly");

  return { complexity, heatLevel, tags };
}
