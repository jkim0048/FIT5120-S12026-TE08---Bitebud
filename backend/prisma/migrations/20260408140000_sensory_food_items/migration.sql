-- CreateEnum
CREATE TYPE "SensoryFoodStatus" AS ENUM ('SAFE', 'UNSURE', 'UNSAFE');

-- AlterTable
ALTER TABLE "sensory_profiles" ADD COLUMN "cultural_requirements" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "sensory_food_items" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "SensoryFoodStatus" NOT NULL,
    "notes" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sensory_food_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sensory_food_items_profile_id_idx" ON "sensory_food_items"("profile_id");

-- AddForeignKey
ALTER TABLE "sensory_food_items" ADD CONSTRAINT "sensory_food_items_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "sensory_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
