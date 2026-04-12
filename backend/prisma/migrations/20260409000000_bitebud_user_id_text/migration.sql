-- BiteBud user id is a 3-char uppercase alphanumeric code (not UUID).
ALTER TABLE "sensory_profiles" ALTER COLUMN "user_id" SET DATA TYPE TEXT USING "user_id"::TEXT;
ALTER TABLE "recipe_progress" ALTER COLUMN "user_id" SET DATA TYPE TEXT USING "user_id"::TEXT;
ALTER TABLE "user_icon_overrides" ALTER COLUMN "user_id" SET DATA TYPE TEXT USING "user_id"::TEXT;
