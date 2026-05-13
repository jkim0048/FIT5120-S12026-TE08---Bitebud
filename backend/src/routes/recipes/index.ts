import type { FastifyInstance } from "fastify";
import { registerBrowseRoutes } from "./browseRoutes.js";
import { registerCompletionsRoutes } from "./completionsRoutes.js";
import { registerFlavorsRoutes } from "./flavorsRoutes.js";
import { registerGetRecipeRoutes } from "./getRecipeRoutes.js";
import { registerImportThemealdbRoutes } from "./importThemealdbRoutes.js";
import { registerProgressRoutes } from "./progressRoutes.js";
import { registerRefineRoutes } from "./refineRoutes.js";
import { registerSearchRoutes } from "./searchRoutes.js";
import { registerSensoryConflictsRoutes } from "./sensoryConflictsRoutes.js";
import { registerVisualiseRoutes } from "./visualiseRoutes.js";

/**
 * Register every `/api/recipes/*` route.
 *
 * Order matters: specific paths (`/:id/sensory-conflicts`, `/:id/flavors`, `/:id/progress`, `/:id/refine`,
 * `/:id/completions`, `/:id/complete`) must register before the generic `/:id` getter so Fastify routes
 * the request to the correct handler.
 */
export async function registerRecipeRoutes(app: FastifyInstance): Promise<void> {
  await registerBrowseRoutes(app);
  await registerVisualiseRoutes(app);
  await registerSearchRoutes(app);
  await registerCompletionsRoutes(app);
  await registerImportThemealdbRoutes(app);
  await registerSensoryConflictsRoutes(app);
  await registerFlavorsRoutes(app);
  await registerRefineRoutes(app);
  await registerProgressRoutes(app);
  await registerGetRecipeRoutes(app);
}
