import "../env.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../prisma.js";

type MealDbTimeRow = {
  mealdb_id: string;
  title?: string;
  total_time_minutes: number;
};

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function asInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  return i > 0 ? i : null;
}

async function loadMealDbTimes(): Promise<MealDbTimeRow[]> {
  // backend/src/data/mealdb.json (this file is backend/src/jobs/*)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const srcDir = path.resolve(__dirname, "..");
  const jsonPath = path.join(srcDir, "data", "mealdb.json");

  const raw = await readFile(jsonPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("mealdb.json must be an array");

  const out: MealDbTimeRow[] = [];
  for (const row of parsed) {
    if (row == null || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const mealdb_id = asString(r.mealdb_id);
    const total_time_minutes = asInt(r.total_time_minutes);
    const title = typeof r.title === "string" ? r.title.trim() : undefined;
    if (!mealdb_id || total_time_minutes == null) continue;
    out.push({ mealdb_id, total_time_minutes, title });
  }
  return out;
}

async function main(): Promise<void> {
  const rows = await loadMealDbTimes();
  const uniq = new Map<string, MealDbTimeRow>();
  for (const r of rows) uniq.set(r.mealdb_id, r);

  let matched = 0;
  let missing = 0;
  let updated = 0;
  let unchanged = 0;
  let titleMismatch = 0;

  for (const r of uniq.values()) {
    const existing = await prisma.recipe.findUnique({
      where: { mealDbId: r.mealdb_id },
      select: { id: true, title: true, totalTimeMinutes: true },
    });

    if (!existing) {
      missing += 1;
      continue;
    }
    matched += 1;

    if (r.title && existing.title.trim() && r.title.trim() !== existing.title.trim()) {
      titleMismatch += 1;
    }

    if (existing.totalTimeMinutes === r.total_time_minutes) {
      unchanged += 1;
      continue;
    }

    await prisma.recipe.update({
      where: { id: existing.id },
      data: { totalTimeMinutes: r.total_time_minutes },
    });
    updated += 1;
  }

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        rowsInFile: rows.length,
        uniqueMealDbIds: uniq.size,
        matched,
        missing,
        updated,
        unchanged,
        titleMismatch,
        note: "This job updates Recipe.totalTimeMinutes by matching Recipe.mealDbId to mealdb.json mealdb_id.",
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

