import { z } from "zod";

/** Query schema for `GET /api/me/insights` and `GET /api/me/progress`: date range and dismissed insight cards. */
export const insightsQuerySchema = z
  .object({
    dismissed: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .refine((query) => !Boolean(query.from) === !Boolean(query.to), {
    message: "Provide both `from` and `to`, or omit both for full-history insights.",
  });

/** Parsed query params for `/api/me/insights` and `/api/me/progress`. */
export type InsightsQuery = z.infer<typeof insightsQuerySchema>;
