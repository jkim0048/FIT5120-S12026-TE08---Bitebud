CREATE TABLE "recipe_completions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "recipe_id" UUID NOT NULL,
  "user_id" TEXT NOT NULL,
  "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rating" INTEGER,
  "would_repeat" BOOLEAN,
  "worked" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "didnt_work" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "notes" TEXT,
  CONSTRAINT "recipe_completions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "recipe_completions_user_id_completed_at_idx" ON "recipe_completions"("user_id", "completed_at");
CREATE INDEX "recipe_completions_recipe_id_idx" ON "recipe_completions"("recipe_id");

ALTER TABLE "recipe_completions"
ADD CONSTRAINT "recipe_completions_recipe_id_fkey"
FOREIGN KEY ("recipe_id")
REFERENCES "recipes"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

