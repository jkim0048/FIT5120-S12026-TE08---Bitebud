/** API error code returned when restaurant tables are missing from the database schema. */
export const SCHEMA_MISSING_CODE = "RESTAURANT_SCHEMA_MISSING";

/** True when Prisma reports that the underlying table/column is missing (migration not run). */
export function isPrismaSchemaMissingError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  return code === "P2021" || code === "P2022";
}

/** True when the DB URL is missing, Prisma failed to init, or the server is unreachable. */
export function isPrismaUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if (isPrismaSchemaMissingError(error)) return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (code === "P1001" || code === "P1017") return true;
  const errorName = "name" in error ? String((error as { name?: unknown }).name ?? "") : "";
  if (errorName === "PrismaClientInitializationError") return true;
  const errorMessage =
    "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  if (errorMessage.includes("Environment variable not found: DATABASE_URL")) return true;
  if (
    errorMessage.includes("Can't reach database server") ||
    errorMessage.includes("Server has closed the connection")
  ) {
    return true;
  }
  return false;
}

/** Stock 503 response body for when the Prisma table is missing. */
export function schemaMissingResponse(): { error: string; code: string } {
  return {
    error: "Restaurant tables are not ready. Run backend prisma migration and restart the API.",
    code: SCHEMA_MISSING_CODE,
  };
}
