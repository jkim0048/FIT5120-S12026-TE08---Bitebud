import { z } from "zod";

const SEARCH_MIN_LENGTH = 2;
const SEARCH_MAX_LENGTH = 120;
const RECIPE_TEXT_MIN_LENGTH = 40;
const RECIPE_TEXT_MAX_LENGTH = 40_000;
const REPEATED_RUN_THRESHOLD = 80;
const MIN_LETTER_RATIO = 0.08;

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Trim, normalise newlines, and strip disallowed control characters from arbitrary user-entered text. */
export function normalizeUserText(text: string): string {
  return stripDisallowedControlChars(normalizeNewlines(text)).trim();
}

/** Share of visible characters that are Unicode letters (abuse signal for pasted recipes). */
function letterRatio(text: string): number {
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  const visible = (text.replace(/\s+/g, "").match(/[^\s]/g) ?? []).length;
  if (visible === 0) return 0;
  return letters / visible;
}

/** Longest run of the same character in a row (abuse signal for pasted recipes). */
function maxRepeatedRun(text: string): number {
  // Long repeated runs are a common "spam / abuse" signal (e.g. 500x 'a' or '=')
  let longestRun = 1;
  let currentRun = 1;
  for (let charIndex = 1; charIndex < text.length; charIndex++) {
    if (text[charIndex] === text[charIndex - 1]) {
      currentRun++;
      if (currentRun > longestRun) longestRun = currentRun;
    } else {
      currentRun = 1;
    }
  }
  return longestRun;
}

/** Remove ASCII control chars except tab, LF, and CR (keeps pasted recipe formatting). */
function stripDisallowedControlChars(text: string): string {
  // Keep common whitespace controls for pasted recipes; drop the rest.
  // - allow: \n \r \t
  // - reject: other ASCII control chars + DEL
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

/** Zod schema for the free-text search field — trims, normalises, and bans URLs / oversized input. */
export const zSearchQuery = z
  .string()
  .superRefine((raw, ctx) => {
    // Validate based on the normalized value (trimmed, safe newlines, no control chars),
    // so callers can't bypass rules with whitespace/control characters.
    const normalized = normalizeUserText(raw);
    if (normalized.length < SEARCH_MIN_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Search must be at least ${SEARCH_MIN_LENGTH} characters`,
      });
    }
    if (normalized.length > SEARCH_MAX_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Search must be at most ${SEARCH_MAX_LENGTH} characters`,
      });
    }
    if (/^https?:\/\//i.test(normalized)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Paste text, not a URL" });
    }
  })
  .transform(normalizeUserText);

/** Zod schema for user-pasted recipe text — applies safety limits for repeated runs / non-letters. */
export const zUserRecipeText = z
  .string()
  .superRefine((raw, ctx) => {
    // Keep recipe text permissive (users paste lots of punctuation/newlines),
    // but apply safety limits to protect LLM and DB from abuse.
    const normalized = stripDisallowedControlChars(normalizeNewlines(raw)).trim();
    if (normalized.length < RECIPE_TEXT_MIN_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Paste the full recipe text (ingredients + instructions)",
      });
    }
    if (normalized.length > RECIPE_TEXT_MAX_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Recipe text is too long (max ${RECIPE_TEXT_MAX_LENGTH.toLocaleString()} characters)`,
      });
    }
    if (maxRepeatedRun(normalized) > REPEATED_RUN_THRESHOLD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Recipe text looks invalid (too many repeated characters)",
      });
    }
    if (letterRatio(normalized) < MIN_LETTER_RATIO) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Recipe text looks invalid (not enough readable text)",
      });
    }
  })
  .transform((raw) => stripDisallowedControlChars(normalizeNewlines(raw)).trim());
