-- AddRecipeBrowseMetadata
ALTER TABLE "recipes"
  ADD COLUMN IF NOT EXISTS "image_url" TEXT,
  ADD COLUMN IF NOT EXISTS "complexity" TEXT,
  ADD COLUMN IF NOT EXISTS "heat_level" TEXT,
  ADD COLUMN IF NOT EXISTS "tags" JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS "recipes_title_idx" ON "recipes"("title");
CREATE INDEX IF NOT EXISTS "recipes_total_time_minutes_idx" ON "recipes"("total_time_minutes");
CREATE INDEX IF NOT EXISTS "recipes_complexity_idx" ON "recipes"("complexity");
CREATE INDEX IF NOT EXISTS "recipes_heat_level_idx" ON "recipes"("heat_level");
