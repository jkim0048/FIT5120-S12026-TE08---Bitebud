import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";

function num(d: Prisma.Decimal | null | undefined): number | null {
  if (d == null) return null;
  return Number(d.toString());
}

export async function registerAboutRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/about/stats", async () => {
    const [populationTotals, mealPrepAssistanceByAge, populationByAge, activityAssistance] = await Promise.all([
      prisma.aboutAutismPopulationTotal.findMany({ orderBy: { year: "asc" } }),
      prisma.aboutMealPrepAssistanceByAge.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.aboutAutismPopulationByAge.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.aboutActivityAssistanceEstimate.findMany({ orderBy: { sortOrder: "asc" } }),
    ]);

    return {
      populationTotals: populationTotals.map((r) => ({
        year: r.year,
        totalThousands: Number(r.totalThousands),
      })),
      mealPrepAssistanceByAge: mealPrepAssistanceByAge.map((r) => ({
        ageGroup: r.ageGroup,
        estimate2015: num(r.estimate2015),
        estimate2018: Number(r.estimate2018),
        estimate2022: Number(r.estimate2022),
      })),
      populationByAge: populationByAge.map((r) => ({
        ageGroup: r.ageGroup,
        estimate2015: Number(r.estimate2015),
        estimate2018: Number(r.estimate2018),
        estimate2022: Number(r.estimate2022),
        isTotalRow: r.isTotalRow,
      })),
      activityAssistance: activityAssistance.map((r) => ({
        activity: r.activityLabel,
        totalEstimateThousands: Number(r.totalEstimateThousands),
      })),
    };
  });
}
