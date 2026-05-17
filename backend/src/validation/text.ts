import { z } from "zod";

function normalizeNewlines(s: string): string {
  return s.replace(/\r\n?/g, "\n");
}

export function normalizeUserText(s: string): string {
  return stripDisallowedControlChars(normalizeNewlines(s)).trim();
}

function letterRatio(s: string): number {
  const letters = (s.match(/\p{L}/gu) ?? []).length;
  const visible = (s.replace(/\s+/g, "").match(/[^\s]/g) ?? []).length;
  if (visible === 0) return 0;
  return letters / visible;
}

function maxRepeatedRun(s: string): number {
  // Long repeated runs are a common “spam / abuse” signal (e.g. 500x 'a' or '=')
  let best = 1;
  let cur = 1;
  for (let i = 1; i < s.length; i++) {
    if (s[i] === s[i - 1]) {
      cur++;
      if (cur > best) best = cur;
    } else {
      cur = 1;
    }
  }
  return best;
}

function stripDisallowedControlChars(s: string): string {
  // Keep common whitespace controls for pasted recipes; drop the rest.
  // - allow: \n \r \t
  // - reject: other ASCII control chars + DEL
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

export const zSearchQuery = z
  .string()
  .superRefine((raw, ctx) => {
    // Validate based on the normalized value (trimmed, safe newlines, no control chars),
    // so callers can't bypass rules with whitespace/control characters.
    const s = normalizeUserText(raw);
    if (s.length < 2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Search must be at least 2 characters" });
    }
    if (s.length > 120) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Search must be at most 120 characters" });
    }
    if (/^https?:\/\//i.test(s)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Paste text, not a URL" });
    }
  })
  .transform(normalizeUserText);

export const zUserRecipeText = z
  .string()
  .superRefine((raw, ctx) => {
    // Keep recipe text permissive (users paste lots of punctuation/newlines),
    // but apply safety limits to protect LLM and DB from abuse.
    const s = stripDisallowedControlChars(normalizeNewlines(raw)).trim();
    // Needs to support full pasted recipes, but must be bounded for LLM + storage.
    if (s.length < 40) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Paste the full recipe text (ingredients + instructions)",
      });
    }
    if (s.length > 40_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Recipe text is too long (max 40,000 characters)",
      });
    }
    if (maxRepeatedRun(s) > 80) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Recipe text looks invalid (too many repeated characters)",
      });
    }
    if (letterRatio(s) < 0.08) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Recipe text looks invalid (not enough readable text)",
      });
    }
  })
  .transform((raw) => stripDisallowedControlChars(normalizeNewlines(raw)).trim());

