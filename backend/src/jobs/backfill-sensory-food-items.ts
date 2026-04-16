/**
 * One-time: copy legacy safeFoods / unsafeFoods / sometimesFoods JSON arrays
 * into sensory_food_items when a profile has no rows yet.
 */
import "../env.js";
import { PrismaClient, SensoryFoodStatus } from "@prisma/client";

const prisma = new PrismaClient();

function stringsFromJson(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

async function main() {
  const profiles = await prisma.sensoryProfile.findMany({
    include: { _count: { select: { foodItems: true } } },
  });

  let created = 0;
  for (const p of profiles) {
    if (p._count.foodItems > 0) continue;

    const safe = stringsFromJson(p.safeFoods);
    const unsafe = stringsFromJson(p.unsafeFoods);
    const sometimes = stringsFromJson(p.sometimesFoods);
    if (safe.length === 0 && unsafe.length === 0 && sometimes.length === 0) {
      continue;
    }

    const rows: Array<{ name: string; status: SensoryFoodStatus }> = [
      ...safe.map((name) => ({ name, status: SensoryFoodStatus.SAFE })),
      ...unsafe.map((name) => ({ name, status: SensoryFoodStatus.UNSAFE })),
      ...sometimes.map((name) => ({ name, status: SensoryFoodStatus.UNSURE })),
    ];

    for (const r of rows) {
      const trimmed = r.name.trim();
      if (!trimmed) continue;
      await prisma.sensoryFoodItem.create({
        data: {
          profileId: p.id,
          name: trimmed,
          status: r.status,
          notes: {},
        },
      });
      created += 1;
    }
  }

  console.log(`Backfill complete. Created ${created} food item row(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
