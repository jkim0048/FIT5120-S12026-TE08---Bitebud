import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { prisma } from "../prisma.js";
import {
  parseRecipeGraph,
  type RecipeGraph,
} from "../graph/recipeGraph.js";
import { isGeminiBusyError, parseRecipeTextToGraph } from "../services/gemini.js";
import {
  browseMealsOrdered,
  enrichGraphWithMealDbImages,
  lookupMealById,
  mealIngredientLines,
  mealSearchHitFields,
  mealToRecipeText,
  searchMealsOrdered,
} from "../services/themealdb.js";
import { applyIconMappings } from "../services/icons.js";
import { basicRecipeTextToGraph } from "../services/basicRecipeParser.js";
import { parseRecipeTextToGraphViaOpenRouter } from "../services/openrouter.js";
import {
  computeSensoryConflicts,
  computeSensoryConflictsFromIngredientLines,
  computeTextureConflictsFromIngredientLines,
  decodeUnsafeTexturePrefs,
  matchStatusFromConflicts,
  profileWarningsFromConflicts,
} from "../services/sensoryMatch.js";
import { resolveVisualiseInput } from "../services/recipeUrlFetch.js";
import { deriveRecipeMetadata, type RecipeMetadata } from "../services/recipeMetadata.js";
import { generateRecipeLedeResilient } from "../services/recipeLede.js";
import { parseBiteBudUserId } from "../biteBudUserId.js";

function jsonStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

let _mealDbMinutes: Map<string, number> | null = null;
async function getMealDbMinutes(): Promise<Map<string, number>> {
  if (_mealDbMinutes) return _mealDbMinutes;
  const jsonUrl = new URL("../data/mealdb.json", import.meta.url);
  const raw = await readFile(jsonUrl, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("mealdb.json must be an array");
  const map = new Map<string, number>();
  for (const row of parsed) {
    if (row == null || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.mealdb_id === "string" ? r.mealdb_id.trim() : "";
    const n = typeof r.total_time_minutes === "number" ? r.total_time_minutes : Number(r.total_time_minutes);
    if (!id) continue;
    if (!Number.isFinite(n)) continue;
    const mins = Math.round(n);
    if (mins <= 0) continue;
    map.set(id, mins);
  }
  _mealDbMinutes = map;
  return map;
}

function graphIngredientLines(graph: RecipeGraph): string[] {
  return (graph.nodes ?? [])
    .filter((n) => n.type === "ingredient")
    .map((n) => `${n.label ?? ""} ${n.detail ?? ""}`.trim())
    .filter(Boolean);
}

const visualiseBody = z.object({
  text: z.string().min(1),
  sourceUrl: z.string().optional().nullable(),
});

const importBody = z.object({
  mealDbId: z.string().min(1),
});

const browseQuery = z.object({
  q: z.string().optional(),
  filter: z.enum(["safeDishes", "showAll"]).optional().default("safeDishes"),
  maxMinutes: z.coerce.number().int().positive().optional(),
  complexity: z.string().optional(),
  heatLevel: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(24),
  skip: z.coerce.number().int().min(0).optional().default(0),
  sort: z.enum(["recommended", "newest"]).optional().default("newest"),
});

const progressBody = z.object({
  completedNodeIds: z.array(z.string()),
});

async function persistGraph(
  graph: RecipeGraph,
  opts: {
    mealDbId?: string | null;
    rawText?: string | null;
    refined?: boolean;
    metadata?: RecipeMetadata;
    lede?: string | null;
  } = {},
): Promise<{ recipeId: string; graph: RecipeGraph }> {
  const derived = deriveRecipeMetadata(graph);
  const metadata = opts.metadata ?? {};
  const recipe = await prisma.recipe.create({
    data: {
      title: graph.title,
      lede: opts.lede ?? null,
      imageUrl: metadata.imageUrl ?? null,
      sourceUrl: graph.sourceUrl ?? null,
      totalTimeMinutes: graph.totalTimeMinutes ?? null,
      complexity: metadata.complexity ?? derived.complexity ?? null,
      heatLevel: metadata.heatLevel ?? derived.heatLevel ?? null,
      tags: (metadata.tags ?? derived.tags ?? []) as unknown as object,
      servings: graph.servings ?? null,
      graph: graph as object,
      mealDbId: opts.mealDbId ?? null,
      rawText: opts.rawText ?? null,
      refined: opts.refined ?? true,
    } as any,
  });
  const fullGraph: RecipeGraph = { ...graph, id: recipe.id };
  await prisma.recipe.update({
    where: { id: recipe.id },
    data: { graph: fullGraph as object },
  });
  return { recipeId: recipe.id, graph: fullGraph };
}

async function withIcons(
  graph: RecipeGraph,
  userId: string | null,
): Promise<RecipeGraph> {
  return applyIconMappings(graph, userId);
}

async function linkRecipeToUser(recipeId: string, userId: string | null): Promise<void> {
  if (!userId) return;
  await prisma.recipeProgress.upsert({
    where: {
      recipeId_userId: { recipeId, userId },
    },
    create: {
      recipeId,
      userId,
      completedNodeIds: [],
    },
    update: {},
  });
}

async function parseRecipeTextToGraphResilient(
  text: string,
  sourceUrl?: string | null,
): Promise<{ graph: RecipeGraph; refined: boolean; parserSource: "gemini" | "openrouter" | "basic" }> {
  try {
    const graph = await parseRecipeTextToGraph(text, sourceUrl);
    return { graph, refined: true, parserSource: "gemini" };
  } catch (e) {
    if (!isGeminiBusyError(e)) throw e;
    // If OpenRouter is configured, try it before falling back to basic parsing.
    if (process.env.OPENROUTER_API_KEY?.trim()) {
      try {
        const graph = await parseRecipeTextToGraphViaOpenRouter(text, sourceUrl);
        return { graph, refined: true, parserSource: "openrouter" };
      } catch {
        // fall through to local basic parsing
      }
    }
    const graph = basicRecipeTextToGraph({ text, sourceUrl: sourceUrl ?? null });
    return { graph, refined: false, parserSource: "basic" };
  }
}

export async function registerRecipeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/recipes/browse", async (request, reply) => {
    const q = browseQuery.parse((request.query as Record<string, string>) ?? {});
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    const where: Record<string, unknown> = {};
    const text = q.q?.trim();
    if (text) {
      where.title = { contains: text, mode: "insensitive" };
    }
    if (q.maxMinutes != null) {
      where.totalTimeMinutes = { lte: q.maxMinutes };
    }
    if (q.complexity && q.complexity !== "any") {
      where.complexity = q.complexity;
    }
    if (q.heatLevel && q.heatLevel !== "any") {
      where.heatLevel = q.heatLevel;
    }
    if (userId) {
      where.progress = { some: { userId } };
    } else {
      // For You is user-specific; without user ID we return empty.
      where.id = "__none__";
    }

    const orderBy =
      q.sort === "newest" ? ({ createdAt: "desc" } as const) : ({ updatedAt: "desc" } as const);
    const recipes = await prisma.recipe.findMany({
      where,
      orderBy,
      skip: q.skip,
      take: q.limit,
    });

    let profileFoods: Array<{ name: string; status: "SAFE" | "UNSURE" | "UNSAFE" }> = [];
    let dietaryNeeds: string[] = [];
    let culturalRequirements: string[] = [];
    let hasSensoryProfile = false;
    if (userId) {
      const profile = await prisma.sensoryProfile.findUnique({
        where: { userId },
        include: { foodItems: true },
      });
      if (profile) {
        hasSensoryProfile = true;
        profileFoods = profile.foodItems.map((f) => ({
          name: f.name,
          status: f.status as "SAFE" | "UNSURE" | "UNSAFE",
        }));
        dietaryNeeds = jsonStringArray(profile.dietaryNeeds);
        culturalRequirements = jsonStringArray(profile.culturalRequirements);
      }
    }

    const cards = recipes.map((r) => {
      const graph = parseRecipeGraph(r.graph);
      const md = deriveRecipeMetadata(graph);
      const effectiveTags = (Array.isArray(r.tags) ? r.tags : md.tags ?? []).filter((x): x is string => typeof x === "string");
      let matchStatus: "safe" | "sometimes" | "unsafe" = "safe";
      let profileWarnings: string[] = [];
      let hasDietaryConflict = false;
      let hasSensoryConflict = false;
      if (hasSensoryProfile) {
        const { sensory, dietary } = computeSensoryConflicts(graph, profileFoods, dietaryNeeds, culturalRequirements);
        matchStatus = matchStatusFromConflicts(sensory, dietary);
        profileWarnings = profileWarningsFromConflicts(sensory, dietary);
        hasDietaryConflict = dietary.length > 0;
        hasSensoryConflict = sensory.length > 0;
      }

      return {
        id: r.id,
        mealDbId: r.mealDbId,
        title: r.title,
        image: r.imageUrl ?? undefined,
        minutes: r.totalTimeMinutes ?? null,
        heatLevel: r.heatLevel ?? md.heatLevel ?? "none",
        complexity: r.complexity ?? md.complexity ?? "low",
        tags: effectiveTags,
        matchStatus,
        profileWarnings,
        hasDietaryConflict,
        hasSensoryConflict,
      };
    })
    // When “Only show dishes you can safely consume” is selected (includeSometimes=false),
    // exclude recipes that match dietary/cultural constraints. (Texture warnings are informational elsewhere.)
    .filter((c) => q.filter === "showAll" || (!c.hasDietaryConflict && !c.hasSensoryConflict));

    return reply.send({ results: cards });
  });

  app.post("/api/recipes/visualise", async (request, reply) => {
    const body = visualiseBody.parse(request.body);
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    const resolvedInput = await resolveVisualiseInput(body.text);
    if (resolvedInput.kind === "url_blocked") {
      return reply.status(422).send({
        error:
          "We could not load that page automatically. Many recipe sites block automated access. Copy the full recipe text from the page and paste it here instead.",
        code: "URL_NOT_FETCHABLE",
      });
    }
    const textToParse = resolvedInput.text;
    const sourceUrl = body.sourceUrl?.trim() || resolvedInput.sourceUrl;
    let parsed: { graph: RecipeGraph; refined: boolean; parserSource: "gemini" | "openrouter" | "basic" };
    try {
      parsed = await parseRecipeTextToGraphResilient(textToParse, sourceUrl);
    } catch (e) {
      if (sourceUrl) {
        return reply.status(422).send({
          error:
            "We loaded the page but could not turn it into a recipe. Paste the ingredients and instructions here manually.",
          code: "PARSE_FAILED",
        });
      }
      throw e;
    }
    const graph = parsed.graph;
    const refined = parsed.refined;
    const resolved = await withIcons(graph, userId);
    const lede = await generateRecipeLedeResilient({ title: resolved.title, rawText: textToParse });
    const saved = await persistGraph(resolved, { rawText: textToParse, refined, lede });
    await linkRecipeToUser(saved.recipeId, userId);
    return reply.send({
      ...saved,
      parserSource: parsed.parserSource,
    });
  });

  app.get("/api/recipes/search", async (request, reply) => {
    const q = z
      .object({
        q: z.string().optional(),
        page: z.coerce.number().int().min(0).optional().default(0),
        limit: z.coerce.number().int().min(1).max(100).optional().default(24),
        maxMinutes: z.coerce.number().int().positive().optional(),
        complexity: z.string().optional(),
        heatLevel: z.string().optional(),
        filter: z.enum(["safeDishes", "showAll"]).optional().default("safeDishes"),
      })
      .parse((request.query as Record<string, string>) ?? {});
    const filters = {
      maxMinutes: q.maxMinutes,
      complexity: q.complexity,
      heatLevel: q.heatLevel,
    };
    const text = q.q?.trim();
    const meals = text
      ? await searchMealsOrdered(text, filters)
      : await browseMealsOrdered(q.page, q.limit, filters);

    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    let profileFoods: Array<{ name: string; status: "SAFE" | "UNSURE" | "UNSAFE" }> = [];
    let dietaryNeeds: string[] = [];
    let culturalRequirements: string[] = [];
    let unsafeTextures: ReturnType<typeof decodeUnsafeTexturePrefs> = [];
    let hasSensoryProfile = false;
    if (userId) {
      const profile = await prisma.sensoryProfile.findUnique({
        where: { userId },
        include: { foodItems: true },
      });
      if (profile) {
        hasSensoryProfile = true;
        profileFoods = profile.foodItems.map((f) => ({
          name: f.name,
          status: f.status as "SAFE" | "UNSURE" | "UNSAFE",
        }));
        dietaryNeeds = jsonStringArray(profile.dietaryNeeds);
        culturalRequirements = jsonStringArray(profile.culturalRequirements);
        unsafeTextures = decodeUnsafeTexturePrefs(profile.texturePrefs);
      }
    }

    const rows = meals.map((m) => {
      const meta = mealSearchHitFields(m);
      const mealDbId = String(m.idMeal);
      let matchStatus: "safe" | "sometimes" | "unsafe" = "safe";
      let profileWarnings: string[] = [];
      let hasDietaryConflict = false;
      let hasSensoryConflict = false;
      if (hasSensoryProfile) {
        const lines = mealIngredientLines(m);
        const { sensory, dietary } = computeSensoryConflictsFromIngredientLines(
          lines,
          profileFoods,
          dietaryNeeds,
          culturalRequirements,
        );
        const textures = computeTextureConflictsFromIngredientLines(lines, unsafeTextures);
        matchStatus = matchStatusFromConflicts(sensory, dietary, textures);
        profileWarnings = profileWarningsFromConflicts(sensory, dietary, textures);
        hasDietaryConflict = dietary.length > 0;
        hasSensoryConflict = sensory.length > 0;
      }
      return {
        id: mealDbId,
        title: m.strMeal,
        image: m.strMealThumb ?? undefined,
        minutes: meta.minutes,
        heatLevel: meta.heatLevel,
        complexity: meta.complexity,
        matchStatus,
        profileWarnings,
        hasDietaryConflict,
        hasSensoryConflict,
      };
    });

    const mealDbMinutes = await getMealDbMinutes();
    for (const r of rows) {
      const mins = mealDbMinutes.get(r.id);
      if (mins != null) r.minutes = mins;
    }

    const results = hasSensoryProfile
      ? rows.filter((r) => q.filter === "showAll" || (!r.hasDietaryConflict && !r.hasSensoryConflict))
      : rows;

    return reply.send({ results });
  });

  app.post("/api/recipes/import/themealdb", async (request, reply) => {
    const body = importBody.parse(request.body);
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    const mealDbMinutes = await getMealDbMinutes();
    const knownTime = mealDbMinutes.get(body.mealDbId) ?? null;
    const existing = await prisma.recipe.findUnique({
      where: { mealDbId: body.mealDbId },
    });
    if (existing && existing.refined) {
      if (existing.totalTimeMinutes == null && knownTime != null) {
        await prisma.recipe.update({
          where: { id: existing.id },
          data: { totalTimeMinutes: knownTime },
        });
        existing.totalTimeMinutes = knownTime;
      }
      if (!existing.imageUrl) {
        try {
          const meal = await lookupMealById(body.mealDbId);
          const thumb = typeof meal.strMealThumb === "string" ? meal.strMealThumb.trim() : "";
          if (thumb) {
            await prisma.recipe.update({
              where: { id: existing.id },
              data: { imageUrl: thumb },
            });
            existing.imageUrl = thumb;
          }
        } catch {
          // keep existing record even if image refresh fails
        }
      }
      const g = parseRecipeGraph(existing.graph);
      const resolved = await withIcons({ ...g, id: existing.id }, userId);
      await linkRecipeToUser(existing.id, userId);
      return reply.send({
        recipeId: existing.id,
        graph: resolved,
        parserSource: "cached",
      });
    }
    const meal = await lookupMealById(body.mealDbId);
    const { text, sourceUrl, imageUrl } = mealToRecipeText(meal);
    const parsed = await parseRecipeTextToGraphResilient(text, sourceUrl);
    const graph = enrichGraphWithMealDbImages(meal, parsed.graph);
    const refined = parsed.refined;
    const resolved = await withIcons(graph, userId);
    const lede = await generateRecipeLedeResilient({ title: resolved.title, rawText: text });
    const resolvedWithTime: RecipeGraph =
      knownTime != null && (resolved.totalTimeMinutes == null || !Number.isFinite(resolved.totalTimeMinutes))
        ? { ...resolved, totalTimeMinutes: knownTime }
        : resolved;
    if (existing && !existing.refined) {
      const derived = deriveRecipeMetadata(resolvedWithTime);
      const totalTimeMinutesOut =
        knownTime != null && (resolvedWithTime.totalTimeMinutes == null || !Number.isFinite(resolvedWithTime.totalTimeMinutes))
          ? knownTime
          : (resolvedWithTime.totalTimeMinutes ?? null);
      const fullGraph: RecipeGraph = { ...resolvedWithTime, id: existing.id, totalTimeMinutes: totalTimeMinutesOut };
      await prisma.recipe.update({
        where: { id: existing.id },
        data: {
          title: fullGraph.title,
          lede,
          imageUrl: imageUrl ?? null,
          sourceUrl: fullGraph.sourceUrl ?? null,
          totalTimeMinutes: totalTimeMinutesOut,
          servings: fullGraph.servings ?? null,
          graph: fullGraph as object,
          rawText: text,
          refined,
          complexity: derived.complexity ?? null,
          heatLevel: derived.heatLevel ?? null,
          tags: (derived.tags ?? []) as unknown as object,
        } as any,
      });
      await linkRecipeToUser(existing.id, userId);
      return reply.send({
        recipeId: existing.id,
        graph: fullGraph,
        parserSource: parsed.parserSource,
      });
    }

    const saved = await persistGraph(resolvedWithTime, {
      mealDbId: body.mealDbId,
      rawText: text,
      refined,
      lede,
      metadata: { imageUrl },
    });
    if (saved.graph.totalTimeMinutes == null && knownTime != null) {
      // Keep persisted graph JSON in sync with the DB column where possible.
      await prisma.recipe.update({
        where: { id: saved.recipeId },
        data: {
          totalTimeMinutes: knownTime,
          graph: { ...(saved.graph as unknown as object), totalTimeMinutes: knownTime } as object,
        },
      });
      saved.graph.totalTimeMinutes = knownTime;
    }
    await linkRecipeToUser(saved.recipeId, userId);
    return reply.send({ ...saved, parserSource: parsed.parserSource });
  });

  app.get("/api/recipes/:id/sensory-conflicts", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) {
      return reply.status(400).send({ error: "Missing or invalid X-User-Id" });
    }
    const recipe = await prisma.recipe.findUnique({ where: { id } });
    if (!recipe) return reply.status(404).send({ error: "Not found" });
    const graph = parseRecipeGraph(recipe.graph);
    const profile = await prisma.sensoryProfile.findUnique({
      where: { userId },
      include: { foodItems: true },
    });
    if (!profile) {
      return reply.send({
        hasProfile: false,
        sensory: [],
        dietary: [],
        disclaimer:
          "Suggestions only—verify ingredients yourself, especially for allergies.",
      });
    }
    const dietaryNeeds = jsonStringArray(profile.dietaryNeeds);
    const culturalRequirements = jsonStringArray(profile.culturalRequirements);
    const foods = profile.foodItems.map((f) => ({
      name: f.name,
      status: f.status as "SAFE" | "UNSURE" | "UNSAFE",
    }));
    const { sensory, dietary } = computeSensoryConflicts(
      graph,
      foods,
      dietaryNeeds,
      culturalRequirements,
    );
    const lines = graphIngredientLines(graph);
    const textures = computeTextureConflictsFromIngredientLines(
      lines,
      decodeUnsafeTexturePrefs(profile.texturePrefs),
    );
    return reply.send({
      hasProfile: true,
      sensory,
      dietary,
      textures,
      disclaimer:
        "Suggestions only—verify ingredients yourself, especially for allergies.",
    });
  });

  app.get("/api/recipes/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    let recipe = await prisma.recipe.findUnique({ where: { id } });
    if (!recipe) return reply.status(404).send({ error: "Not found" });

    if (recipe.mealDbId && !recipe.refined) {
      try {
        const mealDbMinutes = await getMealDbMinutes();
        const knownTime = mealDbMinutes.get(recipe.mealDbId) ?? null;
        const meal = await lookupMealById(recipe.mealDbId);
        const { text, sourceUrl, imageUrl } = mealToRecipeText(meal);
        const parsed = await parseRecipeTextToGraphResilient(text, sourceUrl);
        const graph = enrichGraphWithMealDbImages(meal, parsed.graph);
        const refined = parsed.refined;
        const derived = deriveRecipeMetadata(graph);

        const totalTimeMinutesOut =
          knownTime != null && (graph.totalTimeMinutes == null || !Number.isFinite(graph.totalTimeMinutes))
            ? knownTime
            : (graph.totalTimeMinutes ?? null);
        const fullGraph: RecipeGraph = { ...graph, id: recipe.id, totalTimeMinutes: totalTimeMinutesOut };

        await prisma.recipe.update({
          where: { id: recipe.id },
          data: {
            title: fullGraph.title,
            imageUrl: imageUrl ?? null,
            sourceUrl: fullGraph.sourceUrl ?? null,
            totalTimeMinutes: totalTimeMinutesOut,
            servings: fullGraph.servings ?? null,
            graph: fullGraph as object,
            rawText: text,
            refined,
            complexity: derived.complexity ?? null,
            heatLevel: derived.heatLevel ?? null,
            tags: (derived.tags ?? []) as unknown as object,
          },
        });

        const refreshed = await prisma.recipe.findUnique({ where: { id } });
        if (!refreshed) return reply.status(404).send({ error: "Not found" });
        recipe = refreshed;
      } catch {
        // If refresh fails, fall back to existing cached record.
      }
    }

    let imageUrlOut = recipe.imageUrl;
    if (!imageUrlOut && recipe.mealDbId) {
      try {
        const meal = await lookupMealById(recipe.mealDbId);
        const thumb = typeof meal.strMealThumb === "string" ? meal.strMealThumb.trim() : "";
        if (thumb) {
          await prisma.recipe.update({
            where: { id: recipe.id },
            data: { imageUrl: thumb },
          });
          imageUrlOut = thumb;
          recipe = { ...recipe, imageUrl: thumb };
        }
      } catch {
        // keep null imageUrl
      }
    }

    const g = parseRecipeGraph(recipe.graph);
    const resolved = await withIcons({ ...g, id: recipe.id }, userId);
    await linkRecipeToUser(recipe.id, userId);
    return reply.send({
      recipeId: recipe.id,
      graph: resolved,
      lede: (recipe as any).lede ?? null,
      imageUrl: imageUrlOut,
      complexity: recipe.complexity,
      heatLevel: recipe.heatLevel,
      tags: recipe.tags,
      updatedAt: recipe.updatedAt.toISOString(),
      refined: Boolean(recipe.refined),
      canRefine: Boolean(recipe.rawText),
    });
  });

  app.post("/api/recipes/:id/refine", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    const recipe = await prisma.recipe.findUnique({ where: { id } });
    if (!recipe) return reply.status(404).send({ error: "Not found" });
    if (!recipe.rawText) {
      return reply.status(400).send({ error: "Recipe cannot be refined (missing source text)" });
    }
    const parsed = await parseRecipeTextToGraphResilient(recipe.rawText, recipe.sourceUrl ?? null);
    let graphAfterParse = parsed.graph;
    let mealThumb: string | null = null;
    if (recipe.mealDbId) {
      try {
        const meal = await lookupMealById(recipe.mealDbId);
        graphAfterParse = enrichGraphWithMealDbImages(meal, graphAfterParse);
        const t = typeof meal.strMealThumb === "string" ? meal.strMealThumb.trim() : "";
        mealThumb = t || null;
      } catch {
        // keep graph without MealDB enrichment
      }
    }
    const resolved = await withIcons({ ...graphAfterParse, id: recipe.id }, userId);
    const fullGraph: RecipeGraph = { ...resolved, id: recipe.id };
    const meta = deriveRecipeMetadata(graphAfterParse);
    const lede = await generateRecipeLedeResilient({ title: fullGraph.title, rawText: recipe.rawText });
    await prisma.recipe.update({
      where: { id: recipe.id },
      data: {
        graph: fullGraph as object,
        refined: parsed.refined,
        lede,
        complexity: meta.complexity ?? null,
        heatLevel: meta.heatLevel ?? null,
        tags: (meta.tags ?? []) as unknown as object,
        ...(recipe.imageUrl == null && mealThumb ? { imageUrl: mealThumb } : {}),
      } as any,
    });
    return reply.send({ ok: true, parserSource: parsed.parserSource });
  });

  app.post("/api/recipes/:id/progress", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) {
      return reply.status(400).send({ error: "Missing or invalid X-User-Id" });
    }
    const body = progressBody.parse(request.body);
    const recipe = await prisma.recipe.findUnique({ where: { id } });
    if (!recipe) return reply.status(404).send({ error: "Not found" });
    await prisma.recipeProgress.upsert({
      where: {
        recipeId_userId: { recipeId: id, userId },
      },
      create: {
        recipeId: id,
        userId,
        completedNodeIds: body.completedNodeIds,
      },
      update: {
        completedNodeIds: body.completedNodeIds,
      },
    });
    return reply.send({ ok: true });
  });

  app.get("/api/recipes/:id/progress", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) {
      return reply.status(400).send({ error: "Missing or invalid X-User-Id" });
    }
    const row = await prisma.recipeProgress.findUnique({
      where: { recipeId_userId: { recipeId: id, userId } },
    });
    const ids = (row?.completedNodeIds as string[]) ?? [];
    return reply.send({ completedNodeIds: ids });
  });
}
