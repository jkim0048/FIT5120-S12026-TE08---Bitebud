import { z } from "zod";

/** Query schema for `GET /api/me/insights`: dismissed-card list and optional date range. */
export const insightsQuerySchema = z
  .object({
    dismissed: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .refine((query) => !Boolean(query.from) === !Boolean(query.to), {
    message: "Provide both `from` and `to`, or omit both for full-history insights.",
  });

export type InsightsQuery = z.infer<typeof insightsQuerySchema>;
