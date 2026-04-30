-- DropSpoonacularId
DROP INDEX IF EXISTS "recipes_spoonacular_id_key";

ALTER TABLE "recipes" DROP COLUMN IF EXISTS "spoonacular_id";
