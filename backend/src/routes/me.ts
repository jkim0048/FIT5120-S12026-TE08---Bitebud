import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { parseBiteBudUserId } from "../biteBudUserId.js";
import { parseRecipeGraph, type RecipeGraph, type RecipeNode } from "../graph/recipeGraph.js";
import { inferFlavorProfile } from "../services/flavorProfile.js";

function isoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseIsoDateOnly(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(da)) return null;
  const d = new Date(Date.UTC(y, mo - 1, da, 0, 0, 0, 0));
  // Validate the date parts survived (e.g. 2026-02-31 should be rejected).
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== da) return null;
  return d;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function startOfIsoWeek(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const day = out.getDay(); // 0 Sun ... 6 Sat
  const diff = (day + 6) % 7; // Mon=0 ... Sun=6
  out.setDate(out.getDate() - diff);
  return out;
}

function timeOfDayBucket(d: Date): "morning" | "midday" | "evening" | "night" {
  const h = d.getHours();
  if (h >= 5 && h < 11) return "morning";
  if (h >= 11 && h < 16) return "midday";
  if (h >= 16 && h < 22) return "evening";
  return "night";
}

function normalizeIngredientLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function ingredientNodes(graph: RecipeGraph): RecipeNode[] {
  return (graph.nodes ?? []).filter((n) => n.type === "ingredient");
}

function methodKeysFromGraph(graph: RecipeGraph): Set<string> {
  const methods = new Set<string>();
  const patterns: Array<[string, RegExp]> = [
    ["bake", /\bbake\b/],
    ["roast", /\broast\b/],
    ["fry", /\bfry\b/],
    ["pan", /\bpan\b/],
    ["stovetop", /\bstove(?:top)?\b/],
    ["grill", /\bgrill\b/],
    ["steam", /\bsteam\b/],
    ["boil", /\bboil\b/],
  ];
  for (const n of graph.nodes ?? []) {
    const t = `${n.label ?? ""} ${n.detail ?? ""}`.toLowerCase();
    for (const [key, re] of patterns) {
      if (re.test(t)) methods.add(key);
    }
  }
  return methods;
}

function ordinalThisWeek(n: number): string {
  if (n === 1) return "first";
  if (n === 2) return "second";
  if (n === 3) return "third";
  return `${n}th`;
}

type InsightCard = {
  id: string;
  category: string;
  headline: string;
  detail: string;
  recordCount: number;
};

function clampTopN<T>(arr: T[], n: number): T[] {
  return arr.slice(0, Math.max(0, n));
}

function countTopN(map: Map<string, number>, n: number): Array<{ key: string; count: number }> {
  return clampTopN(
    Array.from(map.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count),
    n,
  );
}

function pearson(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return 0;
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const vx = xs[i] - mx;
    const vy = ys[i] - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  const den = Math.sqrt(dx) * Math.sqrt(dy);
  if (!Number.isFinite(den) || den === 0) return 0;
  return num / den;
}

export async function registerMeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/me/activity", async (request, reply) => {
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) return reply.status(400).send({ error: "Missing or invalid X-User-Id" });

    const daysRows = await prisma.$queryRaw<
      Array<{ day: string }>
    >`SELECT DISTINCT day::text AS day FROM (
        SELECT date_trunc('day', completed_at)::date AS day
        FROM recipe_completions
        WHERE user_id = ${userId} AND completed_at >= NOW() - INTERVAL '7 days'
        UNION
        SELECT date_trunc('day', created_at)::date AS day
        FROM restaurant_reviews
        WHERE user_id = ${userId} AND created_at >= NOW() - INTERVAL '7 days'
      ) days`;

    const totalsRows = await prisma.$queryRaw<
      Array<{ completions_30: bigint; reviews_30: bigint; completions_ever: bigint; reviews_ever: bigint }>
    >`SELECT
        (SELECT COUNT(*) FROM recipe_completions WHERE user_id = ${userId} AND completed_at >= NOW() - INTERVAL '30 days') AS completions_30,
        (SELECT COUNT(*) FROM restaurant_reviews WHERE user_id = ${userId} AND created_at >= NOW() - INTERVAL '30 days') AS reviews_30,
        (SELECT COUNT(*) FROM recipe_completions WHERE user_id = ${userId}) AS completions_ever,
        (SELECT COUNT(*) FROM restaurant_reviews WHERE user_id = ${userId}) AS reviews_ever`;

    const totals = totalsRows[0] ?? {
      completions_30: 0n,
      reviews_30: 0n,
      completions_ever: 0n,
      reviews_ever: 0n,
    };

    const daysThisWeek = (daysRows ?? []).length;
    const activitiesThisMonth = Number(totals.completions_30) + Number(totals.reviews_30);
    const hasAny = Number(totals.completions_ever) + Number(totals.reviews_ever) > 0;

    return reply.send({ daysThisWeek, activitiesThisMonth, hasAny });
  });

  app.get("/api/me/insights", async (request, reply) => {
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) return reply.status(400).send({ error: "Missing or invalid X-User-Id" });

    const query = z
      .object({
        dismissed: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse((request.query as Record<string, unknown>) ?? {});

    const today = new Date();
    const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0));
    const defaultFrom = addDays(todayUtc, -89); // inclusive range = 90 days
    const parsedFrom = query.from ? parseIsoDateOnly(query.from) : null;
    const parsedTo = query.to ? parseIsoDateOnly(query.to) : null;
    const rangeFrom = parsedFrom ?? defaultFrom;
    const rangeTo = parsedTo ?? todayUtc;
    if (!rangeFrom || !rangeTo) {
      return reply.status(400).send({ error: "Invalid from/to date" });
    }
    if (rangeFrom.getTime() > rangeTo.getTime()) {
      return reply.status(400).send({ error: "From date cannot be after To date" });
    }
    if (rangeTo.getTime() > todayUtc.getTime()) {
      return reply.status(400).send({ error: "To date cannot be in the future" });
    }

    const rangeFromInclusive = rangeFrom;
    const rangeToExclusive = addDays(rangeTo, 1);

    const dismissedIds = query.dismissed;
    const dismissed = new Set(
      (dismissedIds ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );

    const ratedCompletionsCount = await prisma.recipeCompletion.count({
      where: {
        userId,
        rating: { not: null },
        completedAt: { gte: rangeFromInclusive, lt: rangeToExclusive },
      },
    });
    const reviewsCount = await prisma.restaurantReview.count({
      where: { userId, createdAt: { gte: rangeFromInclusive, lt: rangeToExclusive } },
    });
    const completionsCount = await prisma.recipeCompletion.count({
      where: { userId, completedAt: { gte: rangeFromInclusive, lt: rangeToExclusive } },
    });
    const totalActivities = completionsCount + reviewsCount;

    const thresholds = {
      cooking: { have: ratedCompletionsCount, need: 3 },
      dining: { have: reviewsCount, need: 2 },
      progress: { have: totalActivities, need: 3 },
    };

    const progressEnabled = thresholds.progress.have >= thresholds.progress.need;
    const cookingEnabled = thresholds.cooking.have >= thresholds.cooking.need;
    const diningEnabled = thresholds.dining.have >= thresholds.dining.need;

    const twelveWeeksAgo = new Date(Date.now() - 7 * 12 * 24 * 60 * 60 * 1000);
    const weeklyFrom = rangeFromInclusive.getTime() > twelveWeeksAgo.getTime() ? rangeFromInclusive : twelveWeeksAgo;

    const progress = {
      calendar: [] as Array<{ date: string; recipes: number; dining: number }>,
      weeklyBars: [] as Array<{ weekStart: string; recipes: number; dining: number }>,
      typeBreakdown: { recipes: 0, dining: 0 },
    };

    if (progressEnabled) {
      const calendarRows = await prisma.$queryRaw<
        Array<{ day: Date; recipes: bigint; dining: bigint }>
      >`SELECT day,
          SUM(recipes_count)::bigint AS recipes,
          SUM(dining_count)::bigint AS dining
        FROM (
          SELECT date_trunc('day', completed_at)::date AS day, COUNT(*)::bigint AS recipes_count, 0::bigint AS dining_count
          FROM recipe_completions
          WHERE user_id = ${userId} AND completed_at >= ${rangeFromInclusive} AND completed_at < ${rangeToExclusive}
          GROUP BY 1
          UNION ALL
          SELECT date_trunc('day', created_at)::date AS day, 0::bigint AS recipes_count, COUNT(*)::bigint AS dining_count
          FROM restaurant_reviews
          WHERE user_id = ${userId} AND created_at >= ${rangeFromInclusive} AND created_at < ${rangeToExclusive}
          GROUP BY 1
        ) x
        GROUP BY day
        ORDER BY day ASC`;

      progress.calendar = (calendarRows ?? []).map((r) => ({
        date: isoDateOnly(new Date(r.day)),
        recipes: Number(r.recipes),
        dining: Number(r.dining),
      }));

      const weeklyRows = await prisma.$queryRaw<
        Array<{ week_start: Date; recipes: bigint; dining: bigint }>
      >`SELECT week_start,
          SUM(recipes_count)::bigint AS recipes,
          SUM(dining_count)::bigint AS dining
        FROM (
          SELECT date_trunc('week', completed_at)::date AS week_start, COUNT(*)::bigint AS recipes_count, 0::bigint AS dining_count
          FROM recipe_completions
          WHERE user_id = ${userId} AND completed_at >= ${weeklyFrom} AND completed_at < ${rangeToExclusive}
          GROUP BY 1
          UNION ALL
          SELECT date_trunc('week', created_at)::date AS week_start, 0::bigint AS recipes_count, COUNT(*)::bigint AS dining_count
          FROM restaurant_reviews
          WHERE user_id = ${userId} AND created_at >= ${weeklyFrom} AND created_at < ${rangeToExclusive}
          GROUP BY 1
        ) x
        GROUP BY week_start
        ORDER BY week_start ASC`;

      progress.weeklyBars = (weeklyRows ?? []).map((r) => ({
        weekStart: isoDateOnly(startOfIsoWeek(new Date(r.week_start))),
        recipes: Number(r.recipes),
        dining: Number(r.dining),
      }));

      const breakdownRows = await prisma.$queryRaw<
        Array<{ recipes: bigint; dining: bigint }>
      >`SELECT
          (SELECT COUNT(*) FROM recipe_completions WHERE user_id = ${userId} AND completed_at >= ${rangeFromInclusive} AND completed_at < ${rangeToExclusive}) AS recipes,
          (SELECT COUNT(*) FROM restaurant_reviews WHERE user_id = ${userId} AND created_at >= ${rangeFromInclusive} AND created_at < ${rangeToExclusive}) AS dining`;
      const br = breakdownRows[0] ?? { recipes: 0n, dining: 0n };
      progress.typeBreakdown = { recipes: Number(br.recipes), dining: Number(br.dining) };
    }

    const cooking = { works: [] as InsightCard[], doesntWork: [] as InsightCard[] };
    if (cookingEnabled) {
      const comps = await prisma.recipeCompletion.findMany({
        where: {
          userId,
          rating: { not: null },
          completedAt: { gte: rangeFromInclusive, lt: rangeToExclusive },
        },
        orderBy: { completedAt: "desc" },
        take: 250,
        select: {
          id: true,
          rating: true,
          completedAt: true,
          worked: true,
          didntWork: true,
          recipe: { select: { id: true, totalTimeMinutes: true, graph: true } },
        },
      });

      const hi = comps.filter((c) => (c.rating ?? 0) >= 4);
      const lo = comps.filter((c) => (c.rating ?? 0) <= 3);

      const cardsWorks: InsightCard[] = [];
      const cardsDoesnt: InsightCard[] = [];

      if (hi.length >= 3) {
        let le6 = 0;
        for (const c of hi) {
          const g = parseRecipeGraph(c.recipe.graph);
          if (ingredientNodes(g).length <= 6) le6++;
        }
        if (le6 / hi.length >= 0.6) {
          cardsWorks.push({
            id: "cooking.ingredient-count.le6",
            category: "ingredient-count",
            headline: "You finish recipes with 6 or fewer ingredients.",
            detail: `Drawn from your higher-rated recipe completions (n=${hi.length}).`,
            recordCount: hi.length,
          });
        }

        const times = hi.map((c) => c.recipe.totalTimeMinutes ?? null).filter((n): n is number => typeof n === "number");
        if (times.length >= 3) {
          const avg = times.reduce((a, b) => a + b, 0) / times.length;
          if (avg <= 30) {
            cardsWorks.push({
              id: "cooking.prep-time.le30",
              category: "prep-time",
              headline: "You tend to finish recipes that take 30 minutes or less.",
              detail: `Based on average total time across higher-rated recipe completions (n=${times.length}).`,
              recordCount: times.length,
            });
          }
        }

        const workedTagCounts = new Map<string, number>();
        for (const c of comps) {
          const tags = Array.isArray(c.worked) ? (c.worked as unknown[]) : [];
          for (const t of tags) {
            if (typeof t !== "string") continue;
            workedTagCounts.set(t, (workedTagCounts.get(t) ?? 0) + 1);
          }
        }
        for (const t of countTopN(workedTagCounts, 3)) {
          if (t.count < 3) continue;
          cardsWorks.push({
            id: `cooking.worked-tag.${t.key}`,
            category: "worked-tag",
            headline: `“${t.key}” comes up often in what worked for you.`,
            detail: `You’ve tagged this as working ${t.count} times in your recipe completions.`,
            recordCount: t.count,
          });
        }

        const ingredientCounts = new Map<string, number>();
        for (const c of hi) {
          const g = parseRecipeGraph(c.recipe.graph);
          for (const ing of ingredientNodes(g)) {
            const k = normalizeIngredientLabel(ing.label);
            if (!k) continue;
            ingredientCounts.set(k, (ingredientCounts.get(k) ?? 0) + 1);
          }
        }
        for (const top of countTopN(ingredientCounts, 3)) {
          cardsWorks.push({
            id: `cooking.ingredient-affinity.${top.key}`,
            category: "ingredient-affinity",
            headline: `“${top.key}” shows up often in recipes you rate highly.`,
            detail: `Counted across your higher-rated recipe completions.`,
            recordCount: top.count,
          });
        }

        const todCounts = new Map<string, number>();
        for (const c of comps) {
          const key = `${new Date(c.completedAt).getDay()}|${timeOfDayBucket(new Date(c.completedAt))}`;
          todCounts.set(key, (todCounts.get(key) ?? 0) + 1);
        }
        const topBucket = countTopN(todCounts, 1)[0];
        if (topBucket && topBucket.count / comps.length >= 0.4) {
          const [dayIdxStr, bucket] = topBucket.key.split("|");
          const dayIdx = Number(dayIdxStr);
          const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
          cardsWorks.push({
            id: `cooking.time-cluster.${dayIdx}.${bucket}`,
            category: "time-of-week",
            headline: `Many of your recipe completions land on ${days[dayIdx]} ${bucket}.`,
            detail: `This pattern appears in ${topBucket.count} of your recipe completions.`,
            recordCount: topBucket.count,
          });
        }

        // Flavor dominance in higher-rated completions (≥50%).
        const flavorSigCounts = new Map<string, number>();
        for (const c of hi) {
          const g = parseRecipeGraph(c.recipe.graph);
          const ings = ingredientNodes(g)
            .map((n) => ({ id: n.id, label: n.label, detail: n.detail }))
            .filter((x) => x.id && x.label);
          const inferred = await inferFlavorProfile(ings);
          const flavorCounts = Object.entries(inferred)
            .map(([k, ids]) => ({ k, n: Array.isArray(ids) ? ids.length : 0 }))
            .sort((a, b) => b.n - a.n);
          const top1 = flavorCounts[0]?.n ? flavorCounts[0] : null;
          const top2 = flavorCounts[1]?.n ? flavorCounts[1] : null;
          const sig = top1
            ? top2 && top2.n >= top1.n * 0.8
              ? `${top1.k}+${top2.k}`
              : `${top1.k}`
            : "";
          if (!sig) continue;
          flavorSigCounts.set(sig, (flavorSigCounts.get(sig) ?? 0) + 1);
        }
        const topFlavor = countTopN(flavorSigCounts, 1)[0];
        if (topFlavor && topFlavor.count / hi.length >= 0.5) {
          cardsWorks.push({
            id: `cooking.flavour.${topFlavor.key}`,
            category: "flavour",
            headline: `Certain flavour profiles show up often in recipes you rate highly.`,
            detail: `“${topFlavor.key}” appears in ${topFlavor.count} of your higher-rated completions.`,
            recordCount: topFlavor.count,
          });
        }

        // Method preference by rating distribution.
        const methodHi = new Map<string, number>();
        const methodLo = new Map<string, number>();
        for (const c of comps) {
          const g = parseRecipeGraph(c.recipe.graph);
          const methods = methodKeysFromGraph(g);
          for (const m of methods) {
            if ((c.rating ?? 0) >= 4) methodHi.set(m, (methodHi.get(m) ?? 0) + 1);
            if ((c.rating ?? 0) <= 3) methodLo.set(m, (methodLo.get(m) ?? 0) + 1);
          }
        }
        const topHiMethod = countTopN(methodHi, 1)[0];
        if (topHiMethod && topHiMethod.count >= 3) {
          cardsWorks.push({
            id: `cooking.method.${topHiMethod.key}.works`,
            category: "cooking-method",
            headline: `Recipes involving “${topHiMethod.key}” show up often in your higher ratings.`,
            detail: `Based on tags inferred from your recipe steps.`,
            recordCount: topHiMethod.count,
          });
        }
      }

      if (lo.length >= 3) {
        let ge10 = 0;
        for (const c of lo) {
          const g = parseRecipeGraph(c.recipe.graph);
          if (ingredientNodes(g).length >= 10) ge10++;
        }
        if (ge10 / lo.length >= 0.6) {
          cardsDoesnt.push({
            id: "cooking.ingredient-count.ge10",
            category: "ingredient-count",
            headline: "Recipes with 10 or more ingredients often rate lower for you.",
            detail: `Drawn from your lower-rated recipe completions (n=${lo.length}).`,
            recordCount: lo.length,
          });
        }

        const times = lo.map((c) => c.recipe.totalTimeMinutes ?? null).filter((n): n is number => typeof n === "number");
        if (times.length >= 3) {
          const avg = times.reduce((a, b) => a + b, 0) / times.length;
          if (avg >= 60) {
            cardsDoesnt.push({
              id: "cooking.prep-time.ge60",
              category: "prep-time",
              headline: "Longer recipes often rate lower for you.",
              detail: `Based on average total time across lower-rated recipe completions (n=${times.length}).`,
              recordCount: times.length,
            });
          }
        }

        const didntWorkTagCounts = new Map<string, number>();
        for (const c of comps) {
          const tags = Array.isArray(c.didntWork) ? (c.didntWork as unknown[]) : [];
          for (const t of tags) {
            if (typeof t !== "string") continue;
            didntWorkTagCounts.set(t, (didntWorkTagCounts.get(t) ?? 0) + 1);
          }
        }
        for (const t of countTopN(didntWorkTagCounts, 3)) {
          if (t.count < 3) continue;
          cardsDoesnt.push({
            id: `cooking.didnt-work-tag.${t.key}`,
            category: "didnt-work-tag",
            headline: `“${t.key}” comes up often in what didn’t work for you.`,
            detail: `You’ve tagged this ${t.count} times in your recipe completions.`,
            recordCount: t.count,
          });
        }

        const ingredientCounts = new Map<string, number>();
        for (const c of lo) {
          const g = parseRecipeGraph(c.recipe.graph);
          for (const ing of ingredientNodes(g)) {
            const k = normalizeIngredientLabel(ing.label);
            if (!k) continue;
            ingredientCounts.set(k, (ingredientCounts.get(k) ?? 0) + 1);
          }
        }
        for (const top of countTopN(ingredientCounts, 3)) {
          cardsDoesnt.push({
            id: `cooking.ingredient-avoid.${top.key}`,
            category: "ingredient-affinity",
            headline: `“${top.key}” shows up often in recipes you rate lower.`,
            detail: `Counted across your lower-rated recipe completions.`,
            recordCount: top.count,
          });
        }
      }

      const filterDismissed = (arr: InsightCard[]) => arr.filter((c) => !dismissed.has(c.id));
      cooking.works = clampTopN(filterDismissed(cardsWorks), 3);
      cooking.doesntWork = clampTopN(filterDismissed(cardsDoesnt), 3);
    }

    const dining = { works: [] as InsightCard[] };
    if (diningEnabled) {
      const rows = await prisma.restaurantReview.findMany({
        where: { userId, createdAt: { gte: rangeFromInclusive, lt: rangeToExclusive } },
        orderBy: { createdAt: "desc" },
        take: 250,
        include: { place: true },
      });

      const works: InsightCard[] = [];

      // Sensory match: dimensions where lower values correlate with higher overall ratings.
      const dims: Array<{ key: "noise" | "music" | "light" | "crowds" | "smells"; label: string }> = [
        { key: "noise", label: "noise" },
        { key: "music", label: "music" },
        { key: "light", label: "light" },
        { key: "crowds", label: "crowds" },
        { key: "smells", label: "smells" },
      ];
      const overall = rows.map((r) => Number(r.overallRating));
      const sensoryScores = dims
        .map((d) => {
          const vals = rows.map((r) => 5 - Number((r as any)[`${d.key}Rating`] ?? 0));
          return { key: d.key, label: d.label, corr: pearson(vals, overall), n: vals.length };
        })
        .filter((x) => x.n >= 3)
        .sort((a, b) => b.corr - a.corr);
      for (const s of sensoryScores.slice(0, 2)) {
        if (s.corr < 0.35) continue;
        works.push({
          id: `dining.sensory.${s.key}`,
          category: "sensory-match",
          headline: `You tend to rate places higher when ${s.label} is lower.`,
          detail: `This card is based on patterns across your restaurant reviews.`,
          recordCount: rows.length,
        });
      }

      // Cuisine: favourites or repeated higher ratings.
      const cuisineCounts = new Map<string, number>();
      for (const r of rows) {
        const cuisine = (r.place.cuisine ?? "").trim();
        if (!cuisine) continue;
        if (Number(r.overallRating) >= 4) {
          cuisineCounts.set(cuisine, (cuisineCounts.get(cuisine) ?? 0) + 1);
        }
      }
      const topCuisine = countTopN(cuisineCounts, 1)[0];
      if (topCuisine && topCuisine.count >= 2) {
        works.push({
          id: `dining.cuisine.${topCuisine.key}`,
          category: "cuisine",
          headline: `You often rate ${topCuisine.key} places highly.`,
          detail: `Based on ${topCuisine.count} reviews with higher overall ratings.`,
          recordCount: topCuisine.count,
        });
      }

      // Best windows: aggregate bestTimesOfDay.
      const timeCounts = new Map<string, number>();
      for (const r of rows) {
        const arr = Array.isArray(r.bestTimesOfDay) ? (r.bestTimesOfDay as unknown[]) : [];
        for (const t of arr) {
          if (typeof t !== "string") continue;
          const key = t.trim();
          if (!key) continue;
          timeCounts.set(key, (timeCounts.get(key) ?? 0) + 1);
        }
      }
      const topTimes = countTopN(timeCounts, 2).filter((t) => t.count >= 2);
      if (topTimes.length) {
        const label = topTimes.map((t) => t.key).join(" and ");
        const n = topTimes.reduce((a, b) => a + b.count, 0);
        works.push({
          id: `dining.best-windows.${topTimes.map((t) => t.key).join("+")}`,
          category: "best-windows",
          headline: `You often choose ${label} as a good time to go.`,
          detail: `Based on what you’ve picked in your reviews.`,
          recordCount: n,
        });
      }

      dining.works = clampTopN(works.filter((c) => !dismissed.has(c.id)), 3);
    }

    return reply.send({
      range: { from: isoDateOnly(rangeFromInclusive), to: isoDateOnly(rangeTo) },
      progress,
      cooking,
      dining,
      thresholds,
    });
  });
}

