import { prisma } from "../prisma.js";
import { parseRecipeGraph } from "../graph/recipeGraph.js";
import { deriveRecipeMetadata } from "../services/recipeMetadata.js";

async function main() {
  const rows = await prisma.recipe.findMany({
    select: { id: true, graph: true, imageUrl: true, complexity: true, heatLevel: true, tags: true },
  });

  let updated = 0;
  for (const row of rows) {
    const graph = parseRecipeGraph(row.graph);
    const meta = deriveRecipeMetadata(graph);
    const nextTags = Array.isArray(row.tags) ? row.tags : meta.tags ?? [];
    const needsUpdate =
      row.complexity == null ||
      row.heatLevel == null ||
      !Array.isArray(row.tags) ||
      nextTags.length === 0;
    if (!needsUpdate) continue;

    await prisma.recipe.update({
      where: { id: row.id },
      data: {
        complexity: row.complexity ?? meta.complexity ?? null,
        heatLevel: row.heatLevel ?? meta.heatLevel ?? null,
        tags: (nextTags.length ? nextTags : (meta.tags ?? [])) as unknown as object,
      },
    });
    updated += 1;
  }

  console.log(`Backfilled recipe metadata for ${updated} recipe(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
