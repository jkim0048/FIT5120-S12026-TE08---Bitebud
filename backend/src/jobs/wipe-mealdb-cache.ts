/**
 * One-time / as-needed: delete cached MealDB recipes so the next import
 * re-fetches MealDB and re-enriches images.
 *
 * Deletes ONLY recipes where mealDbId is set. `recipe_progress` rows will
 * be removed by FK ON DELETE CASCADE.
 */
import "../env.js";
import { prisma } from "../prisma.js";
 
async function main() {
  const result = await prisma.recipe.deleteMany({
    where: { mealDbId: { not: null } },
  });
  // eslint-disable-next-line no-console
  console.log(`Deleted ${result.count} cached MealDB recipe(s) (mealDbId IS NOT NULL).`);
}
 
main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

