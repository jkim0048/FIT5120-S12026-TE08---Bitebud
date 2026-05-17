-- Epic 7: motivation profiles, daily activity, events

CREATE TABLE "motivation_profiles" (
    "user_id" TEXT NOT NULL,
    "current_streak" INTEGER NOT NULL DEFAULT 0,
    "longest_streak" INTEGER NOT NULL DEFAULT 0,
    "last_active_local_date" DATE,
    "freeze_used_week_start" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "motivation_profiles_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "motivation_daily_activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "local_date" DATE NOT NULL,
    "counts" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "motivation_daily_activities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "motivation_daily_activities_user_id_local_date_key"
    ON "motivation_daily_activities"("user_id", "local_date");

CREATE INDEX "motivation_daily_activities_user_id_idx"
    ON "motivation_daily_activities"("user_id");

CREATE TABLE "motivation_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "local_date" DATE NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "motivation_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "motivation_events_user_id_local_date_idx"
    ON "motivation_events"("user_id", "local_date");

CREATE INDEX "motivation_events_user_id_created_at_idx"
    ON "motivation_events"("user_id", "created_at");
