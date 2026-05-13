import { iconCatalogDatabase } from "../database/iconCatalogDatabase.js";
import type { RecipeGraph } from "../graph/recipeGraph.js";

/** Canonical source URL for the Wicked food icon catalog (used as the default ingest target). */
export const DEFAULT_WICKED_SOURCE = "https://food.getwicked.app/";

const PREP_WORDS_RX =
  /\b(chopped|diced|minced|grated|shredded|sliced|crushed|ground|fresh|frozen|cooked|raw|boneless|skinless|peeled|seeded|julienned|finely|roughly|thinly|thickly|optional|to taste|taste)\b/g;

const SERVE_PREFIX_RX =
  /\b(to serve|for serving|to garnish|for garnish|for dipping|for brushing)\b/g;

const UNIT_WORDS_RX =
  /\b(cup|cups|tbsp|tablespoon|tablespoons|tsp|teaspoon|teaspoons|g|kg|mg|ml|l|oz|lb|pound|pounds|clove|cloves|slice|slices|pinch|dash|can|cans|package|packages)\b/g;

type WickedNameIndex = {
  byNormalizedName: Map<string, string>;
  byNormalizedId: Map<string, string>;
};

let wickedNameIndexPromise: Promise<WickedNameIndex> | null = null;

type WickedTokenIndex = {
  icons: Array<{
    id: string;
    name: string;
    tokens: string[];
    tokenSet: Set<string>;
    normalized: string;
  }>;
  tokenFreq: Map<string, number>;
  tokenUniverse: Set<string>;
};

let wickedTokenIndexPromise: Promise<WickedTokenIndex> | null = null;

/** Normalize an icon id/name into a stable token-friendly form for indexing and lookups. */
function normalizeForWickedIndex(value: string): string {
  return value
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build (and memoize) a name/id → icon id index from the database.
 *
 * Cached in-process for performance; invalidated after `ingestWickedIcons`.
 */
async function getWickedNameIndex(): Promise<WickedNameIndex> {
  if (!wickedNameIndexPromise) {
    wickedNameIndexPromise = (async () => {
      const rows = await iconCatalogDatabase.wickedIconFindMany({
        select: { id: true, name: true },
      });
      const byNormalizedName = new Map<string, string>();
      const byNormalizedId = new Map<string, string>();
      for (const r of rows) {
        byNormalizedId.set(normalizeForWickedIndex(r.id), r.id);
        if (r.name) {
          byNormalizedName.set(normalizeForWickedIndex(r.name), r.id);
        }
      }
      return { byNormalizedName, byNormalizedId };
    })();
  }
  return wickedNameIndexPromise;
}

/** Split a normalized string into tokens (used for token-subset matching). */
function tokensFromNormalized(value: string): string[] {
  return normalizeForWickedIndex(value).split(" ").filter(Boolean);
}

/**
 * Build (and memoize) a token index for “subset/closest” matching across all Wicked icons.
 *
 * Stores per-icon token sets and token frequencies to break ties deterministically.
 */
async function getWickedTokenIndex(): Promise<WickedTokenIndex> {
  if (!wickedTokenIndexPromise) {
    wickedTokenIndexPromise = (async () => {
      const rows = await iconCatalogDatabase.wickedIconFindMany({ select: { id: true, name: true } });
      const tokenFreq = new Map<string, number>();
      const tokenUniverse = new Set<string>();
      const icons = rows.map((r) => {
        const normalized = normalizeForWickedIndex(`${r.name ?? ""} ${r.id}`);
        const tokens = normalized.split(" ").filter(Boolean);
        const tokenSet = new Set(tokens);
        for (const t of tokenSet) {
          tokenUniverse.add(t);
          tokenFreq.set(t, (tokenFreq.get(t) ?? 0) + 1);
        }
        return { id: r.id, name: r.name, tokens, tokenSet, normalized };
      });
      return { icons, tokenFreq, tokenUniverse };
    })();
  }
  return wickedTokenIndexPromise;
}

const CATEGORY_FALLBACKS: Array<{ match: RegExp; search: string[]; emoji: string }> = [
  { match: /\b(meat|mince|ground beef|beef)\b/, search: ["meat", "beef"], emoji: "🥩" },
  { match: /\b(chicken|poultry)\b/, search: ["chicken"], emoji: "🍗" },
  { match: /\b(fish|seafood|shrimp|prawn|salmon|tuna)\b/, search: ["fish", "shrimp", "seafood"], emoji: "🐟" },
  { match: /\b(vegetable|veg|greens|lettuce|spinach|kale)\b/, search: ["vegetable", "spinach"], emoji: "🥬" },
  { match: /\b(fruit|berry|berries)\b/, search: ["fruit", "berry"], emoji: "🍓" },
  { match: /\b(spice|herb|seasoning|pepper|paprika|cumin|turmeric|coriander)\b/, search: ["spice", "pepper"], emoji: "🧂" },
  { match: /\b(dairy|milk|cheese|butter|yogurt|cream)\b/, search: ["milk", "cheese", "butter"], emoji: "🥛" },
  { match: /\b(pasta|noodle|noodles)\b/, search: ["pasta", "noodle"], emoji: "🍝" },
];

/** Extremely small English plural→singular heuristic used for ingredient key stability. */
function singularizeSimple(value: string): string {
  if (!value) return value;
  if (value.endsWith("ies") && value.length > 3) return value.slice(0, -3) + "y";
  if (value.endsWith("oes") && value.length > 3) return value.slice(0, -2); // tomatoes -> tomato
  if (value.endsWith("ses") && value.length > 3) return value.slice(0, -2);
  if (value.endsWith("s") && !value.endsWith("ss") && value.length > 3) return value.slice(0, -1);
  return value;
}

/**
 * Conservative ingredient-label cleanup used to derive matching keys.
 *
 * Drops quantities/units/prep words/parentheticals and normalizes whitespace; matching happens in later steps.
 */
function basicClean(value: string): string {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\b\d+([./]\d+)?\b/g, " ")
    .replace(UNIT_WORDS_RX, " ")
    .replace(PREP_WORDS_RX, " ")
    .replace(SERVE_PREFIX_RX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Singularize each word in a multi-word key using the simple heuristic. */
function singularizeWords(key: string): string {
  return key
    .split(" ")
    .map((w) => singularizeSimple(w))
    .join(" ")
    .trim();
}

/** Heuristic: last non-empty token often carries the core noun (“egg roll wrappers” → “wrappers”). */
function lastNounCandidate(cleaned: string): string {
  const parts = cleaned.split(" ").filter(Boolean);
  if (!parts.length) return "";
  // last meaningful token is often the ingredient (e.g. "egg roll wrappers" -> "wrappers")
  return parts.slice(-1).join(" ").trim();
}

/** Heuristic: first ~3 tokens often form a useful stable key (“extra virgin olive oil” → “extra virgin olive”). */
function headCandidate(cleaned: string): string {
  return cleaned.split(" ").slice(0, 3).join(" ").trim();
}

/** Heuristic: first token can be a safer fallback for generic-noun phrases (“lemon juice” → “lemon”). */
function firstTokenCandidate(cleaned: string): string {
  return cleaned.split(" ").slice(0, 1).join(" ").trim();
}

const GENERIC_LAST_TOKENS = new Set([
  "juice",
  "sauce",
  "oil",
  "seasoning",
  "mix",
  "paste",
  "powder",
  "extract",
  "stock",
  "broth",
  "water",
  "vinegar",
  "wine",
  "cream",
  // Cuts / shapes — avoid naked keys like "fillet" matching a random fish fillet icon.
  "fillet",
  "steak",
  "chop",
  "medallion",
  "patty",
  "strip",
  "slice",
  "chunk",
  "piece",
  "portion",
  "cut",
  "cube",
]);

/** If `full` contains one of these words, add it as a candidate right after `full` (like the juice rule). */
const FISH_OR_SHELLFISH_TOKEN_RX =
  /\b(salmon|tuna|trout|cod|halibut|mackerel|sardine|anchovy|bass|snapper|perch|sole|flounder|haddock|pollock|tilapia|catfish|swordfish|mahi|octopus|squid|shrimp|prawn|crab|lobster|scallop|mussel|clam|oyster)\b/;

/** Single-token "butter" must not resolve to nut/fruit spreads containing these extra tokens. */
const BUTTER_SPREAD_EXCLUDE_TOKENS = new Set([
  "peanut",
  "almond",
  "apple",
  "cocoa",
  "cookie",
  "cashew",
  "shea",
  "hazelnut",
]);

/** Single-token fish keys (e.g. "salmon" from "smoked salmon fillet") should not pick roe/caviar icons. */
const FISH_ROE_STYLE_EXCLUDE_TOKENS = new Set(["roe", "ikura", "caviar"]);

/** Normalize a raw ingredient label into a stable, human-editable key for DB mappings and overrides. */
export function normalizeIngredientKey(value: string): string {
  const cleaned = basicClean(value);

  if (!cleaned) return cleaned;

  // We keep this stable and simple; algorithmic matching happens later.
  return singularizeWords(headCandidate(cleaned));
}

/** Human-readable title for an `ingredient_icon_map.ingredient_key` (e.g. `dry fish` → `Dry Fish`). */
export function formatIngredientDisplayLabel(ingredientKey: string): string {
  const k = ingredientKey.trim();
  if (!k) return k;
  return k
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Generate candidate mapping keys for a raw ingredient label, ordered from most-specific to safest fallbacks.
 *
 * Adds targeted fallbacks for known patterns (juice/oil/wrappers/fish tokens) and de-duplicates results.
 */
function candidateKeysFromIngredientLabel(value: string): string[] {
  const cleaned = basicClean(value);
  if (!cleaned) return [];

  const full = singularizeWords(cleaned);
  const head = singularizeWords(headCandidate(cleaned));
  const lastRaw = singularizeWords(lastNounCandidate(cleaned));
  const last = GENERIC_LAST_TOKENS.has(lastRaw) ? "" : lastRaw;
  const first = singularizeWords(firstTokenCandidate(cleaned));

  // Prefer the full phrase first, then (non-generic) last noun, then head phrase.
  const candidates = [full, last, head].filter(Boolean);

  const fishMatch = full.match(FISH_OR_SHELLFISH_TOKEN_RX);
  if (fishMatch) {
    const w = singularizeSimple(fishMatch[1]);
    if (w && !candidates.includes(w)) {
      const fullIdx = candidates.indexOf(full);
      if (fullIdx >= 0) candidates.splice(fullIdx + 1, 0, w);
      else candidates.unshift(w);
    }
  }

  // If there is no exact match for the full phrase, our algorithmic resolver will handle
  // joining/splitting/closest-match. But we still want a safe semantic fallback for some
  // patterns where the last noun is generic (e.g. "lemon juice" should try "lemon").
  if (/\bjuice\b/.test(full) && first) {
    candidates.push(first);
  }

  // targeted ingredient fallbacks
  if (candidates.some((c) => /\bwrapper\b|\bwrappers\b/.test(c))) {
    // Prefer a safe, generic wrapper icon before falling back to ultra-generic "wrapper(s)".
    // This helps cases like "egg roll wrappers" land on dumpling wrappers rather than a random specific wrapper.
    if (!candidates.includes("dumpling wrapper")) {
      candidates.splice(1, 0, "dumpling wrapper");
    }
    candidates.push("wrappers");
  }
  if (candidates.some((c) => /\boil\b/.test(c))) {
    candidates.unshift("olive oil");
    candidates.unshift("oil");
  }
  if (candidates.some((c) => /\bduck sauce\b/.test(c))) {
    candidates.unshift("duck sauce");
    candidates.push("sauce");
  }
  if (candidates.some((c) => /\bplum sauce\b/.test(c))) {
    candidates.unshift("plum sauce");
    candidates.push("sauce");
  }
  if (candidates.some((c) => /\bsoy sauce\b/.test(c))) {
    candidates.unshift("soy sauce");
    candidates.push("sauce");
  }

  return [...new Set(candidates)];
}

/** Resolve a possibly-relative URL against a base, returning the original string on parse errors. */
function absoluteUrl(base: string, maybeRelative: string): string {
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return maybeRelative;
  }
}

/** Parse `<img>` tags from HTML and return image candidates (src + alt), resolving relative URLs. */
function parseImgTags(html: string, baseUrl: string): Array<{ src: string; alt: string }> {
  const out: Array<{ src: string; alt: string }> = [];
  const rx =
    /<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*?(?:alt=["']([^"']*)["'])?[^>]*>/gi;
  for (const m of html.matchAll(rx)) {
    const src = absoluteUrl(baseUrl, m[1]);
    const alt = (m[2] ?? "").trim();
    if (!/\.(png|jpe?g|webp|svg)(\?|$)/i.test(src)) continue;
    out.push({ src, alt });
  }
  return out;
}

/** Derive a stable icon id from an image URL filename (strip extension; normalize to `[-a-z0-9_]`). */
function iconIdFromUrl(url: string): string {
  const pathname = new URL(url).pathname;
  const base = pathname.split("/").pop() ?? "icon";
  return base.replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9_-]/gi, "-");
}

function isGenericWickedAltLabel(alt: string): boolean {
  const a = alt.trim().toLowerCase();
  if (!a) return true;
  // The Wicked landing page often uses a generic `alt` for all icons.
  if (a === "wicked food icon") return true;
  if (/\bwicked\b/.test(a) && /\bicon\b/.test(a) && a.length <= 40) return true;
  return false;
}

/**
 * Ingest icons from the Wicked source page by scraping `<img>` tags and upserting rows into Prisma.
 *
 * Optionally downloads and stores binary assets; invalidates in-process indexes on completion.
 */
export async function ingestWickedIcons(opts?: {
  sourceUrl?: string;
  limit?: number;
  includeAssets?: boolean;
}): Promise<{ discovered: number; upserted: number; withAssets: number }> {
  const sourceUrl = opts?.sourceUrl ?? DEFAULT_WICKED_SOURCE;
  const includeAssets = opts?.includeAssets ?? true;
  const limit = opts?.limit ?? 600;
  const htmlRes = await fetch(sourceUrl);
  if (!htmlRes.ok) {
    throw new Error(`Failed to fetch icon source: ${htmlRes.status}`);
  }
  const html = await htmlRes.text();
  const imgs = parseImgTags(html, sourceUrl).slice(0, limit);
  let upserted = 0;
  let withAssets = 0;
  for (const item of imgs) {
    const id = iconIdFromUrl(item.src);
    const alt = (item.alt ?? "").trim();
    const name = !isGenericWickedAltLabel(alt) ? alt : id.replace(/[-_]/g, " ");
    let asset: Buffer | null = null;
    if (includeAssets) {
      try {
        const ir = await fetch(item.src);
        if (ir.ok) {
          const ab = await ir.arrayBuffer();
          asset = Buffer.from(ab);
        }
      } catch {
        asset = null;
      }
    }
    await iconCatalogDatabase.wickedIconUpsert({
      where: { id },
      create: {
        id,
        name,
        imageUrl: item.src,
        asset: asset ?? undefined,
      },
      update: {
        name,
        imageUrl: item.src,
        ...(asset ? { asset } : {}),
      },
    });
    upserted += 1;
    if (asset) withAssets += 1;
  }
  // Invalidate in-process indexes so subsequent lookups see new/updated icons.
  wickedNameIndexPromise = null;
  wickedTokenIndexPromise = null;
  return { discovered: imgs.length, upserted, withAssets };
}

/** Best-effort fuzzy DB lookup by partial id/name contains (used as an escape hatch; not the primary matcher). */
async function fuzzyFindIconIdForKey(key: string): Promise<string | null> {
  const q = key.trim();
  if (!q) return null;
  const parts = q.split(" ").filter(Boolean);
  const tries = [q, parts.slice(-1).join(" "), parts.slice(0, 2).join(" ")]
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
  for (const t of tries) {
    const hit = await iconCatalogDatabase.wickedIconFindFirst({
      where: {
        OR: [
          { id: { contains: t.replace(/\s+/g, "-"), mode: "insensitive" } },
          { name: { contains: t, mode: "insensitive" } },
        ],
      },
      select: { id: true },
      orderBy: { name: "asc" },
    });
    if (hit?.id) return hit.id;
  }
  return null;
}

/** Resolve an icon id from the exact name/id index (fast path for stable keys). */
async function exactIconIdFromIndex(key: string): Promise<string | null> {
  const q = normalizeForWickedIndex(key);
  if (!q) return null;
  const idx = await getWickedNameIndex();
  return idx.byNormalizedName.get(q) ?? idx.byNormalizedId.get(q) ?? null;
}

/** Check whether all needle tokens exist in the haystack token set. */
function isSubsetTokens(needles: string[], haystackSet: Set<string>): boolean {
  for (const t of needles) {
    if (!haystackSet.has(t)) return false;
  }
  return true;
}

/** Guardrail: “butter” should not match compound spreads like “peanut butter” icons. */
function isCompoundButterSpreadIcon(iconTokenSet: Set<string>, needles: string[]): boolean {
  if (needles.length !== 1 || needles[0] !== "butter") return false;
  for (const t of iconTokenSet) {
    if (t === "butter") continue;
    if (BUTTER_SPREAD_EXCLUDE_TOKENS.has(t)) return true;
  }
  return false;
}

/** Guardrail: single-token fish matches should not select roe/caviar-style icons. */
function isRoeOrCaviarFishIcon(iconTokenSet: Set<string>, needles: string[]): boolean {
  if (needles.length !== 1) return false;
  const primary = needles[0];
  if (!primary || !FISH_OR_SHELLFISH_TOKEN_RX.test(primary)) return false;
  for (const t of iconTokenSet) {
    if (t === primary) continue;
    if (FISH_ROE_STYLE_EXCLUDE_TOKENS.has(t)) return true;
  }
  return false;
}

/**
 * Find the “closest” icon whose tokens are a superset of the query tokens.
 *
 * Uses tie-breakers (fewest extra tokens, smaller token set, token popularity, shorter normalized string, then id)
 * and applies a couple of safety exclusions to avoid common wrong matches.
 */
async function tokenSubsetClosestIconIdForKey(key: string): Promise<string | null> {
  const needles = tokensFromNormalized(key);
  if (!needles.length) return null;
  const idx = await getWickedTokenIndex();

  let best:
    | { id: string; extraTokens: number; totalTokens: number; popularity: number; normalizedLen: number }
    | null = null;
  for (const icon of idx.icons) {
    if (!isSubsetTokens(needles, icon.tokenSet)) continue;
    if (isCompoundButterSpreadIcon(icon.tokenSet, needles)) continue;
    if (isRoeOrCaviarFishIcon(icon.tokenSet, needles)) continue;
    const extraTokens = icon.tokenSet.size - needles.length;
    const totalTokens = icon.tokenSet.size;
    let popularity = 0;
    for (const t of icon.tokenSet) {
      popularity += idx.tokenFreq.get(t) ?? 0;
    }
    const normalizedLen = icon.normalized.length;
    if (
      !best ||
      extraTokens < best.extraTokens ||
      (extraTokens === best.extraTokens && totalTokens < best.totalTokens) ||
      (extraTokens === best.extraTokens && totalTokens === best.totalTokens && popularity > best.popularity) ||
      (extraTokens === best.extraTokens && totalTokens === best.totalTokens && normalizedLen < best.normalizedLen) ||
      (extraTokens === best.extraTokens &&
        totalTokens === best.totalTokens &&
        normalizedLen === best.normalizedLen &&
        icon.id < best.id)
    ) {
      best = { id: icon.id, extraTokens, totalTokens, popularity, normalizedLen };
    }
  }
  return best?.id ?? null;
}

/** Levenshtein edit distance with an upper bound (`max`) for early exit (used for conservative typo repair). */
function editDistanceLevenshtein(a: string, b: string, max: number): number {
  // Early exits for performance and safety.
  if (a === b) return 0;
  if (!a || !b) return Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) > max) return max + 1;

  const v0 = new Array<number>(b.length + 1);
  const v1 = new Array<number>(b.length + 1);
  for (let columnIndex = 0; columnIndex <= b.length; columnIndex++) v0[columnIndex] = columnIndex;

  for (let sourceIndex = 0; sourceIndex < a.length; sourceIndex++) {
    v1[0] = sourceIndex + 1;
    let rowMin = v1[0];
    for (let targetIndex = 0; targetIndex < b.length; targetIndex++) {
      const cost = a[sourceIndex] === b[targetIndex] ? 0 : 1;
      v1[targetIndex + 1] = Math.min(v1[targetIndex] + 1, v0[targetIndex + 1] + 1, v0[targetIndex] + cost);
      if (v1[targetIndex + 1] < rowMin) rowMin = v1[targetIndex + 1];
    }
    if (rowMin > max) return max + 1;
    for (let columnIndex = 0; columnIndex <= b.length; columnIndex++) v0[columnIndex] = v1[columnIndex];
  }
  return v0[b.length];
}

/**
 * Conservatively “repair” unknown tokens by splitting joined words or applying small edit-distance corrections.
 *
 * This is intentionally bounded to avoid over-matching; it only triggers when there is a clear single winner.
 */
async function repairKeyTokensConservatively(key: string): Promise<string> {
  const tokens = tokensFromNormalized(key);
  if (!tokens.length) return key;
  const idx = await getWickedTokenIndex();

  function bestSplitToken(token: string): string[] | null {
    // Try to split unknown joined tokens (e.g. "hotsauce" -> ["hot","sauce"]).
    // Only attempt for longer tokens to reduce false positives.
    if (token.length < 6) return null;
    if (idx.tokenUniverse.has(token)) return null;

    let best: { parts: string[]; score: number; tie: boolean } | null = null;

    // 2-part splits
    for (let firstSplitAt = 2; firstSplitAt <= token.length - 2; firstSplitAt++) {
      const firstPart = token.slice(0, firstSplitAt);
      const secondPart = token.slice(firstSplitAt);
      if (!idx.tokenUniverse.has(firstPart) || !idx.tokenUniverse.has(secondPart)) continue;
      const score = (idx.tokenFreq.get(firstPart) ?? 0) + (idx.tokenFreq.get(secondPart) ?? 0);
      if (!best || score > best.score) best = { parts: [firstPart, secondPart], score, tie: false };
      else if (score === best.score) best.tie = true;
    }

    // 3-part splits (bounded)
    for (let firstSplitAt = 2; firstSplitAt <= token.length - 4; firstSplitAt++) {
      const firstPart = token.slice(0, firstSplitAt);
      if (!idx.tokenUniverse.has(firstPart)) continue;
      for (let secondSplitAt = firstSplitAt + 2; secondSplitAt <= token.length - 2; secondSplitAt++) {
        const secondPart = token.slice(firstSplitAt, secondSplitAt);
        const thirdPart = token.slice(secondSplitAt);
        if (!idx.tokenUniverse.has(secondPart) || !idx.tokenUniverse.has(thirdPart)) continue;
        const score =
          (idx.tokenFreq.get(firstPart) ?? 0) + (idx.tokenFreq.get(secondPart) ?? 0) + (idx.tokenFreq.get(thirdPart) ?? 0);
        if (!best || score > best.score) best = { parts: [firstPart, secondPart, thirdPart], score, tie: false };
        else if (score === best.score) best.tie = true;
      }
    }

    if (!best || best.tie) return null;
    return best.parts;
  }

  const repaired: string[] = [];
  for (const t of tokens) {
    // Avoid “repairing” very short tokens; too risky.
    const split = bestSplitToken(t);
    if (split) {
      repaired.push(...split);
      continue;
    }

    if (t.length < 4 || idx.tokenUniverse.has(t)) {
      repaired.push(t);
      continue;
    }

    const max = t.length <= 5 ? 1 : 2;
    const prefixLen = t.length >= 6 ? 2 : 1;
    const prefix = t.slice(0, prefixLen);

    let bestToken: string | null = null;
    let bestDist = max + 1;
    let bestFreq = -1;
    let tie = false;

    for (const cand of idx.tokenUniverse) {
      if (cand.length < 4) continue;
      if (!cand.startsWith(prefix)) continue;
      if (Math.abs(cand.length - t.length) > 2) continue;
      const d = editDistanceLevenshtein(t, cand, max);
      if (d > max) continue;

      const freq = idx.tokenFreq.get(cand) ?? 0;
      if (d < bestDist || (d === bestDist && freq > bestFreq)) {
        bestToken = cand;
        bestDist = d;
        bestFreq = freq;
        tie = false;
      } else if (d === bestDist && freq === bestFreq) {
        tie = true;
      }
    }

    // Only apply if we have a clear winner.
    if (bestToken && !tie) repaired.push(bestToken);
    else repaired.push(t);
  }

  return repaired.join(" ").trim();
}

/**
 * Debug helper to show how an ingredient label resolves to an icon (candidates, chosen key, method).
 *
 * Useful for building/admin tooling and for spot-checking matching heuristics without mutating DB mappings.
 */
export async function debugResolveWickedIconForIngredientLabel(
  label: string,
): Promise<{
  candidates: string[];
  chosenKey: string | null;
  iconId: string | null;
  repairedKey?: string;
  method: "exact" | "closest" | "closest_repaired" | "none";
}> {
  const candidates = candidateKeysFromIngredientLabel(label);
  for (const key of candidates) {
    const exact = await exactIconIdFromIndex(key);
    if (exact) return { candidates, chosenKey: key, iconId: exact, method: "exact" };

    const closest = await tokenSubsetClosestIconIdForKey(key);
    if (closest) return { candidates, chosenKey: key, iconId: closest, method: "closest" };

    const repairedKey = await repairKeyTokensConservatively(key);
    if (repairedKey && repairedKey !== key) {
      const repairedClosest = await tokenSubsetClosestIconIdForKey(repairedKey);
      if (repairedClosest) {
        return { candidates, chosenKey: key, iconId: repairedClosest, repairedKey, method: "closest_repaired" };
      }
    }
  }
  return { candidates, chosenKey: candidates[0] ?? null, iconId: null, method: "none" };
}

/** Choose a coarse emoji fallback for a key when no Wicked icon mapping is available. */
function emojiFallbackForKey(key: string): string {
  for (const c of CATEGORY_FALLBACKS) {
    if (c.match.test(key)) return c.emoji;
  }
  return "•";
}

/**
 * Apply ingredient icon mappings to a recipe graph.
 *
 * For each ingredient node, chooses the best key from candidate keys, checks user overrides, then existing DB maps,
 * and finally infers/persists a best-effort Wicked icon id (best-effort DB upserts; skips nodes with `imageUrl`).
 */
export async function applyIconMappings(
  graph: RecipeGraph,
  userId?: string | null,
): Promise<RecipeGraph> {
  const ingredientNodes = graph.nodes.filter((n) => n.type === "ingredient");
  if (!ingredientNodes.length) return graph;
  const candidatesById = new Map<string, string[]>();
  const allKeys: string[] = [];
  for (const n of ingredientNodes) {
    const candidates = candidateKeysFromIngredientLabel(n.label || n.detail || "");
    candidatesById.set(n.id, candidates);
    allKeys.push(...candidates);
  }
  const uniqueKeys = [...new Set(allKeys.filter(Boolean))];
  const [maps, overrides] = await Promise.all([
    iconCatalogDatabase.ingredientIconMapFindMany({
      where: { ingredientKey: { in: uniqueKeys } },
      select: { ingredientKey: true, wickedIconId: true, emojiFallback: true },
    }),
    userId
      ? iconCatalogDatabase.userIconOverrideFindMany({
          where: { userId, ingredientKey: { in: uniqueKeys } },
          select: { ingredientKey: true, wickedIconId: true, emojiFallback: true },
        })
      : Promise.resolve([]),
  ]);
  const mapByKey = new Map(maps.map((m) => [m.ingredientKey, m]));
  const overrideByKey = new Map(overrides.map((o) => [o.ingredientKey, o]));

  const inferredByKey = new Map<string, { wickedIconId: string; emojiFallback?: string | null }>();

  async function inferForCandidates(
    candidates: string[],
  ): Promise<{ key: string; wickedIconId: string; emojiFallback: string } | null> {
    for (const key of candidates) {
      if (!key) continue;
      const exact = await exactIconIdFromIndex(key);
      if (exact) {
        const emojiFallback = emojiFallbackForKey(key);
        inferredByKey.set(key, { wickedIconId: exact, emojiFallback });
        try {
          await iconCatalogDatabase.ingredientIconMapUpsert({
            where: { ingredientKey: key },
            create: { ingredientKey: key, wickedIconId: exact, emojiFallback },
            update: { wickedIconId: exact, emojiFallback },
          });
        } catch {
          // best-effort only
        }
        return { key, wickedIconId: exact, emojiFallback };
      }
      if (inferredByKey.has(key)) {
        const existing = inferredByKey.get(key)!;
        if (existing.wickedIconId) {
          return {
            key,
            wickedIconId: existing.wickedIconId,
            emojiFallback: String(existing.emojiFallback ?? emojiFallbackForKey(key)),
          };
        }
      }
      // Closest match by token-subset (no fuzzy).
      let iconId: string | null = await tokenSubsetClosestIconIdForKey(key);
      if (!iconId) {
        // Conservative typo repair, then re-try subset matching.
        const repaired = await repairKeyTokensConservatively(key);
        if (repaired && repaired !== key) {
          iconId = await tokenSubsetClosestIconIdForKey(repaired);
        }
      }
      const emojiFallback = emojiFallbackForKey(key);
      if (iconId) {
        inferredByKey.set(key, { wickedIconId: iconId, emojiFallback });
        // Persist under the meaningful candidate key we actually used.
        try {
          await iconCatalogDatabase.ingredientIconMapUpsert({
            where: { ingredientKey: key },
            create: { ingredientKey: key, wickedIconId: iconId, emojiFallback },
            update: { wickedIconId: iconId, emojiFallback },
          });
        } catch {
          // best-effort only
        }
        return { key, wickedIconId: iconId, emojiFallback };
      }
    }
    return null;
  }

  function pickBestKeyForNode(nodeId: string): string {
    const candidates = candidatesById.get(nodeId) ?? [];
    // Prefer an override key if present, then existing map, then inferred.
    for (const k of candidates) if (overrideByKey.has(k)) return k;
    for (const k of candidates) if (mapByKey.has(k)) return k;
    return candidates[0] ?? "";
  }

  const nodes = [];
  for (const n of graph.nodes) {
    if (n.type !== "ingredient") {
      nodes.push(n);
      continue;
    }
    // If an ingredient already has an explicit image URL (e.g. TheMealDB imports),
    // do not infer/persist Wicked icon mappings for it.
    if (n.imageUrl) {
      nodes.push({ ...n, icon: undefined });
      continue;
    }
    const candidates = candidatesById.get(n.id) ?? [];
    const bestKey = pickBestKeyForNode(n.id);
    const base = mapByKey.get(bestKey);
    const over = overrideByKey.get(bestKey);

    let inferred: { wickedIconId: string; emojiFallback?: string | null } | null = null;
    if (!over?.wickedIconId && !base?.wickedIconId) {
      const inferredHit = await inferForCandidates(candidates);
      if (inferredHit) inferred = inferredByKey.get(inferredHit.key) ?? null;
    } else {
      inferred = inferredByKey.get(bestKey) ?? null;
    }

    const icon =
      over?.wickedIconId ??
      base?.wickedIconId ??
      inferred?.wickedIconId ??
      n.icon;
    const emoji =
      over?.emojiFallback ??
      base?.emojiFallback ??
      inferred?.emojiFallback ??
      n.emoji ??
      emojiFallbackForKey(bestKey);
    nodes.push({ ...n, icon: icon ?? undefined, emoji: emoji ?? n.emoji });
  }

  return {
    ...graph,
    nodes,
  };
}
