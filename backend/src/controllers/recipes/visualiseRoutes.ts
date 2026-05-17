import type { FastifyInstance } from "fastify";
import { parseBiteBudUserId } from "../../biteBudUserId.js";
import type { RecipeGraph } from "../../graph/recipeGraph.js";
import { enforceRateLimit } from "../../services/rateLimit.js";
import { generateRecipeLedeResilient } from "../../services/recipeLede.js";
import { looksLikeFoodRecipe } from "../../services/recipePasteChecker.js";
import {
  linkRecipeToUser,
  parseRecipeTextToGraphResilient,
  persistGraph,
  withIcons,
} from "../../services/recipeRouteHelpers.js";
import { resolveVisualiseInput } from "../../services/recipeUrlFetch.js";
import { visualiseBody } from "./recipeSchemas.js";

const VISUALISE_RATE_LIMIT_COUNT = 5;
const VISUALISE_RATE_LIMIT_WINDOW_MS = 60_000;

/** Register `POST /api/recipes/visualise` — parse pasted recipe text into a graph and persist it. */
export async function registerVisualiseRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/recipes/visualise", async (request, reply) => {
    enforceRateLimit(request, reply, {
      keyPrefix: "visualise",
      limit: VISUALISE_RATE_LIMIT_COUNT,
      windowMs: VISUALISE_RATE_LIMIT_WINDOW_MS,
    });
    if (reply.sent) return;

    const body = visualiseBody.parse(request.body);
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    const resolvedInput = resolveVisualiseInput(body.text);
    if (resolvedInput.kind === "url_not_supported") {
      return reply.status(422).send({
        error:
          "Recipe links are not supported. Copy the ingredients and instructions from the page and paste them as text.",
        code: "URL_IMPORT_DISABLED",
      });
    }

    const textToParse = resolvedInput.text;
    if (!looksLikeFoodRecipe(textToParse)) {
      return reply.status(422).send({
        error: "That doesn’t look like a food recipe. Paste ingredients and instructions.",
        code: "NOT_RECIPE",
      });
    }

    const sourceUrl = body.sourceUrl?.trim() || null;
    const parsed = await parseRecipeTextToGraphResilient(textToParse, sourceUrl);

    const resolved = await withIcons(parsed.graph, userId);
    const lede = await generateRecipeLedeResilient({
      title: resolved.title,
      rawText: textToParse,
    });
    const saved = await persistGraph(resolved, {
      rawText: textToParse,
      refined: parsed.refined,
      lede,
    });
    await linkRecipeToUser(saved.recipeId, userId);
    return reply.send({ ...saved, parserSource: parsed.parserSource });
  });
}
