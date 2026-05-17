import "../env.js";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "../prisma.js";
import { lookupMealById, mealToRecipeText, MEALDB_MAX_INGREDIENT_SLOTS, type MealDbMeal } from "../services/themealdb.js";

type MealDbRow = {
  mealdb_id: string;
  title?: string;
  total_time_minutes?: number;
  servings?: number | null;
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

function ingredientCount(meal: MealDbMeal): number {
  let count = 0;
  for (let ingredientSlot = 1; ingredientSlot <= MEALDB_MAX_INGREDIENT_SLOTS; ingredientSlot++) {
    const ingredient = String((meal as Record<string, unknown>)[`strIngredient${ingredientSlot}`] ?? "").trim();
    if (ingredient) count += 1;
  }
  return count;
}

function inferHeuristicServings(meal: MealDbMeal): number {
  const c = ingredientCount(meal);
  if (c <= 5) return 2;
  if (c <= 9) return 4;
  if (c <= 13) return 6;
  return 8;
}

function inferRowLevelFallbackServings(row: MealDbRow): number {
  const minutes = row.total_time_minutes ?? null;
  const title = (row.title ?? "").toLowerCase();
  if (/\b(cake|pie|tart|pudding|brownie|lasagna|lasagne|casserole)\b/.test(title)) return 8;
  if (minutes != null && minutes >= 120) return 8;
  if (minutes != null && minutes >= 75) return 6;
  if (minutes != null && minutes <= 20) return 2;
  return 4;
}

function parseServingsFromText(meal: MealDbMeal): number | null {
  const title = String(meal.strMeal ?? "");
  const instructions = String(meal.strInstructions ?? "");
  const measures: string[] = [];
  for (let ingredientSlot = 1; ingredientSlot <= MEALDB_MAX_INGREDIENT_SLOTS; ingredientSlot++) {
    const measure = String((meal as Record<string, unknown>)[`strMeasure${ingredientSlot}`] ?? "").trim();
    if (measure) measures.push(measure);
  }
  const blob = `${title}\n${instructions}\n${measures.join("\n")}`.toLowerCase();
  const patterns = [
    /\bserves?\s*(\d{1,2})\b/,
    /\bserve\s*(\d{1,2})\b/,
    /\bfor\s*(\d{1,2})\s*(?:people|persons)\b/,
    /\bmakes?\s*(\d{1,2})\s*(?:servings?|portions?)\b/,
    /\byield(?:s)?\s*[:\-]?\s*(\d{1,2})\b/,
  ];
  for (const re of patterns) {
    const m = blob.match(re);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0 && n <= 16) return Math.round(n);
  }
  return null;
}

async function inferServingsWithLlm(meal: MealDbMeal): Promise<number | null> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json" },
  });
  const recipe = mealToRecipeText(meal);
  const prompt = `Estimate servings for this recipe.
Return strict JSON only: {"servings": number|null}
Rules:
- integer 1..16
- null if not confidently inferable

Recipe:
${recipe.text}`;
  try {
    const out = await model.generateContent(prompt);
    const parsed = JSON.parse(out.response.text()) as { servings?: unknown };
    const n = asInt(parsed?.servings);
    if (n == null) return null;
    return Math.max(1, Math.min(16, n));
  } catch {
    return null;
  }
}

async function loadRows(jsonPath: string): Promise<MealDbRow[]> {
  const raw = await readFile(jsonPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("mealdb.json must be an array");
  const out: MealDbRow[] = [];
  for (const row of parsed) {
    if (row == null || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const mealdb_id = asString(r.mealdb_id);
    if (!mealdb_id) continue;
    out.push({
      mealdb_id,
      title: asString(r.title) ?? undefined,
      total_time_minutes: asInt(r.total_time_minutes) ?? undefined,
      servings: asInt(r.servings),
    });
  }
  return out;
}

function sortRows(rows: MealDbRow[]): MealDbRow[] {
  return [...rows].sort((a, b) => a.mealdb_id.localeCompare(b.mealdb_id, "en", { numeric: true }));
}

async function updateRecipeTable(rows: MealDbRow[]): Promise<{ matched: number; updated: number }> {
  let matched = 0;
  let updated = 0;
  for (const row of rows) {
    if (row.servings == null) continue;
    const existing = await prisma.recipe.findUnique({
      where: { mealDbId: row.mealdb_id },
      select: { id: true, servings: true, graph: true },
    });
    if (!existing) continue;
    matched += 1;
    if (existing.servings != null && existing.servings > 0) continue;
    const graph = {
      ...(existing.graph as unknown as Record<string, unknown>),
      servings: row.servings,
    };
    await prisma.recipe.update({
      where: { id: existing.id },
      data: { servings: row.servings, graph: graph as object },
    });
    updated += 1;
  }
  return { matched, updated };
}

async function main(): Promise<void> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const srcDir = path.resolve(__dirname, "..");
  const jsonPath = path.join(srcDir, "data", "mealdb.json");
  const rows = await loadRows(jsonPath);

  let apiParsed = 0;
  let llmGenerated = 0;
  let heuristicGenerated = 0;
  let lookupFailed = 0;
  let rowFallbackGenerated = 0;

  for (const row of rows) {
    if (row.servings != null && row.servings > 0) continue;
    try {
      const meal = await lookupMealById(row.mealdb_id);
      const parsed = parseServingsFromText(meal);
      if (parsed != null) {
        row.servings = parsed;
        apiParsed += 1;
        continue;
      }
      const llm = await inferServingsWithLlm(meal);
      if (llm != null) {
        row.servings = llm;
        llmGenerated += 1;
        continue;
      }
      row.servings = inferHeuristicServings(meal);
      heuristicGenerated += 1;
    } catch {
      lookupFailed += 1;
      // Network/API misses should still not leave null servings.
      row.servings = inferRowLevelFallbackServings(row);
      rowFallbackGenerated += 1;
    }
  }

  // Safety net: ensure there are no nulls left even if a row slipped through.
  for (const row of rows) {
    if (row.servings != null && row.servings > 0) continue;
    row.servings = inferRowLevelFallbackServings(row);
    rowFallbackGenerated += 1;
  }

  const next = sortRows(rows);
  await writeFile(jsonPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  const db = await updateRecipeTable(next);

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        rows: rows.length,
        apiParsed,
        llmGenerated,
        heuristicGenerated,
        lookupFailed,
        rowFallbackGenerated,
        dbMatched: db.matched,
        dbUpdated: db.updated,
        note: "mealdb.json servings updated and Recipe.servings backfilled by mealDbId.",
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
