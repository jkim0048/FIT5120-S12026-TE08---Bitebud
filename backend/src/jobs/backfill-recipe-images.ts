import { prisma } from "../prisma.js";
import { lookupMealById } from "../services/themealdb.js";

async function main() {
  const rows = await prisma.recipe.findMany({
    where: {
      mealDbId: { not: null },
      OR: [{ imageUrl: null }, { imageUrl: "" }],
    },
    select: { id: true, mealDbId: true, imageUrl: true },
  });

  let updated = 0;
  for (const row of rows) {
    const mealDbId = row.mealDbId?.trim();
    if (!mealDbId) continue;
    try {
      const meal = await lookupMealById(mealDbId);
      const imageUrl = typeof meal.strMealThumb === "string" ? meal.strMealThumb.trim() : "";
      if (!imageUrl) continue;
      await prisma.recipe.update({
        where: { id: row.id },
        data: { imageUrl },
      });
      updated += 1;
    } catch (err) {
      console.warn(`Image backfill failed for recipe ${row.id} (mealDbId=${mealDbId})`, err);
    }
  }

  console.log(`Backfilled imageUrl for ${updated} recipe(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
