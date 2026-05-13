import { z } from "zod";

/** Query schema for `GET /api/me/insights`: dismissed-card list and optional date range. */
export const insightsQuerySchema = z.object({
  dismissed: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export type InsightsQuery = z.infer<typeof insightsQuerySchema>;
