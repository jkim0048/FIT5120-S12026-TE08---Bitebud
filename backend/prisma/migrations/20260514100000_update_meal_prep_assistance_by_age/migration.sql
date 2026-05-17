-- Revised meal-prep assistance estimates by age (all years populated; aligns with updated source table).
UPDATE "about_meal_prep_assistance_by_age"
SET "estimate_2015" = 4.14, "estimate_2018" = 6.31, "estimate_2022" = 8.06
WHERE "age_group" = '15-19';

UPDATE "about_meal_prep_assistance_by_age"
SET "estimate_2015" = 3.13, "estimate_2018" = 3.11, "estimate_2022" = 6.66
WHERE "age_group" = '20-24';

UPDATE "about_meal_prep_assistance_by_age"
SET "estimate_2015" = 1.86, "estimate_2018" = 2.45, "estimate_2022" = 2.45
WHERE "age_group" = '25-29';

UPDATE "about_meal_prep_assistance_by_age"
SET "estimate_2015" = 0.80, "estimate_2018" = 1.11, "estimate_2022" = 2.26
WHERE "age_group" = '30-34';

UPDATE "about_meal_prep_assistance_by_age"
SET "estimate_2015" = 0.39, "estimate_2018" = 0.55, "estimate_2022" = 0.55
WHERE "age_group" = '35-39';

UPDATE "about_meal_prep_assistance_by_age"
SET "estimate_2015" = 1.08, "estimate_2018" = 1.32, "estimate_2022" = 2.87
WHERE "age_group" = '40 and over';
