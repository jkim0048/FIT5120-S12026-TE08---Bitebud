-- CreateTable
CREATE TABLE "sensory_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "texture_prefs" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "temperature_pref" TEXT,
    "dietary_needs" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "safe_foods" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "unsafe_foods" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "sometimes_foods" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sensory_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sensory_code_attempts" (
    "code_hash" TEXT NOT NULL,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "lockout_until" TIMESTAMP(3),
    "last_failed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sensory_code_attempts_pkey" PRIMARY KEY ("code_hash")
);

-- CreateIndex
CREATE UNIQUE INDEX "sensory_profiles_user_id_key" ON "sensory_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sensory_profiles_code_hash_key" ON "sensory_profiles"("code_hash");
