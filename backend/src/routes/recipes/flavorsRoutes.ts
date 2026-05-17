import type { FastifyInstance } from "fastify";
import { recipeDatabase } from "../../database/recipeDatabase.js";
import { parseRecipeGraph } from "../../graph/recipeGraph.js";
import { inferFlavorProfile } from "../../services/flavorProfile.js";

const FLAVOR_LABELS: Array<{ key: "sweet" | "salty" | "sour" | "bitter" | "spicy"; label: string }> = [
  { key: "sweet", label: "Sweet" },
  { key: "salty", label: "Salty" },
  { key: "sour", label: "Sour" },
  { key: "bitter", label: "Bitter" },
  { key: "spicy", label: "Spicy" },
];

/** Register `GET /api/recipes/:id/flavors` — group recipe ingredients by inferred flavour bucket. */
export async function registerFlavorsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/recipes/:id/flavors", async (request, reply) => {
    const { id } = request.params as { id: string };
    const recipe = await recipeDatabase.recipeFindUnique({ where: { id } });
    if (!recipe) return reply.status(404).send({ error: "Not found" });

    const graph = parseRecipeGraph(recipe.graph);
    const ingredients = (graph.nodes ?? [])
      .filter((node) => node.type === "ingredient")
      .map((node) => ({
        id: String(node.id),
        label: String(node.label ?? "").trim(),
        detail: String(node.detail ?? "").trim(),
      }))
      .filter((ingredient) => ingredient.id && ingredient.label);

    const inferredFlavorProfile = await inferFlavorProfile(ingredients);
    return reply.send({
      flavors: FLAVOR_LABELS.map((flavor) => ({
        key: flavor.key,
        label: flavor.label,
        ingredientIds: inferredFlavorProfile[flavor.key] ?? [],
      })).filter((flavor) => flavor.ingredientIds.length > 0),
    });
  });
}
