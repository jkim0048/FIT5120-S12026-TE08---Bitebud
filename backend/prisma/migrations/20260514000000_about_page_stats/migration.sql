-- About page public statistics (ABS / SDAC–style illustrative figures).

CREATE TABLE "about_autism_population_totals" (
    "year" INTEGER NOT NULL,
    "total_thousands" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "about_autism_population_totals_pkey" PRIMARY KEY ("year")
);

CREATE TABLE "about_meal_prep_assistance_by_age" (
    "age_group" TEXT NOT NULL,
    "estimate_2015" DECIMAL(12,2),
    "estimate_2018" DECIMAL(12,2) NOT NULL,
    "estimate_2022" DECIMAL(12,2) NOT NULL,
    "sort_order" INTEGER NOT NULL,
    CONSTRAINT "about_meal_prep_assistance_by_age_pkey" PRIMARY KEY ("age_group")
);

CREATE UNIQUE INDEX "about_meal_prep_assistance_by_age_sort_order_key" ON "about_meal_prep_assistance_by_age"("sort_order");

CREATE TABLE "about_autism_population_by_age" (
    "id" SERIAL NOT NULL,
    "age_group" TEXT NOT NULL,
    "estimate_2015" DECIMAL(12,2) NOT NULL,
    "estimate_2018" DECIMAL(12,2) NOT NULL,
    "estimate_2022" DECIMAL(12,2) NOT NULL,
    "is_total_row" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL,
    CONSTRAINT "about_autism_population_by_age_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "about_autism_population_by_age_sort_order_key" ON "about_autism_population_by_age"("sort_order");

CREATE TABLE "about_activity_assistance_estimates" (
    "id" SERIAL NOT NULL,
    "activity_label" TEXT NOT NULL,
    "total_estimate_thousands" DECIMAL(12,2) NOT NULL,
    "sort_order" INTEGER NOT NULL,
    CONSTRAINT "about_activity_assistance_estimates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "about_activity_assistance_estimates_sort_order_key" ON "about_activity_assistance_estimates"("sort_order");

INSERT INTO "about_autism_population_totals" ("year", "total_thousands") VALUES
  (2015, 164.00),
  (2018, 205.20),
  (2022, 290.90);

INSERT INTO "about_meal_prep_assistance_by_age" ("age_group", "estimate_2015", "estimate_2018", "estimate_2022", "sort_order") VALUES
  ('15-19', NULL, 4.14, 6.31, 0),
  ('20-24', NULL, 3.13, 3.11, 1),
  ('25-29', NULL, 1.86, 2.45, 2),
  ('30-34', NULL, 0.80, 1.11, 3),
  ('35-39', NULL, 0.39, 0.55, 4),
  ('40 and over', NULL, 1.08, 1.32, 5);

INSERT INTO "about_autism_population_by_age" ("age_group", "estimate_2015", "estimate_2018", "estimate_2022", "is_total_row", "sort_order") VALUES
  ('0-4', 6.2, 10.8, 12.8, false, 0),
  ('5-9', 41.9, 49.0, 59.0, false, 1),
  ('10-14', 39.4, 50.3, 72.0, false, 2),
  ('15-19', 26.4, 40.2, 51.4, false, 3),
  ('20-24', 20.0, 19.8, 42.5, false, 4),
  ('25-29', 11.9, 15.6, 15.6, false, 5),
  ('30-34', 5.1, 7.1, 14.4, false, 6),
  ('35-39', 2.5, 3.5, 3.5, false, 7),
  ('40 and over', 6.9, 8.4, 18.3, false, 8),
  ('Total persons', 164.0, 205.2, 290.9, true, 9);

INSERT INTO "about_activity_assistance_estimates" ("activity_label", "total_estimate_thousands", "sort_order") VALUES
  ('Self-care', 138.7, 0),
  ('Mobility', 177.3, 1),
  ('Communication', 160.6, 2),
  ('Cognitive or emotional tasks', 221.8, 3),
  ('Health care', 128.0, 4),
  ('Reading or writing tasks', 51.1, 5),
  ('Transport(a)', 56.8, 6),
  ('Household chores', 48.2, 7),
  ('Property maintenance', 48.9, 8),
  ('Meal preparation', 45.6, 9),
  ('Need assistance with at least one', 244.5, 10),
  ('Does not need any assistance(b)', 47.9, 11),
  ('Total(c)', 290.9, 12);
