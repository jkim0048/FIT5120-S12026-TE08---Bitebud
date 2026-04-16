import { prisma } from "../prisma.js";

function normalizeSpaces(v: string): string {
  return v
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function singularizeSimple(value: string): string {
  if (!value) return value;
  if (value.endsWith("ies") && value.length > 3) return value.slice(0, -3) + "y";
  if (value.endsWith("oes") && value.length > 3) return value.slice(0, -2); // tomatoes -> tomato
  if (value.endsWith("ses") && value.length > 3) return value.slice(0, -2);
  if (value.endsWith("s") && !value.endsWith("ss") && value.length > 3) return value.slice(0, -1);
  return value;
}

function singularizeWords(v: string): string {
  const parts = normalizeSpaces(v).split(" ").filter(Boolean);
  return parts.map(singularizeSimple).join(" ").trim();
}

function variantsForIcon(icon: { id: string; name: string }): string[] {
  const base: string[] = [];

  const idNorm = normalizeSpaces(icon.id);
  const nameNorm = normalizeSpaces(icon.name);
  base.push(idNorm, nameNorm);
  base.push(singularizeWords(idNorm), singularizeWords(nameNorm));

  return [...new Set(base.filter(Boolean))];
}

async function main(): Promise<void> {
  const icons = await prisma.wickedIcon.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const existing = await prisma.ingredientIconMap.findMany({
    select: { ingredientKey: true, wickedIconId: true },
  });
  const existingByKey = new Map(existing.map((r) => [r.ingredientKey, r.wickedIconId]));

  let upserted = 0;
  let skippedCollision = 0;

  // Track collisions in this run.
  const desiredByKey = new Map<string, string>();

  for (const icon of icons) {
    for (const key of variantsForIcon(icon)) {
      const prev = desiredByKey.get(key);
      if (prev && prev !== icon.id) {
        // collision between two icons on the same alias key; don't auto-map it
        desiredByKey.delete(key);
        skippedCollision += 1;
        continue;
      }
      desiredByKey.set(key, icon.id);
    }
  }

  // Apply desired mappings, but never overwrite an explicit existing mapping to a different icon.
  for (const [key, wickedIconId] of desiredByKey.entries()) {
    // Skip overly generic keys that frequently map incorrectly unless you have a dedicated icon.
    if (key === "oil" || key === "sauce") continue;
    const already = existingByKey.get(key);
    if (already && already !== wickedIconId) continue;
    await prisma.ingredientIconMap.upsert({
      where: { ingredientKey: key },
      create: { ingredientKey: key, wickedIconId },
      update: { wickedIconId },
    });
    upserted += 1;
  }

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        icons: icons.length,
        keysGenerated: desiredByKey.size,
        upserted,
        skippedCollision,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

