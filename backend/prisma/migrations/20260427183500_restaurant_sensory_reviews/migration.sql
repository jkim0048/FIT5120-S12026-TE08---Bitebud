CREATE TABLE "restaurant_places" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "nominatim_place_id" TEXT,
  "osm_type" TEXT,
  "osm_id" TEXT,
  "name" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "cuisine" TEXT,
  "address" TEXT,
  "suburb" TEXT,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "extratags" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "restaurant_places_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "restaurant_reviews" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "place_id" UUID NOT NULL,
  "user_id" TEXT NOT NULL,
  "overall_rating" DOUBLE PRECISION NOT NULL,
  "noise_rating" INTEGER NOT NULL,
  "music_rating" INTEGER NOT NULL,
  "light_rating" INTEGER NOT NULL,
  "crowds_rating" INTEGER NOT NULL,
  "smells_rating" INTEGER NOT NULL,
  "best_meal_blocks" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "best_times_of_day" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "best_days_of_week" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "restaurant_reviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "restaurant_favorites" (
  "place_id" UUID NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "restaurant_favorites_pkey" PRIMARY KEY ("place_id", "user_id")
);

CREATE UNIQUE INDEX "restaurant_places_nominatim_place_id_key" ON "restaurant_places"("nominatim_place_id");
CREATE INDEX "restaurant_places_name_idx" ON "restaurant_places"("name");
CREATE INDEX "restaurant_places_suburb_idx" ON "restaurant_places"("suburb");
CREATE INDEX "restaurant_reviews_place_id_idx" ON "restaurant_reviews"("place_id");
CREATE INDEX "restaurant_reviews_user_id_idx" ON "restaurant_reviews"("user_id");
CREATE INDEX "restaurant_favorites_user_id_idx" ON "restaurant_favorites"("user_id");

ALTER TABLE "restaurant_reviews"
ADD CONSTRAINT "restaurant_reviews_place_id_fkey"
FOREIGN KEY ("place_id")
REFERENCES "restaurant_places"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "restaurant_favorites"
ADD CONSTRAINT "restaurant_favorites_place_id_fkey"
FOREIGN KEY ("place_id")
REFERENCES "restaurant_places"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
