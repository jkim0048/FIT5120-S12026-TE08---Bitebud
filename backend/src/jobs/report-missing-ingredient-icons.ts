import { prisma } from "../prisma.js";

type IngredientHit = {
  label: string;
  icon?: string | null;
  emoji?: string | null;
};

function normalizeSpaces(v: string): string {
  return v
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function maybeMissingIcon(n: IngredientHit): boolean {
  if (n.icon && String(n.icon).trim()) return false;
  const e = (n.emoji ?? "").trim();
  if (!e) return true;
  // We treat generic bullets as “fallback”
  return e === "•";
}

async function buildWickedIndex(): Promise<Map<string, string>> {
  const rows = await prisma.wickedIcon.findMany({ select: { id: true, name: true } });
  const idx = new Map<string, string>();
  for (const r of rows) {
    idx.set(normalizeSpaces(r.id), r.id);
    idx.set(normalizeSpaces(r.name ?? ""), r.id);
  }
  return idx;
}

async function suggestIcons(query: string): Promise<Array<{ id: string; name: string }>> {
  const q = normalizeSpaces(query);
  if (!q) return [];
  const parts = q.split(" ").filter(Boolean);
  const tokens = [q, parts.slice(0, 2).join(" "), parts.slice(-1).join(" ")]
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);

  const seen = new Set<string>();
  const out: Array<{ id: string; name: string }> = [];

  for (const t of tokens) {
    const hits = await prisma.wickedIcon.findMany({
      where: {
        OR: [
          { id: { contains: t.replace(/\s+/g, "-"), mode: "insensitive" } },
          { name: { contains: t, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true },
      take: 5,
    });
    for (const h of hits) {
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      out.push({ id: h.id, name: h.name });
      if (out.length >= 8) return out;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const wickedIdx = await buildWickedIndex();

  // Scan a recent slice of recipes to keep runtime predictable.
  const recipes = await prisma.recipe.findMany({
    select: { id: true, title: true, graph: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  const missingCounts = new Map<string, number>();
  const exampleByKey = new Map<string, string>();

  for (const r of recipes) {
    const g = r.graph as any;
    const nodes: any[] = Array.isArray(g?.nodes) ? g.nodes : [];
    for (const n of nodes) {
      if (n?.type !== "ingredient") continue;
      const hit: IngredientHit = { label: String(n.label ?? n.detail ?? ""), icon: n.icon, emoji: n.emoji };
      if (!hit.label.trim()) continue;
      if (!maybeMissingIcon(hit)) continue;

      const key = normalizeSpaces(hit.label);
      if (!key) continue;
      missingCounts.set(key, (missingCounts.get(key) ?? 0) + 1);
      if (!exampleByKey.has(key)) exampleByKey.set(key, hit.label);
    }
  }

  const ranked = [...missingCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40);

  const report: any[] = [];
  for (const [key, count] of ranked) {
    const example = exampleByKey.get(key) ?? key;
    const exact = wickedIdx.get(normalizeSpaces(key)) ?? null;
    const suggestions = exact ? [{ id: exact, name: exact.replace(/[-_]/g, " ") }] : await suggestIcons(key);
    report.push({ key, count, example, exactMatchId: exact, suggestions });
  }

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        scannedRecipes: recipes.length,
        uniqueMissingKeys: missingCounts.size,
        topMissing: report,
        note:
          "If a key is frequently missing but suggestions exist, consider adding a targeted synonym/cleaning rule (avoid generic keys like 'oil'/'sauce').",
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

