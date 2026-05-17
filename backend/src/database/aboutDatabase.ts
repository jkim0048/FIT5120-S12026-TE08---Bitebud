import { prisma } from "../prisma.js";

/** ABS autism population totals by year for the About page. */
export async function findAboutPopulationTotals() {
  return prisma.aboutAutismPopulationTotal.findMany({ orderBy: { year: "asc" } });
}

/** Meal-prep assistance estimates by age group. */
export async function findAboutMealPrepAssistanceByAge() {
  return prisma.aboutMealPrepAssistanceByAge.findMany({ orderBy: { sortOrder: "asc" } });
}

/** Autism population estimates by age group. */
export async function findAboutPopulationByAge() {
  return prisma.aboutAutismPopulationByAge.findMany({ orderBy: { sortOrder: "asc" } });
}

/** Activity assistance estimate rows for the About page charts. */
export async function findAboutActivityAssistance() {
  return prisma.aboutActivityAssistanceEstimate.findMany({ orderBy: { sortOrder: "asc" } });
}
