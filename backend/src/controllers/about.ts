import type { FastifyInstance } from "fastify";
import { getAboutStats } from "../services/aboutService.js";

/** Register `GET /api/about/stats` — ABS autism population and meal-prep assistance figures for the About page. */
export async function registerAboutRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/about/stats", async () => getAboutStats());
}
