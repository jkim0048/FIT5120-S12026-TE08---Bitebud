import { z } from "zod";
import { DEFAULT_WICKED_SOURCE } from "./icons.js";

/** Re-fetch catalog from food.getwicked.app at most this often (names + image URLs; no binary assets). */
export const WICKED_CATALOG_RESYNC_MS = 60 * 60 * 1000;

/** Hard cap on bytes proxied back from upstream Wicked image hosts. */
export const WICKED_ICON_PROXY_MAX_BYTES = 5 * 1024 * 1024;

/** Default page size for the `/api/icons/wicked-picker` response. */
export const WICKED_PICKER_PAGE_SIZE = 2500;

/** Auto-ingest window used by `/api/icons/wicked-picker` when the catalog is empty. */
export const WICKED_PICKER_INGEST_LIMIT = 800;

/** Default page size for the `/api/icons/wicked` search response. */
export const WICKED_SEARCH_DEFAULT_LIMIT = 30;

/** Body schema for `PUT /api/icons/overrides`: per-user ingredient → icon override mapping. */
export const wickedOverrideBody = z.object({
  ingredientKey: z.string().min(1),
  wickedIconId: z.string().optional().nullable(),
  emojiFallback: z.string().max(8).optional().nullable(),
});

/** Body schema for `POST /api/icons/wicked/ingest`: source url + limit + asset toggle. */
export const wickedIngestBody = z.object({
  sourceUrl: z.string().url().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  includeAssets: z.boolean().optional(),
});

/** Query schema for `GET /api/icons/wicked`: free-text + result-count cap. */
export const wickedSearchQuery = z.object({
  query: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** True when `urlStr` is a host we ingested from Wicked (prevents SSRF if `image_url` was tampered with). */
export function isWickedImageHost(urlStr: string): boolean {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlStr.trim());
  } catch {
    return false;
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") return false;
  const host = parsedUrl.hostname.toLowerCase();
  const baseHost = new URL(DEFAULT_WICKED_SOURCE).hostname.toLowerCase();
  return host === baseHost || host.endsWith(`.${baseHost}`) || host.endsWith(".getwicked.app");
}

/** Pick the right `Content-Type` header for a Wicked icon, preferring upstream then file extension. */
export function contentTypeForWickedIcon(
  imageUrl: string | null,
  upstreamHeader: string | null,
): string {
  const upstreamType = upstreamHeader?.split(";")[0]?.trim();
  if (upstreamType && /^image\//i.test(upstreamType)) return upstreamType;
  const path = (() => {
    try {
      return new URL(imageUrl ?? "").pathname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  return "image/png";
}
