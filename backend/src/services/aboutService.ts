import type { Prisma } from "@prisma/client";
import {
  findAboutActivityAssistance,
  findAboutMealPrepAssistanceByAge,
  findAboutPopulationByAge,
  findAboutPopulationTotals,
} from "../database/aboutDatabase.js";

/** Coerce a Prisma `Decimal` column to a JS number, or `null` when unset. */
function num(d: Prisma.Decimal | null | undefined): number | null {
  if (d == null) return null;
  return Number(d.toString());
}

/** Load and shape About-page ABS population and assistance statistics. */
export async function getAboutStats() {
  const [populationTotals, mealPrepAssistanceByAge, populationByAge, activityAssistance] =
    await Promise.all([
      findAboutPopulationTotals(),
      findAboutMealPrepAssistanceByAge(),
      findAboutPopulationByAge(),
      findAboutActivityAssistance(),
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
}
