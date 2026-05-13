export type NominatimSearchItem = {
  place_id?: number;
  osm_type?: string;
  osm_id?: number | string;
  /** Legacy Nominatim field; jsonv2 uses `category` instead. */
  class?: string;
  category?: string;
  type?: string;
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  extratags?: Record<string, string>;
  address?: Record<string, string>;
};

/** Rough mainland AU + Tasmania bbox for Nominatim viewbox (west, north, east, south). */
export const AUSTRALIA_VIEWBOX = "112.9,-10.3,154.0,-43.8";

/** Max distance (km) from user pin when GPS is used — keep shortlist truly local. */
export const NEARBY_RADIUS_KM = 15;

const EARTH_RADIUS_KM = 6371;
const DEFAULT_NOMINATIM_LIMIT = 8;
const DEFAULT_NOMINATIM_TIMEOUT_MS = 6500;
const VIEWBOX_DELTA_DEGREES = 0.14;
const AU_LATITUDE_NORTH = -9;
const AU_LATITUDE_SOUTH = -48;
const AU_LONGITUDE_WEST = 108;
const AU_LONGITUDE_EAST = 162;
const GREAT_MATCH_THRESHOLD = 4.2;
const GOOD_MATCH_THRESHOLD = 3.2;
const NOMINATIM_USER_AGENT =
  "BiteBud/1.0 (https://github.com/jkim0048/FIT5120-S12026-TE08---Bitebud; sensory restaurant search; AU-only)";

/** Return the legacy `class` or jsonv2 `category` field for a Nominatim hit (lowercase). */
export function nominatimClass(item: NominatimSearchItem): string {
  return (item.class ?? item.category ?? "").toLowerCase();
}

/** Drop nominatim hits clearly outside Australia (stray global matches). */
export function isInAustralia(lat: number, lon: number): boolean {
  return (
    lat <= AU_LATITUDE_NORTH &&
    lat >= AU_LATITUDE_SOUTH &&
    lon >= AU_LONGITUDE_WEST &&
    lon <= AU_LONGITUDE_EAST
  );
}

/** Best-effort suburb label from a Nominatim address object. */
export function toSuburb(address?: Record<string, string>): string | undefined {
  if (!address) return undefined;
  return (
    address.suburb ||
    address.neighbourhood ||
    address.city_district ||
    address.city ||
    address.town
  );
}

/** Human badge for an overall comfort score. */
export function comfortBadge(overall: number): "Great match" | "Good match" | "Mixed" {
  if (overall >= GREAT_MATCH_THRESHOLD) return "Great match";
  if (overall >= GOOD_MATCH_THRESHOLD) return "Good match";
  return "Mixed";
}

/** Great-circle distance in kilometres between two latitude/longitude points. */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const aLatRad = (aLat * Math.PI) / 180;
  const bLatRad = (bLat * Math.PI) / 180;
  const haversine =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(aLatRad) * Math.cos(bLatRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(haversine));
}

/** Return `value` trimmed when it's a non-empty string, otherwise null. */
export function maybeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Lowercase, alphanumeric-only form of a place name (used to dedupe across sources). */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Deterministic key combining normalised name and rounded coordinates (used to dedupe). */
export function dedupeKey(name: string, lat?: number, lon?: number): string {
  const latKey = typeof lat === "number" ? lat.toFixed(2) : "na";
  const lonKey = typeof lon === "number" ? lon.toFixed(2) : "na";
  return `${normalizeName(name)}:${latKey}:${lonKey}`;
}

/** Keep only Nominatim hits that represent food places we want to show. */
export function isAllowedNominatimPlace(item: NominatimSearchItem): boolean {
  const itemClass = nominatimClass(item);
  const itemType = (item.type ?? "").toLowerCase();
  if (itemType === "fuel" || itemType === "charging_station" || itemType === "car_wash") {
    return false;
  }
  const foodLikeTypes = new Set([
    "restaurant",
    "cafe",
    "food_court",
    "bakery",
    "fast_food",
    "ice_cream",
    "pub",
    "biergarten",
    "meal_takeaway",
    "bar",
  ]);
  if (foodLikeTypes.has(itemType)) return true;
  return itemClass === "shop" && itemType === "bakery";
}

/** Keep only Nominatim hits that read as actual places (suburb/town/postcode/etc.) for location autocomplete. */
export function isUsefulLocationSuggestItem(item: NominatimSearchItem): boolean {
  const itemClass = nominatimClass(item);
  const itemType = (item.type ?? "").toLowerCase();
  if (
    itemClass === "highway" ||
    itemClass === "shop" ||
    itemClass === "amenity" ||
    itemClass === "building"
  ) {
    return false;
  }
  if (itemType === "state" || itemType === "country" || itemType === "region" || itemType === "continent") {
    return false;
  }
  const address = item.address;
  if (itemType === "administrative") {
    return Boolean(
      maybeString(address?.suburb) ||
        maybeString(address?.city) ||
        maybeString(address?.town) ||
        maybeString(address?.municipality) ||
        maybeString(address?.postcode),
    );
  }
  const goodTypes = new Set([
    "suburb",
    "neighbourhood",
    "city",
    "city_district",
    "town",
    "village",
    "locality",
    "postcode",
    "quarter",
    "district",
    "hamlet",
    "municipality",
    "borough",
  ]);
  return goodTypes.has(itemType);
}

/** Pick the best label for use as a future area search seed (e.g. saved as `Carlton`). */
export function suburbForAreaSearch(item: NominatimSearchItem): string {
  const address = item.address;
  const fromAddress =
    maybeString(toSuburb(address)) ||
    maybeString(address?.city) ||
    maybeString(address?.town) ||
    maybeString(address?.municipality);
  if (fromAddress) return fromAddress;
  const itemType = (item.type ?? "").toLowerCase();
  if (itemType === "postcode" && item.name) return String(item.name).trim();
  return maybeString(item.name) ?? "";
}

export type NominatimSearchResult = {
  items: NominatimSearchItem[];
  warning?: { code: string; error: string };
};

/** Hit Nominatim with a single search query, returning a parsed result + transient warning. */
export async function searchNominatim(
  query: string,
  options?: {
    lat?: number;
    lon?: number;
    bounded?: boolean;
    limit?: number;
    timeoutMs?: number;
  },
): Promise<NominatimSearchResult> {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    addressdetails: "1",
    extratags: "1",
    countrycodes: "au",
    limit: String(options?.limit ?? DEFAULT_NOMINATIM_LIMIT),
  });
  if (typeof options?.lat === "number" && typeof options?.lon === "number") {
    const left = options.lon - VIEWBOX_DELTA_DEGREES;
    const right = options.lon + VIEWBOX_DELTA_DEGREES;
    const top = options.lat + VIEWBOX_DELTA_DEGREES;
    const bottom = options.lat - VIEWBOX_DELTA_DEGREES;
    params.set("viewbox", `${left},${top},${right},${bottom}`);
    if (options?.bounded ?? true) {
      params.set("bounded", "1");
    }
  } else {
    params.set("viewbox", AUSTRALIA_VIEWBOX);
  }
  const timeoutMs = options?.timeoutMs ?? DEFAULT_NOMINATIM_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?${params.toString()}`,
      {
        headers: {
          "User-Agent": NOMINATIM_USER_AGENT,
          Accept: "application/json",
        },
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      return {
        items: [],
        warning: {
          code: "NOMINATIM_HTTP_ERROR",
          error: "Nominatim search is unavailable right now. Showing available local results.",
        },
      };
    }
    const data = (await response.json()) as unknown;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const errorMessage =
        "error" in data && typeof (data as { error?: unknown }).error === "string"
          ? (data as { error: string }).error
          : "Nominatim returned an error.";
      return {
        items: [],
        warning: { code: "NOMINATIM_ERROR", error: errorMessage },
      };
    }
    const items = Array.isArray(data) ? (data as NominatimSearchItem[]) : [];
    return {
      items: items.filter((item) => {
        const latNum = Number(item.lat ?? "");
        const lonNum = Number(item.lon ?? "");
        return Number.isFinite(latNum) && Number.isFinite(lonNum) && isInAustralia(latNum, lonNum);
      }),
    };
  } catch {
    return {
      items: [],
      warning: {
        code: "NOMINATIM_TIMEOUT",
        error: "Nominatim search timed out. Try Use area or typed search.",
      },
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/** Reverse geocode a latitude/longitude into a coarse suburb label. */
export async function reverseNominatim(lat: number, lon: number): Promise<{ suburb?: string }> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    format: "jsonv2",
    addressdetails: "1",
  });
  const response = await fetch(
    `https://nominatim.openstreetmap.org/reverse?${params.toString()}`,
    {
      headers: {
        "User-Agent": "BiteBud/1.0 (sensory near me)",
        Accept: "application/json",
      },
    },
  );
  if (!response.ok) return {};
  const data = (await response.json()) as { address?: Record<string, string> };
  return { suburb: toSuburb(data.address) };
}
