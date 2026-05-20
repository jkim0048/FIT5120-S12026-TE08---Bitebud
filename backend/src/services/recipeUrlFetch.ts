const URL_ONLY_LINE = /^https?:\/\/\S+$/i;

/** Detect whether the given text is exactly one `http(s)` URL line (after trimming/blank-line removal). */
export function isUrlOnlyRecipeInput(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const lines = t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length === 1 && URL_ONLY_LINE.test(lines[0]!);
}

export type ResolvedRecipeInput =
  | { kind: "text"; text: string; sourceUrl: string | null }
  | { kind: "url_not_supported" };

/**
 * Normalise visualise input. URL-only paste is rejected (no web fetching); plain text is passed through.
 */
export function resolveVisualiseInput(text: string): ResolvedRecipeInput {
  const trimmed = text.trim();
  if (isUrlOnlyRecipeInput(trimmed)) {
    return { kind: "url_not_supported" };
  }
  return { kind: "text", text: trimmed, sourceUrl: null };
}
