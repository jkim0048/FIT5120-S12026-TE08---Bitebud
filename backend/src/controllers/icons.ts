import type { FastifyInstance } from "fastify";
import { ingestWickedIcons } from "../services/icons.js";
import {
  getIconOverride,
  getWickedPickerItems,
  fetchWickedIconAsset,
  listIngredientIconMap,
  searchWickedIcons,
  upsertIconOverride,
} from "../services/iconApiService.js";
import {
  wickedIngestBody,
  wickedOverrideBody,
  wickedSearchQuery,
} from "../services/iconRouteHelpers.js";
import { parseBiteBudUserId } from "../biteBudUserId.js";

/** Register every `/api/icons/*` endpoint group on the Fastify app. */
export async function registerIconRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/icons/wicked-picker", async (_request, reply) => {
    const result = await getWickedPickerItems();
    if ("kind" in result) {
      if (result.kind === "unavailable") {
        return reply.status(503).send({ error: result.message });
      }
      if (result.kind === "error") {
        return reply.status(500).send({ error: result.message });
      }
    }
    return result;
  });

  app.get("/api/icons/ingredient-map", async () => listIngredientIconMap());

  app.get("/api/icons/wicked", async (request) => {
    const parsedQuery = wickedSearchQuery.parse(
      (request.query as Record<string, string>) ?? {},
    );
    return searchWickedIcons(parsedQuery.query, parsedQuery.limit);
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
    const result = await upsertIconOverride(userId, body);
    if ("kind" in result) {
      if (result.kind === "empty_key") {
        return reply.status(400).send({ error: "ingredientKey cannot be empty" });
      }
      if (result.kind === "icon_not_found") {
        return reply.status(404).send({ error: "Icon not found" });
      }
    }
    return result;
  });

  app.get("/api/icons/overrides/:ingredient", async (request, reply) => {
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) {
      return reply.status(400).send({ error: "Missing or invalid X-User-Id" });
    }
    const { ingredient } = request.params as { ingredient: string };
    return getIconOverride(userId, ingredient);
  });

  app.get("/api/icons/wicked/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await fetchWickedIconAsset(id);
    if (result.kind === "not_found") {
      return reply.status(404).send({ error: "Icon not found" });
    }
    if (result.kind === "upstream_error") {
      return reply.status(502).send({ error: result.message });
    }
    if (result.kind === "too_large") {
      return reply.status(502).send({ error: "Icon too large" });
    }
    return reply
      .header("Cache-Control", "public, max-age=86400")
      .type(result.contentType)
      .send(result.buffer);
  });
}
