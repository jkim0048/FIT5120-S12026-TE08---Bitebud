-- Some environments had `recipe_completions` without JSON feedback columns (e.g. partial applies).
-- Insights and completion flows expect `worked` and `didnt_work`; add them idempotently.
ALTER TABLE "recipe_completions" ADD COLUMN IF NOT EXISTS "worked" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "recipe_completions" ADD COLUMN IF NOT EXISTS "didnt_work" JSONB NOT NULL DEFAULT '[]'::jsonb;
