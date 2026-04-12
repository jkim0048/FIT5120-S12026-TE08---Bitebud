import { prisma } from "../prisma.js";
import type { RecipeGraph } from "../graph/recipeGraph.js";

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

function normalizeForWickedIndex(value: string): string {
  return value
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function getWickedNameIndex(): Promise<WickedNameIndex> {
  if (!wickedNameIndexPromise) {
    wickedNameIndexPromise = (async () => {
      const rows = await prisma.wickedIcon.findMany({
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

function tokensFromNormalized(value: string): string[] {
  return normalizeForWickedIndex(value).split(" ").filter(Boolean);
}

async function getWickedTokenIndex(): Promise<WickedTokenIndex> {
  if (!wickedTokenIndexPromise) {
    wickedTokenIndexPromise = (async () => {
      const rows = await prisma.wickedIcon.findMany({ select: { id: true, name: true } });
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

function singularizeSimple(value: string): string {
  if (!value) return value;
  if (value.endsWith("ies") && value.length > 3) return value.slice(0, -3) + "y";
  if (value.endsWith("oes") && value.length > 3) return value.slice(0, -2); // tomatoes -> tomato
  if (value.endsWith("ses") && value.length > 3) return value.slice(0, -2);
  if (value.endsWith("s") && !value.endsWith("ss") && value.length > 3) return value.slice(0, -1);
  return value;
}

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

function singularizeWords(key: string): string {
  return key
    .split(" ")
    .map((w) => singularizeSimple(w))
    .join(" ")
    .trim();
}

function lastNounCandidate(cleaned: string): string {
  const parts = cleaned.split(" ").filter(Boolean);
  if (!parts.length) return "";
  // last meaningful token is often the ingredient (e.g. "egg roll wrappers" -> "wrappers")
  return parts.slice(-1).join(" ").trim();
}

function headCandidate(cleaned: string): string {
  return cleaned.split(" ").slice(0, 3).join(" ").trim();
}

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

function absoluteUrl(base: string, maybeRelative: string): string {
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return maybeRelative;
  }
}

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

function iconIdFromUrl(url: string): string {
  const pathname = new URL(url).pathname;
  const base = pathname.split("/").pop() ?? "icon";
  return base.replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9_-]/gi, "-");
}

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
    const name = item.alt || id.replace(/[-_]/g, " ");
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
    await prisma.wickedIcon.upsert({
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

async function fuzzyFindIconIdForKey(key: string): Promise<string | null> {
  const q = key.trim();
  if (!q) return null;
  const parts = q.split(" ").filter(Boolean);
  const tries = [q, parts.slice(-1).join(" "), parts.slice(0, 2).join(" ")]
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
  for (const t of tries) {
    const hit = await prisma.wickedIcon.findFirst({
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

async function exactIconIdFromIndex(key: string): Promise<string | null> {
  const q = normalizeForWickedIndex(key);
  if (!q) return null;
  const idx = await getWickedNameIndex();
  return idx.byNormalizedName.get(q) ?? idx.byNormalizedId.get(q) ?? null;
}

function isSubsetTokens(needles: string[], haystackSet: Set<string>): boolean {
  for (const t of needles) {
    if (!haystackSet.has(t)) return false;
  }
  return true;
}

function isCompoundButterSpreadIcon(iconTokenSet: Set<string>, needles: string[]): boolean {
  if (needles.length !== 1 || needles[0] !== "butter") return false;
  for (const t of iconTokenSet) {
    if (t === "butter") continue;
    if (BUTTER_SPREAD_EXCLUDE_TOKENS.has(t)) return true;
  }
  return false;
}

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

function editDistanceLevenshtein(a: string, b: string, max: number): number {
  // Early exits for performance and safety.
  if (a === b) return 0;
  if (!a || !b) return Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) > max) return max + 1;

  const v0 = new Array<number>(b.length + 1);
  const v1 = new Array<number>(b.length + 1);
  for (let i = 0; i <= b.length; i++) v0[i] = i;

  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    let rowMin = v1[0];
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
      if (v1[j + 1] < rowMin) rowMin = v1[j + 1];
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
  }
  return v0[b.length];
}

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
    for (let i = 2; i <= token.length - 2; i++) {
      const a = token.slice(0, i);
      const b = token.slice(i);
      if (!idx.tokenUniverse.has(a) || !idx.tokenUniverse.has(b)) continue;
      const score = (idx.tokenFreq.get(a) ?? 0) + (idx.tokenFreq.get(b) ?? 0);
      if (!best || score > best.score) best = { parts: [a, b], score, tie: false };
      else if (score === best.score) best.tie = true;
    }

    // 3-part splits (bounded)
    for (let i = 2; i <= token.length - 4; i++) {
      const a = token.slice(0, i);
      if (!idx.tokenUniverse.has(a)) continue;
      for (let j = i + 2; j <= token.length - 2; j++) {
        const b = token.slice(i, j);
        const c = token.slice(j);
        if (!idx.tokenUniverse.has(b) || !idx.tokenUniverse.has(c)) continue;
        const score =
          (idx.tokenFreq.get(a) ?? 0) + (idx.tokenFreq.get(b) ?? 0) + (idx.tokenFreq.get(c) ?? 0);
        if (!best || score > best.score) best = { parts: [a, b, c], score, tie: false };
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

function emojiFallbackForKey(key: string): string {
  for (const c of CATEGORY_FALLBACKS) {
    if (c.match.test(key)) return c.emoji;
  }
  return "•";
}

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
    prisma.ingredientIconMap.findMany({
      where: { ingredientKey: { in: uniqueKeys } },
      select: { ingredientKey: true, wickedIconId: true, emojiFallback: true },
    }),
    userId
      ? prisma.userIconOverride.findMany({
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
          await prisma.ingredientIconMap.upsert({
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
          await prisma.ingredientIconMap.upsert({
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
