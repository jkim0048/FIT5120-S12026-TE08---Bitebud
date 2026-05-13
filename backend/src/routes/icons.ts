import type { FastifyInstance } from "fastify";
import { iconCatalogDatabase } from "../database/iconCatalogDatabase.js";
import {
  DEFAULT_WICKED_SOURCE,
  formatIngredientDisplayLabel,
  ingestWickedIcons,
  normalizeIngredientKey,
} from "../services/icons.js";
import {
  WICKED_CATALOG_RESYNC_MS,
  WICKED_ICON_PROXY_MAX_BYTES,
  WICKED_PICKER_INGEST_LIMIT,
  WICKED_PICKER_PAGE_SIZE,
  WICKED_SEARCH_DEFAULT_LIMIT,
  contentTypeForWickedIcon,
  isWickedImageHost,
  wickedIngestBody,
  wickedOverrideBody,
  wickedSearchQuery,
} from "../services/iconRouteHelpers.js";
import { parseBiteBudUserId } from "../biteBudUserId.js";

const WICKED_PICKER_LABEL_MAX_LENGTH = 120;
let lastWickedCatalogIngestAt = Date.now();

/** Register every `/api/icons/*` endpoint group on the Fastify app. */
export async function registerIconRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Full Wicked icon list for Food Safety Tags picker (`wicked_icons`).
   * Syncs ingredient names and icon URLs from https://food.getwicked.app/ when the table is empty
   * or on a periodic refresh (upserts into `wicked_icons`; skips heavy asset download — use POST ingest for PNGs).
   */
  app.get("/api/icons/wicked-picker", async (_request, reply) => {
    try {
      let count = await iconCatalogDatabase.wickedIconCount();
      const stale = Date.now() - lastWickedCatalogIngestAt >= WICKED_CATALOG_RESYNC_MS;
      if (count === 0 || stale) {
        await ingestWickedIcons({
          sourceUrl: DEFAULT_WICKED_SOURCE,
          limit: WICKED_PICKER_INGEST_LIMIT,
          includeAssets: false,
        });
        lastWickedCatalogIngestAt = Date.now();
        count = await iconCatalogDatabase.wickedIconCount();
      }
      if (count === 0) {
        return reply.status(503).send({
          error:
            "No Wicked icons in the database and ingest returned nothing. Check network access to food.getwicked.app.",
        });
      }
      const rows = await iconCatalogDatabase.wickedIconFindMany({
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: WICKED_PICKER_PAGE_SIZE,
        select: { id: true, name: true, category: true, imageUrl: true },
      });
      return {
        items: rows.map((row) => {
          const label = (row.name?.trim() || row.id.replace(/-/g, " ")).slice(
            0,
            WICKED_PICKER_LABEL_MAX_LENGTH,
          );
          const category = row.category?.trim();
          const hint = category ? `Icon category: ${category}` : "Wicked food icon";
          return {
            wickedIconId: row.id,
            label,
            hint,
            imageUrl: row.imageUrl,
          };
        }),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Wicked picker failed";
      return reply.status(500).send({ error: message });
    }
  });

  /** Legacy: ingredient → icon map (optional display for older sensory items). */
  app.get("/api/icons/ingredient-map", async () => {
    const rows = await iconCatalogDatabase.ingredientIconMapFindMany({
      orderBy: { ingredientKey: "asc" },
      select: {
        ingredientKey: true,
        emojiFallback: true,
        wickedIcon: { select: { name: true } },
      },
    });
    return {
      items: rows.map((row) => {
        const label = formatIngredientDisplayLabel(row.ingredientKey);
        const emoji = row.emojiFallback?.trim() || "🍽️";
        const hint = row.wickedIcon?.name?.trim() || label;
        return { ingredientKey: row.ingredientKey, label, emoji, hint };
      }),
    };
  });

  app.get("/api/icons/wicked", async (request) => {
    const parsedQuery = wickedSearchQuery.parse(
      (request.query as Record<string, string>) ?? {},
    );
    const where = parsedQuery.query
      ? {
          OR: [
            { id: { contains: parsedQuery.query, mode: "insensitive" as const } },
            { name: { contains: parsedQuery.query, mode: "insensitive" as const } },
          ],
        }
      : undefined;
    const rows = await iconCatalogDatabase.wickedIconFindMany({
      where,
      orderBy: { name: "asc" },
      take: parsedQuery.limit ?? WICKED_SEARCH_DEFAULT_LIMIT,
      select: { id: true, name: true, imageUrl: true, category: true },
    });
    return { icons: rows };
  });

  app.post("/api/icons/wicked/ingest", async (request, reply) => {
    const body = wickedIngestBody.parse(request.body ?? {});
    const result = await ingestWickedIcons({
      sourceUrl: body.sourceUrl,
      limit: body.limit,
      includeAssets: body.includeAssets ?? true,
    });
    return reply.send(result);
  });

  app.put("/api/icons/overrides", async (request, reply) => {
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) {
      return reply.status(400).send({ error: "Missing or invalid X-User-Id" });
    }
    const body = wickedOverrideBody.parse(request.body);
    const ingredientKey = normalizeIngredientKey(body.ingredientKey);
    if (!ingredientKey) {
      return reply.status(400).send({ error: "ingredientKey cannot be empty" });
    }
    if (body.wickedIconId) {
      const icon = await iconCatalogDatabase.wickedIconFindUnique({
        where: { id: body.wickedIconId },
      });
      if (!icon) return reply.status(404).send({ error: "Icon not found" });
    }
    await iconCatalogDatabase.userIconOverrideUpsert({
      where: { userId_ingredientKey: { userId, ingredientKey } },
      create: {
        userId,
        ingredientKey,
        wickedIconId: body.wickedIconId ?? null,
        emojiFallback: body.emojiFallback ?? null,
      },
      update: {
        wickedIconId: body.wickedIconId ?? null,
        emojiFallback: body.emojiFallback ?? null,
      },
    });
    return { ok: true };
  });

  app.get("/api/icons/overrides/:ingredient", async (request, reply) => {
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) {
      return reply.status(400).send({ error: "Missing or invalid X-User-Id" });
    }
    const { ingredient } = request.params as { ingredient: string };
    const ingredientKey = normalizeIngredientKey(ingredient);
    const row = await iconCatalogDatabase.userIconOverrideFindUnique({
      where: { userId_ingredientKey: { userId, ingredientKey } },
      select: { wickedIconId: true, emojiFallback: true },
    });
    return { ingredientKey, override: row ?? null };
  });

  app.get("/api/icons/wicked/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await iconCatalogDatabase.wickedIconFindUnique({
      where: { id },
      select: { asset: true, imageUrl: true },
    });
    if (!row) {
      return reply.status(404).send({ error: "Icon not found" });
    }

    if (row.asset?.length) {
      const assetBuffer = Buffer.from(row.asset);
      const contentType = contentTypeForWickedIcon(row.imageUrl ?? null, null);
      return reply
        .header("Cache-Control", "public, max-age=86400")
        .type(contentType)
        .send(assetBuffer);
    }

    const imageUrl = row.imageUrl?.trim();
    if (!imageUrl) {
      return reply.status(404).send({ error: "Icon not found" });
    }
    if (!isWickedImageHost(imageUrl)) {
      return reply.status(404).send({ error: "Icon not found" });
    }

    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(imageUrl, {
        redirect: "follow",
        headers: { Accept: "image/*,*/*;q=0.8" },
      });
    } catch {
      return reply.status(502).send({ error: "Upstream fetch failed" });
    }
    if (!upstreamResponse.ok) {
      return reply.status(502).send({ error: "Upstream returned error" });
    }

    const declaredLength = upstreamResponse.headers.get("content-length");
    if (declaredLength && Number.parseInt(declaredLength, 10) > WICKED_ICON_PROXY_MAX_BYTES) {
      return reply.status(502).send({ error: "Icon too large" });
    }

    const upstreamBytes = await upstreamResponse.arrayBuffer();
    if (upstreamBytes.byteLength > WICKED_ICON_PROXY_MAX_BYTES) {
      return reply.status(502).send({ error: "Icon too large" });
    }

    const assetBuffer = Buffer.from(upstreamBytes);
    if (!isWickedImageHost(upstreamResponse.url)) {
      return reply.status(404).send({ error: "Icon not found" });
    }

    const contentType = contentTypeForWickedIcon(
      imageUrl,
      upstreamResponse.headers.get("content-type"),
    );
    return reply
      .header("Cache-Control", "public, max-age=86400")
      .type(contentType)
      .send(assetBuffer);
  });
}
