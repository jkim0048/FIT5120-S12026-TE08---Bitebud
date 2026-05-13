import type { FastifyInstance } from "fastify";
import { registerActivityRoutes } from "./activityRoutes.js";
import { registerInsightsRoutes } from "./insightsRoutes.js";

/** Register every `/api/me/*` route. */
export async function registerMeRoutes(app: FastifyInstance): Promise<void> {
  await registerActivityRoutes(app);
  await registerInsightsRoutes(app);
}
