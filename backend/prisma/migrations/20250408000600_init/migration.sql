-- CreateTable
CREATE TABLE "recipes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "title" TEXT NOT NULL,
    "source_url" TEXT,
    "total_time_minutes" INTEGER,
    "servings" INTEGER,
    "graph" JSONB NOT NULL,
    "spoonacular_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_progress" (
    "recipe_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "completed_node_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipe_progress_pkey" PRIMARY KEY ("recipe_id","user_id")
);

-- CreateTable
CREATE TABLE "wicked_icons" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "image_url" TEXT,
    "asset" BYTEA,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wicked_icons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredient_icon_map" (
    "ingredient_key" TEXT NOT NULL,
    "wicked_icon_id" TEXT NOT NULL,
    "emoji_fallback" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingredient_icon_map_pkey" PRIMARY KEY ("ingredient_key")
);

-- CreateTable
CREATE TABLE "user_icon_overrides" (
    "user_id" UUID NOT NULL,
    "ingredient_key" TEXT NOT NULL,
    "wicked_icon_id" TEXT,
    "emoji_fallback" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_icon_overrides_pkey" PRIMARY KEY ("user_id","ingredient_key")
);

-- CreateIndex
CREATE UNIQUE INDEX "recipes_spoonacular_id_key" ON "recipes"("spoonacular_id");

-- AddForeignKey
ALTER TABLE "recipe_progress" ADD CONSTRAINT "recipe_progress_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_icon_map" ADD CONSTRAINT "ingredient_icon_map_wicked_icon_id_fkey" FOREIGN KEY ("wicked_icon_id") REFERENCES "wicked_icons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_icon_overrides" ADD CONSTRAINT "user_icon_overrides_wicked_icon_id_fkey" FOREIGN KEY ("wicked_icon_id") REFERENCES "wicked_icons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
