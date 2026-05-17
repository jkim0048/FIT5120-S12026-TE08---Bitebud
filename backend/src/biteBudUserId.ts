import { z } from "zod";

const biteBudUserIdSchema = z.string().regex(/^[A-Z0-9]{3}$/);

/**
 * Validates the BiteBud client user id: exactly 3 uppercase alphanumeric characters.
 */
export function parseBiteBudUserId(headerValue: string | undefined): string | null {
  if (!headerValue || typeof headerValue !== "string") return null;
  const normalized = headerValue.trim().toUpperCase();
  return biteBudUserIdSchema.safeParse(normalized).success ? normalized : null;
}
