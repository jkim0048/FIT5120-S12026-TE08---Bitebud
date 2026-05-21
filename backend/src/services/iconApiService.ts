import { iconCatalogDatabase } from "../database/iconCatalogDatabase.js";
import {
  DEFAULT_WICKED_SOURCE,
  formatIngredientDisplayLabel,
  ingestWickedIcons,
  normalizeIngredientKey,
} from "./icons.js";
import {
  WICKED_CATALOG_RESYNC_MS,
  WICKED_ICON_PROXY_MAX_BYTES,
  WICKED_PICKER_INGEST_LIMIT,
  WICKED_PICKER_PAGE_SIZE,
  WICKED_SEARCH_DEFAULT_LIMIT,
  contentTypeForWickedIcon,
  isWickedImageHost,
} from "./iconRouteHelpers.js";

const WICKED_PICKER_LABEL_MAX_LENGTH = 120;
let lastWickedCatalogIngestAt = Date.now();
let wickedCatalogIngestInFlight: Promise<void> | null = null;

export type PickerUnavailable = { kind: "unavailable"; message: string };
export type PickerError = { kind: "error"; message: string };

type WickedIconPickerRow = {
  id: string;
  name: string;
  category: string | null;
  imageUrl: string | null;
};

function mapWickedIconRowToPickerItem(row: WickedIconPickerRow) {
  const label = (row.name?.trim() || row.id.replace(/-/g, " ")).slice(0, WICKED_PICKER_LABEL_MAX_LENGTH);
  const hint = row.category?.trim() ?? "";
  return {
    wickedIconId: row.id,
    label,
    hint,
    imageUrl: row.imageUrl,
  };
}

/** Refresh catalog from food.getwicked.app without blocking API responses. */
function scheduleWickedCatalogRefresh(): void {
  if (wickedCatalogIngestInFlight) return;
  wickedCatalogIngestInFlight = ingestWickedIcons({
    sourceUrl: DEFAULT_WICKED_SOURCE,
    limit: WICKED_PICKER_INGEST_LIMIT,
    includeAssets: false,
  })
    .then(() => {
      lastWickedCatalogIngestAt = Date.now();
    })
    .catch(() => {
      /* keep serving DB rows; retry on next stale window */
    })
    .finally(() => {
      wickedCatalogIngestInFlight = null;
    });
}

/** Wicked icon list for the Food Safety Tags picker (legacy bulk load; prefer search). */
export async function getWickedPickerItems() {
  try {
    let count = await iconCatalogDatabase.wickedIconCount();
    const stale = Date.now() - lastWickedCatalogIngestAt >= WICKED_CATALOG_RESYNC_MS;
    if (count === 0) {
      await ingestWickedIcons({
        sourceUrl: DEFAULT_WICKED_SOURCE,
        limit: WICKED_PICKER_INGEST_LIMIT,
        includeAssets: false,
      });
      lastWickedCatalogIngestAt = Date.now();
      count = await iconCatalogDatabase.wickedIconCount();
    } else if (stale) {
      scheduleWickedCatalogRefresh();
    }
    if (count === 0) {
      return {
        kind: "unavailable",
        message:
          "No Wicked icons in the database and ingest returned nothing. Check network access to food.getwicked.app.",
      } as PickerUnavailable;
    }
    const rows = await iconCatalogDatabase.wickedIconFindMany({
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: WICKED_PICKER_PAGE_SIZE,
      select: { id: true, name: true, category: true, imageUrl: true },
    });
    return { items: rows.map(mapWickedIconRowToPickerItem) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Wicked picker failed";
    return { kind: "error", message } as PickerError;
  }
}

/** Legacy ingredient → icon map for older sensory items. */
export async function listIngredientIconMap() {
  const rows = await iconCatalogDatabase.ingredientIconMapFindMany({
    orderBy: { ingredientKey: "asc" },
    select: {
      ingredientKey: true,
      emojiFallback: true,
      wickedIcon: { select: { name: true } },
    },
  });
  return {
    items: rows.map((row) => {
      const label = formatIngredientDisplayLabel(row.ingredientKey);
      const emoji = row.emojiFallback?.trim() || "🍽️";
      const hint = row.wickedIcon?.name?.trim() || label;
      return { ingredientKey: row.ingredientKey, label, emoji, hint };
    }),
  };
}

/** Search the Wicked icon catalog by id or display name (indexed id lookup + prefix/name contains). */
export async function searchWickedIcons(query: string | undefined, limit?: number) {
  const q = query?.trim() ?? "";
  const take = limit ?? WICKED_SEARCH_DEFAULT_LIMIT;
  if (!q) {
    return { icons: [] as WickedIconPickerRow[] };
  }

  const select = { id: true, name: true, imageUrl: true, category: true } as const;
  const exact = await iconCatalogDatabase.wickedIconFindUnique({
    where: { id: q },
    select,
  });
  if (exact) {
    return { icons: [exact] };
  }

  const rows = await iconCatalogDatabase.wickedIconFindMany({
    where: {
      OR: [
        { name: { startsWith: q, mode: "insensitive" } },
        { id: { startsWith: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { id: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take,
    select,
  });
  return { icons: rows };
}

/** Food-tag picker search — same shape as wicked-picker rows, small page size. */
export async function searchWickedPickerItems(query: string, limit?: number) {
  const { icons } = await searchWickedIcons(query, limit ?? WICKED_SEARCH_DEFAULT_LIMIT);
  return { items: icons.map(mapWickedIconRowToPickerItem) };
}

export type IconNotFound = { kind: "not_found" };
export type IconUpstreamError = { kind: "upstream_error"; message: string };
export type IconTooLarge = { kind: "too_large" };

export type WickedIconAsset =
  | { kind: "buffer"; buffer: Buffer; contentType: string }
  | IconNotFound
  | IconUpstreamError
  | IconTooLarge;

/** Serve a Wicked icon from DB bytes or a size-capped upstream proxy fetch. */
export async function fetchWickedIconAsset(iconId: string): Promise<WickedIconAsset> {
  const row = await iconCatalogDatabase.wickedIconFindUnique({
    where: { id: iconId },
    select: { asset: true, imageUrl: true },
  });
  if (!row) return { kind: "not_found" };

  if (row.asset?.length) {
    const assetBuffer = Buffer.from(row.asset);
    const contentType = contentTypeForWickedIcon(row.imageUrl ?? null, null);
    return { kind: "buffer", buffer: assetBuffer, contentType };
  }

  const imageUrl = row.imageUrl?.trim();
  if (!imageUrl) return { kind: "not_found" };
  if (!isWickedImageHost(imageUrl)) return { kind: "not_found" };

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(imageUrl, {
      redirect: "follow",
      headers: { Accept: "image/*,*/*;q=0.8" },
    });
  } catch {
    return { kind: "upstream_error", message: "Upstream fetch failed" };
  }
  if (!upstreamResponse.ok) {
    return { kind: "upstream_error", message: "Upstream returned error" };
  }

  const declaredLength = upstreamResponse.headers.get("content-length");
  if (declaredLength && Number.parseInt(declaredLength, 10) > WICKED_ICON_PROXY_MAX_BYTES) {
    return { kind: "too_large" };
  }

  const upstreamBytes = await upstreamResponse.arrayBuffer();
  if (upstreamBytes.byteLength > WICKED_ICON_PROXY_MAX_BYTES) {
    return { kind: "too_large" };
  }

  const assetBuffer = Buffer.from(upstreamBytes);
  if (!isWickedImageHost(upstreamResponse.url)) {
    return { kind: "not_found" };
  }

  const contentType = contentTypeForWickedIcon(
    imageUrl,
    upstreamResponse.headers.get("content-type"),
  );
  return { kind: "buffer", buffer: assetBuffer, contentType };
}

export type OverrideIconNotFound = { kind: "icon_not_found" };

/** Upsert a per-user ingredient → Wicked icon (or emoji) override. */
export async function upsertIconOverride(
  userId: string,
  body: {
    ingredientKey: string;
    wickedIconId?: string | null;
    emojiFallback?: string | null;
  },
) {
  const ingredientKey = normalizeIngredientKey(body.ingredientKey);
  if (!ingredientKey) return { kind: "empty_key" as const };
  if (body.wickedIconId) {
    const icon = await iconCatalogDatabase.wickedIconFindUnique({
      where: { id: body.wickedIconId },
    });
    if (!icon) return { kind: "icon_not_found" } as OverrideIconNotFound;
  }
  await iconCatalogDatabase.userIconOverrideUpsert({
    where: { userId_ingredientKey: { userId, ingredientKey } },
    create: {
      userId,
      ingredientKey,
      wickedIconId: body.wickedIconId ?? null,
      emojiFallback: body.emojiFallback ?? null,
    },
    update: {
      wickedIconId: body.wickedIconId ?? null,
      emojiFallback: body.emojiFallback ?? null,
    },
  });
  return { ok: true };
}

/** Fetch the current user's override for one normalized ingredient key. */
export async function getIconOverride(userId: string, ingredient: string) {
  const ingredientKey = normalizeIngredientKey(ingredient);
  const row = await iconCatalogDatabase.userIconOverrideFindUnique({
    where: { userId_ingredientKey: { userId, ingredientKey } },
    select: { wickedIconId: true, emojiFallback: true },
  });
  return { ingredientKey, override: row ?? null };
}
