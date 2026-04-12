-- Align recipes with Prisma schema: raw text, refinement flag, TheMealDB id
ALTER TABLE "recipes"
  ADD COLUMN IF NOT EXISTS "raw_text" TEXT,
  ADD COLUMN IF NOT EXISTS "refined" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "mealdb_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "recipes_mealdb_id_key" ON "recipes"("mealdb_id");
