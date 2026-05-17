# Backend maintenance jobs

One-off and periodic scripts live under `src/jobs/`. They are **not** HTTP controllers: they call `src/database/` and `src/services/` directly. Run them from the `backend/` directory with `npm run <script>`. Scripts that need database credentials load `../.env` via `dotenv-cli`.

| npm run command | What it does |
| --- | --- |
| `npm run icons:ingest` | Ingests the Wicked food icon catalog from food.getwicked.app into `wicked_icons` (optional PNG assets via env). |
| `npm run icons:list` | Prints wicked icon id/name rows from the database for quick inspection (filter/limit via env). |
| `npm run icons:spotcheck` | Runs fixed ingredient→icon resolver test cases and reports pass/fail for matcher regressions. |
| `npm run recipes:backfill-images` | Fetches MealDB thumbnails for cached recipes missing `imageUrl` and updates the row. |
| `npm run recipes:backfill-meta` | Fills missing `complexity`, `heatLevel`, and `tags` on existing recipes from parsed graph heuristics. |
| `npm run icons:clear-poisoned-maps` | Deletes known-bad `ingredient_icon_map` rows (e.g. overly broad keys like `fillet` or `butter`). |
| `npm run recipes:wipe-mealdb-cache` | Deletes all recipes with a `mealDbId` so the next import re-fetches from MealDB. |
| `npm run recipes:backfill-mealdb-time` | Sets `totalTimeMinutes` on MealDB-linked recipes from `src/data/mealdb.json`. |
| `npm run recipes:backfill-mealdb-servings` | Updates `mealdb.json` and recipe `servings` using MealDB text, heuristics, and optional Gemini. |
| `npm run sensory:backfill` | Migrates legacy `safeFoods` / `unsafeFoods` / `sometimesFoods` JSON into `sensory_food_items` rows. |
