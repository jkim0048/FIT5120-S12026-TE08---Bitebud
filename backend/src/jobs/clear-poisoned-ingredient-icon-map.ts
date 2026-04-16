/**
 * One-time / as-needed: remove ingredient_icon_map rows that were inferred incorrectly
 * (e.g. "fillet" → random fish, "butter" → peanut butter) before matcher fixes.
 */
import "../env.js";
import { prisma } from "../prisma.js";

const POISONED_KEYS = [
  "butter",
  "fillet",
  "smoked salmon",
  "smoked salmon fillet",
];

async function main() {
  const result = await prisma.ingredientIconMap.deleteMany({
    where: { ingredientKey: { in: POISONED_KEYS } },
  });
  // eslint-disable-next-line no-console
  console.log(`Deleted ${result.count} ingredient_icon_map row(s) for keys: ${POISONED_KEYS.join(", ")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
