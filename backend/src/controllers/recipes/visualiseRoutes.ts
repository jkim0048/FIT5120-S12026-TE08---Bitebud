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

/** Register `POST /api/recipes/visualise` — parse raw text or URL into a recipe graph and persist it. */
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
    const resolvedInput = await resolveVisualiseInput(body.text);
    if (resolvedInput.kind === "url_blocked") {
      return reply.status(422).send({
        error:
          "We could not load that page automatically. Many recipe sites block automated access. Copy the full recipe text from the page and paste it here instead.",
        code: "URL_NOT_FETCHABLE",
      });
    }

    const textToParse = resolvedInput.text;
    if (!looksLikeFoodRecipe(textToParse)) {
      return reply.status(422).send({
        error: "That doesn’t look like a food recipe. Paste ingredients and instructions.",
        code: "NOT_RECIPE",
      });
    }

    const sourceUrl = body.sourceUrl?.trim() || resolvedInput.sourceUrl;
    let parsed: { graph: RecipeGraph; refined: boolean; parserSource: "gemini" | "basic" };
    try {
      parsed = await parseRecipeTextToGraphResilient(textToParse, sourceUrl);
    } catch (parseError) {
      if (sourceUrl) {
        return reply.status(422).send({
          error:
            "We loaded the page but could not turn it into a recipe. Paste the ingredients and instructions here manually.",
          code: "PARSE_FAILED",
        });
      }
      throw parseError;
    }

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
