import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import {
  DEFAULT_WICKED_SOURCE,
  formatIngredientDisplayLabel,
  ingestWickedIcons,
  normalizeIngredientKey,
} from "../services/icons.js";
import { parseBiteBudUserId } from "../biteBudUserId.js";

/** Re-fetch catalog from food.getwicked.app at most this often (names + image URLs; no binary assets). */
const WICKED_CATALOG_RESYNC_MS = 60 * 60 * 1000;
let lastWickedCatalogIngestAt = Date.now();

const overrideBody = z.object({
  ingredientKey: z.string().min(1),
  wickedIconId: z.string().optional().nullable(),
  emojiFallback: z.string().max(8).optional().nullable(),
});

const ingestBody = z.object({
  sourceUrl: z.string().url().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  includeAssets: z.boolean().optional(),
});

const WICKED_ICON_PROXY_MAX_BYTES = 5 * 1024 * 1024;

/** Only fetch URLs we ingested from Wicked (prevents SSRF if `image_url` is tampered). */
function isWickedImageHost(urlStr: string): boolean {
  let u: URL;
  try {
    u = new URL(urlStr.trim());
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const h = u.hostname.toLowerCase();
  const baseHost = new URL(DEFAULT_WICKED_SOURCE).hostname.toLowerCase();
  return h === baseHost || h.endsWith(`.${baseHost}`) || h.endsWith(".getwicked.app");
}

function contentTypeForWickedIcon(imageUrl: string | null, upstream: string | null): string {
  const ct = upstream?.split(";")[0]?.trim();
  if (ct && /^image\//i.test(ct)) return ct;
  const path = (() => {
    try {
      return new URL(imageUrl ?? "").pathname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  return "image/png";
}

export async function registerIconRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Full Wicked icon list for Food Safety Tags picker (`wicked_icons`).
   * Syncs ingredient names and icon URLs from https://food.getwicked.app/ when the table is empty
   * or on a periodic refresh (upserts into `wicked_icons`; skips heavy asset download — use POST ingest for PNGs).
   */
  app.get("/api/icons/wicked-picker", async (_request, reply) => {
    try {
      let count = await prisma.wickedIcon.count();
      const stale = Date.now() - lastWickedCatalogIngestAt >= WICKED_CATALOG_RESYNC_MS;
      if (count === 0 || stale) {
        await ingestWickedIcons({
          sourceUrl: DEFAULT_WICKED_SOURCE,
          limit: 800,
          includeAssets: false,
        });
        lastWickedCatalogIngestAt = Date.now();
        count = await prisma.wickedIcon.count();
      }
      if (count === 0) {
        return reply.status(503).send({
          error:
            "No Wicked icons in the database and ingest returned nothing. Check network access to food.getwicked.app.",
        });
      }
      const rows = await prisma.wickedIcon.findMany({
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: 2500,
        select: { id: true, name: true, category: true, imageUrl: true },
      });
      return {
        items: rows.map((r) => {
          const label = (r.name?.trim() || r.id.replace(/-/g, " ")).slice(0, 120);
          const cat = r.category?.trim();
          const hint = cat ? `Icon category: ${cat}` : "Wicked food icon";
          return {
            wickedIconId: r.id,
            label,
            hint,
            imageUrl: r.imageUrl,
          };
        }),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Wicked picker failed";
      return reply.status(500).send({ error: msg });
    }
  });

  /** Legacy: ingredient → icon map (optional display for older sensory items). */
  app.get("/api/icons/ingredient-map", async () => {
    const rows = await prisma.ingredientIconMap.findMany({
      orderBy: { ingredientKey: "asc" },
      select: {
        ingredientKey: true,
        emojiFallback: true,
        wickedIcon: { select: { name: true } },
      },
    });
    return {
      items: rows.map((r) => {
        const label = formatIngredientDisplayLabel(r.ingredientKey);
        const emoji = r.emojiFallback?.trim() || "🍽️";
        const hint = r.wickedIcon?.name?.trim() || label;
        return { ingredientKey: r.ingredientKey, label, emoji, hint };
      }),
    };
  });

  app.get("/api/icons/wicked", async (request) => {
    const q = z
      .object({
        query: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      })
      .parse((request.query as Record<string, string>) ?? {});
    const where = q.query
      ? {
          OR: [
            { id: { contains: q.query, mode: "insensitive" as const } },
            { name: { contains: q.query, mode: "insensitive" as const } },
          ],
        }
      : undefined;
    const rows = await prisma.wickedIcon.findMany({
      where,
      orderBy: { name: "asc" },
      take: q.limit ?? 30,
      select: { id: true, name: true, imageUrl: true, category: true },
    });
    return { icons: rows };
  });

  app.post("/api/icons/wicked/ingest", async (request, reply) => {
    const body = ingestBody.parse(request.body ?? {});
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
    const body = overrideBody.parse(request.body);
    const ingredientKey = normalizeIngredientKey(body.ingredientKey);
    if (!ingredientKey) {
      return reply.status(400).send({ error: "ingredientKey cannot be empty" });
    }
    if (body.wickedIconId) {
      const icon = await prisma.wickedIcon.findUnique({
        where: { id: body.wickedIconId },
      });
      if (!icon) return reply.status(404).send({ error: "Icon not found" });
    }
    await prisma.userIconOverride.upsert({
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
    const row = await prisma.userIconOverride.findUnique({
      where: { userId_ingredientKey: { userId, ingredientKey } },
      select: { wickedIconId: true, emojiFallback: true },
    });
    return { ingredientKey, override: row ?? null };
  });

  app.get("/api/icons/wicked/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await prisma.wickedIcon.findUnique({
      where: { id },
      select: { asset: true, imageUrl: true },
    });
    if (!row) {
      return reply.status(404).send({ error: "Icon not found" });
    }

    if (row.asset?.length) {
      const buf = Buffer.from(row.asset);
      const ct = contentTypeForWickedIcon(row.imageUrl ?? null, null);
      return reply
        .header("Cache-Control", "public, max-age=86400")
        .type(ct)
        .send(buf);
    }

    const imageUrl = row.imageUrl?.trim();
    if (!imageUrl) {
      return reply.status(404).send({ error: "Icon not found" });
    }
    if (!isWickedImageHost(imageUrl)) {
      return reply.status(404).send({ error: "Icon not found" });
    }

    let upstream: Response;
    try {
      upstream = await fetch(imageUrl, {
        redirect: "follow",
        headers: { Accept: "image/*,*/*;q=0.8" },
      });
    } catch {
      return reply.status(502).send({ error: "Upstream fetch failed" });
    }
    if (!upstream.ok) {
      return reply.status(502).send({ error: "Upstream returned error" });
    }

    const len = upstream.headers.get("content-length");
    if (len && Number.parseInt(len, 10) > WICKED_ICON_PROXY_MAX_BYTES) {
      return reply.status(502).send({ error: "Icon too large" });
    }

    const ab = await upstream.arrayBuffer();
    if (ab.byteLength > WICKED_ICON_PROXY_MAX_BYTES) {
      return reply.status(502).send({ error: "Icon too large" });
    }

    const buf = Buffer.from(ab);
    if (!isWickedImageHost(upstream.url)) {
      return reply.status(404).send({ error: "Icon not found" });
    }

    const ct = contentTypeForWickedIcon(
      imageUrl,
      upstream.headers.get("content-type"),
    );
    return reply.header("Cache-Control", "public, max-age=86400").type(ct).send(buf);
  });
}
