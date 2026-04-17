-- Add optional LLM-generated lede/description for recipe hero.
ALTER TABLE "recipes" ADD COLUMN "lede" TEXT;

