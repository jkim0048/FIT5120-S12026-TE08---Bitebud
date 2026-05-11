import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import {
  ensureRestaurantSeedData,
  restaurantRepository,
} from "../repositories/restaurantRepository.js";

type NominatimSearchItem = {
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

function nominatimClass(item: NominatimSearchItem): string {
  return (item.class ?? item.category ?? "").toLowerCase();
}

const SEARCH_QUERY_SCHEMA = z.object({
  q: z.string().trim().max(120).optional(),
  lat: z.coerce.number().optional(),
  lon: z.coerce.number().optional(),
  suburb: z.string().trim().max(160).optional(),
});

const LOCATION_SUGGEST_QUERY_SCHEMA = z.object({
  q: z.string().trim().min(2).max(80),
  limit: z.coerce.number().int().min(1).max(12).optional(),
});

const RATING_BODY_SCHEMA = z.object({
  overallRating: z.number().min(0).max(5),
  noiseRating: z.number().int().min(1).max(5),
  musicRating: z.number().int().min(1).max(5),
  lightRating: z.number().int().min(1).max(5),
  crowdsRating: z.number().int().min(1).max(5),
  smellsRating: z.number().int().min(1).max(5),
});

const BEST_TIME_BODY_SCHEMA = z.object({
  bestMealBlocks: z.array(z.string().trim().min(1)).max(6),
  bestTimesOfDay: z.array(z.string().trim().min(1)).max(6),
  bestDaysOfWeek: z.array(z.string().trim().min(1)).max(7),
});

const CREATE_FROM_NOMINATIM_SCHEMA = z.object({
  nominatimPlaceId: z.string().trim().min(1),
  osmType: z.string().trim().optional(),
  osmId: z.string().trim().optional(),
  name: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  cuisine: z.string().trim().optional(),
  address: z.string().trim().optional(),
  suburb: z.string().trim().optional(),
  latitude: z.number(),
  longitude: z.number(),
  extratags: z.record(z.string(), z.string()).optional(),
});

const DEFAULT_USER_ID = "demo-user";
const SCHEMA_MISSING_CODE = "RESTAURANT_SCHEMA_MISSING";

/** Rough mainland AU + Tasmania bbox for Nominatim viewbox (west, north, east, south). Biases free-text search when no GPS. */
const AUSTRALIA_VIEWBOX = "112.9,-10.3,154.0,-43.8";

/** Drop nominatim hits clearly outside Australia (stray global matches). */
function isInAustralia(lat: number, lon: number): boolean {
  return lat <= -9 && lat >= -48 && lon >= 108 && lon <= 162;
}

/** Max distance (km) from user pin when GPS is used — keep shortlist truly local. */
const NEARBY_RADIUS_KM = 15;

function toSuburb(address?: Record<string, string>): string | undefined {
  if (!address) return undefined;
  return address.suburb || address.neighbourhood || address.city_district || address.city || address.town;
}

function comfortBadge(overall: number): "Great match" | "Good match" | "Mixed" {
  if (overall >= 4.2) return "Great match";
  if (overall >= 3.2) return "Good match";
  return "Mixed";
}

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * r * Math.asin(Math.sqrt(h));
}

function isPrismaSchemaMissingError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String((err as { code?: unknown }).code ?? "") : "";
  return code === "P2021" || code === "P2022";
}

/** DB URL missing, Prisma failed to init, or server unreachable — search can still use Nominatim. */
function isPrismaUnavailableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if (isPrismaSchemaMissingError(err)) return false;
  const code = "code" in err ? String((err as { code?: unknown }).code ?? "") : "";
  if (code === "P1001" || code === "P1017") return true;
  const name = "name" in err ? String((err as { name?: unknown }).name ?? "") : "";
  if (name === "PrismaClientInitializationError") return true;
  const msg = "message" in err ? String((err as { message?: unknown }).message ?? "") : "";
  if (msg.includes("Environment variable not found: DATABASE_URL")) return true;
  if (msg.includes("Can't reach database server") || msg.includes("Server has closed the connection")) return true;
  return false;
}

function schemaMissingResponse() {
  return {
    error: "Restaurant tables are not ready. Run backend prisma migration and restart the API.",
    code: SCHEMA_MISSING_CODE,
  };
}

function isAllowedNominatimPlace(item: NominatimSearchItem): boolean {
  const cls = nominatimClass(item);
  const type = (item.type ?? "").toLowerCase();
  if (type === "fuel" || type === "charging_station" || type === "car_wash") return false;
  const foodLike = new Set([
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
  if (foodLike.has(type)) return true;
  return cls === "shop" && type === "bakery";
}

async function ensureSeedData(): Promise<void> {
  await ensureRestaurantSeedData();
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function dedupeKey(name: string, lat?: number, lon?: number): string {
  const latKey = typeof lat === "number" ? lat.toFixed(2) : "na";
  const lonKey = typeof lon === "number" ? lon.toFixed(2) : "na";
  return `${normalizeName(name)}:${latKey}:${lonKey}`;
}

function maybeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function searchNominatim(
  query: string,
  options?: { lat?: number; lon?: number; bounded?: boolean; limit?: number; timeoutMs?: number },
): Promise<{ items: NominatimSearchItem[]; warning?: { code: string; error: string } }> {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    addressdetails: "1",
    extratags: "1",
    countrycodes: "au",
    limit: String(options?.limit ?? 8),
  });
  if (typeof options?.lat === "number" && typeof options?.lon === "number") {
    const delta = 0.14;
    const left = options.lon - delta;
    const right = options.lon + delta;
    const top = options.lat + delta;
    const bottom = options.lat - delta;
    params.set("viewbox", `${left},${top},${right},${bottom}`);
    if (options?.bounded ?? true) {
      params.set("bounded", "1");
    }
  } else {
    params.set("viewbox", AUSTRALIA_VIEWBOX);
  }
  const timeoutMs = options?.timeoutMs ?? 6500;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: {
        "User-Agent": "BiteBud/1.0 (https://github.com/jkim0048/FIT5120-S12026-TE08---Bitebud; sensory restaurant search; AU-only)",
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        items: [],
        warning: {
          code: "NOMINATIM_HTTP_ERROR",
          error: "Nominatim search is unavailable right now. Showing available local results.",
        },
      };
    }
    const data = (await res.json()) as unknown;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const errMsg =
        "error" in data && typeof (data as { error?: unknown }).error === "string"
          ? (data as { error: string }).error
          : "Nominatim returned an error.";
      return {
        items: [],
        warning: { code: "NOMINATIM_ERROR", error: errMsg },
      };
    }
    const items = Array.isArray(data) ? (data as NominatimSearchItem[]) : [];
    return { items: items.filter((it) => {
      const la = Number(it.lat ?? "");
      const lo = Number(it.lon ?? "");
      return Number.isFinite(la) && Number.isFinite(lo) && isInAustralia(la, lo);
    }) };
  } catch {
    return {
      items: [],
      warning: {
        code: "NOMINATIM_TIMEOUT",
        error: "Nominatim search timed out. Try Use area or typed search.",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function reverseNominatim(lat: number, lon: number): Promise<{ suburb?: string }> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    format: "jsonv2",
    addressdetails: "1",
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
    headers: {
      "User-Agent": "BiteBud/1.0 (sensory near me)",
      Accept: "application/json",
    },
  });
  if (!res.ok) return {};
  const data = (await res.json()) as { address?: Record<string, string> };
  return { suburb: toSuburb(data.address) };
}

function isUsefulLocationSuggestItem(item: NominatimSearchItem): boolean {
  const cls = nominatimClass(item);
  const type = (item.type ?? "").toLowerCase();
  if (cls === "highway" || cls === "shop" || cls === "amenity" || cls === "building") return false;
  if (type === "state" || type === "country" || type === "region" || type === "continent") return false;
  const addr = item.address;
  if (type === "administrative") {
    return Boolean(
      maybeString(addr?.suburb) ||
        maybeString(addr?.city) ||
        maybeString(addr?.town) ||
        maybeString(addr?.municipality) ||
        maybeString(addr?.postcode),
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
  return goodTypes.has(type);
}

function suburbForAreaSearch(item: NominatimSearchItem): string {
  const addr = item.address;
  const fromAddr =
    maybeString(toSuburb(addr)) ||
    maybeString(addr?.city) ||
    maybeString(addr?.town) ||
    maybeString(addr?.municipality);
  if (fromAddr) return fromAddr;
  const type = (item.type ?? "").toLowerCase();
  if (type === "postcode" && item.name) return String(item.name).trim();
  return maybeString(item.name) ?? "";
}

export async function registerRestaurantRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/restaurants/my-reviews", async (request, reply) => {
    const userId = (request.headers["x-user-id"] as string | undefined) ?? "";
    if (!userId.trim()) {
      return reply.status(401).send({ error: "Missing user id", reviews: [] });
    }
    try {
      const reviews = await restaurantRepository.restaurantReviewFindMany({
        where: { userId },
        include: { place: true },
        orderBy: { updatedAt: "desc" },
        take: 200,
      });
      return {
        reviews: reviews.map((r) => ({
          place: {
            id: r.placeId,
            name: r.place.name,
            displayName: r.place.displayName,
            address: r.place.address,
            cuisine: r.place.cuisine,
            suburb: r.place.suburb,
          },
          review: {
            id: r.id,
            overallRating: r.overallRating,
            noiseRating: r.noiseRating,
            musicRating: r.musicRating,
            lightRating: r.lightRating,
            crowdsRating: r.crowdsRating,
            smellsRating: r.smellsRating,
            bestMealBlocks: (r.bestMealBlocks as string[]) ?? [],
            bestTimesOfDay: (r.bestTimesOfDay as string[]) ?? [],
            bestDaysOfWeek: (r.bestDaysOfWeek as string[]) ?? [],
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          },
        })),
      };
    } catch (err) {
      if (isPrismaSchemaMissingError(err)) {
        return reply.status(503).send(schemaMissingResponse());
      }
      throw err;
    }
  });

  app.get("/api/restaurants/location-suggest", async (request, reply) => {
    const parsed = LOCATION_SUGGEST_QUERY_SCHEMA.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid suggest parameters", suggestions: [] });
    }
    const { q, limit } = parsed.data;
    const want = Math.min(12, limit ?? 8);
    const remote = await searchNominatim(q, { bounded: false, limit: Math.min(25, want + 12), timeoutMs: 5000 });
    const seen = new Set<string>();
    const suggestions: Array<{
      id: string;
      suburb: string | null;
      state: string | null;
      postcode: string | null;
      latitude: number;
      longitude: number;
      displayName: string;
      areaSearch: string;
    }> = [];

    for (const item of remote.items) {
      if (!isUsefulLocationSuggestItem(item)) continue;
      const latNum = Number(item.lat ?? "");
      const lonNum = Number(item.lon ?? "");
      if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) continue;
      const addr = item.address;
      const suburb = maybeString(toSuburb(addr));
      const state = maybeString(addr?.state);
      const postcode = maybeString(addr?.postcode);
      const areaSearch = suburbForAreaSearch(item);
      const displayName = maybeString(item.display_name) ?? maybeString(item.name) ?? areaSearch;
      const id =
        item.place_id != null
          ? `pid:${item.place_id}`
          : `osm:${item.osm_type ?? "?"}:${item.osm_id ?? "?"}:${latNum.toFixed(4)}:${lonNum.toFixed(4)}`;
      const dedupe = [suburb ?? "", state ?? "", postcode ?? "", `${latNum.toFixed(3)}`, `${lonNum.toFixed(3)}`].join("|");
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      suggestions.push({
        id,
        suburb,
        state,
        postcode,
        latitude: latNum,
        longitude: lonNum,
        displayName,
        areaSearch: areaSearch || suburb || postcode || q,
      });
      if (suggestions.length >= want) break;
    }

    return { suggestions, warning: remote.warning };
  });

  app.get("/api/restaurants/status", async (_request, reply) => {
    try {
      await restaurantRepository.restaurantPlaceCount();
      return {
        ok: true,
        dbReady: true,
        mode: "full",
      };
    } catch (err) {
      if (isPrismaSchemaMissingError(err)) {
        return reply.status(503).send({
          ok: false,
          dbReady: false,
          mode: "fallback",
          ...schemaMissingResponse(),
        });
      }
      throw err;
    }
  });

  app.get("/api/restaurants/search", async (request, reply) => {
    const warnings: Array<{ code: string; error: string }> = [];
    let dbAvailable = true;
    try {
      await ensureSeedData();
    } catch (err) {
      if (isPrismaSchemaMissingError(err)) {
        dbAvailable = false;
        warnings.push(schemaMissingResponse());
      } else if (isPrismaUnavailableError(err)) {
        dbAvailable = false;
        warnings.push({
          code: "DB_UNAVAILABLE",
          error:
            "Restaurant database is not configured or unreachable (set DATABASE_URL in the repo root .env). Showing OpenStreetMap results only.",
        });
      } else {
        throw err;
      }
    }
    const parsed = SEARCH_QUERY_SCHEMA.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid search parameters" });
    }
    const { q, lat, lon, suburb } = parsed.data;
    let searchLat: number | undefined =
      typeof lat === "number" && Number.isFinite(lat) ? lat : undefined;
    let searchLon: number | undefined =
      typeof lon === "number" && Number.isFinite(lon) ? lon : undefined;
    if (
      searchLat !== undefined &&
      searchLon !== undefined &&
      !isInAustralia(searchLat, searchLon)
    ) {
      warnings.push({
        code: "LOCATION_OUTSIDE_AU",
        error:
          "Search is limited to Australia. GPS outside Australia was ignored — enter an Australian suburb or place name.",
      });
      searchLat = undefined;
      searchLon = undefined;
    }
    const userId = (request.headers["x-user-id"] as string | undefined) ?? DEFAULT_USER_ID;
    let localContextSuburb = suburb;
    if (!localContextSuburb && typeof searchLat === "number" && typeof searchLon === "number") {
      const reverse = await reverseNominatim(searchLat, searchLon);
      localContextSuburb = reverse.suburb;
    }

    let dbPlaces = dbAvailable
      ? await restaurantRepository.restaurantPlaceFindMany({
          where: {
            AND: [
              q
                ? {
                    OR: [
                      { name: { contains: q, mode: "insensitive" } },
                      { displayName: { contains: q, mode: "insensitive" } },
                      { suburb: { contains: q, mode: "insensitive" } },
                    ],
                  }
                : {},
              localContextSuburb
                ? { suburb: { contains: localContextSuburb, mode: "insensitive" } }
                : {},
            ],
          },
          include: { reviews: true },
          take: 12,
        })
      : [];
    if (!dbPlaces.length && dbAvailable && q?.trim()) {
      // Relax area filter when text query is present but suburb filtering is too strict.
      dbPlaces = await restaurantRepository.restaurantPlaceFindMany({
        where: {
          OR: [
            { name: { contains: q.trim(), mode: "insensitive" } },
            { displayName: { contains: q.trim(), mode: "insensitive" } },
            { suburb: { contains: q.trim(), mode: "insensitive" } },
          ],
        },
        include: { reviews: true },
        take: 12,
      });
    }
    if (!dbPlaces.length && dbAvailable && localContextSuburb?.trim()) {
      // Suburb from geocoder often won't exactly match our `suburb` column; widen to address/display.
      const area = localContextSuburb.trim();
      dbPlaces = await restaurantRepository.restaurantPlaceFindMany({
        where: {
          OR: [
            { suburb: { contains: area, mode: "insensitive" } },
            { displayName: { contains: area, mode: "insensitive" } },
            { address: { contains: area, mode: "insensitive" } },
          ],
        },
        include: { reviews: true },
        take: 12,
      });
    }

    const localResults = dbPlaces
      .map((place) => {
        const reviewCount = place.reviews.length;
        const userHasReview = place.reviews.some((r) => r.userId === userId);
        const overall =
          reviewCount > 0
            ? place.reviews.reduce((sum, r) => sum + r.overallRating, 0) / reviewCount
            : 0;
        const km =
          typeof searchLat === "number" && typeof searchLon === "number"
            ? distanceKm(searchLat, searchLon, place.latitude, place.longitude)
            : null;
        return {
          source: "bitebud",
          id: place.id,
          name: place.name,
          displayName: place.displayName,
          cuisine: place.cuisine,
          address: place.address,
          suburb: place.suburb,
          latitude: place.latitude,
          longitude: place.longitude,
          reviewCount,
          userHasReview,
          overallRating: Number(overall.toFixed(1)),
          comfortBadge: reviewCount > 0 ? comfortBadge(overall) : "Mixed",
          distanceKm: km === null ? null : Number(km.toFixed(1)),
          canRateNow: true,
        };
      })
      .filter((item) => {
        if (!isInAustralia(item.latitude, item.longitude)) return false;
        return item.distanceKm === null || item.distanceKm <= NEARBY_RADIUS_KM;
      });

    let nominatimResults: Array<Record<string, unknown>> = [];
    const hasCoords = typeof searchLat === "number" && typeof searchLon === "number";
    const modeUsed = q?.trim() ? "typed" : hasCoords ? "near_me" : localContextSuburb ? "area" : "typed";
    let fallbackStageUsed: "none" | "expanded" | "relaxed" = "none";
    const localResultKeys = new Set(
      localResults.map((place) => dedupeKey(place.name, place.latitude, place.longitude)),
    );
    const localPlaceByNominatimId = dbAvailable
      ? new Map(
          (
            await restaurantRepository.restaurantPlaceFindMany({
              where: {
                nominatimPlaceId: { not: null },
              },
              include: { reviews: true },
              take: 200,
            })
          ).map((place) => [place.nominatimPlaceId as string, place]),
        )
      : new Map();
    const nominatimQueryStages: Array<{ query: string; bounded: boolean; limit: number; stage: "none" | "expanded" | "relaxed" }> = [];
    if (q?.trim()) {
      nominatimQueryStages.push({ query: q.trim(), bounded: hasCoords, limit: 8, stage: "none" });
      if (localContextSuburb) {
        nominatimQueryStages.push({
          query: `${q.trim()} near ${localContextSuburb}`,
          bounded: false,
          limit: 16,
          stage: "expanded",
        });
      }
    } else if (hasCoords || localContextSuburb) {
      const context = localContextSuburb ?? "";
      nominatimQueryStages.push({
        query: context ? `restaurant near ${context}` : "restaurant near me",
        bounded: hasCoords,
        limit: 12,
        stage: "none",
      });
      nominatimQueryStages.push({
        query: context ? `cafe near ${context}` : "cafe near me",
        bounded: false,
        limit: 20,
        stage: "expanded",
      });
      nominatimQueryStages.push({
        query: context ? `fast food near ${context}` : "fast food near me",
        bounded: false,
        limit: 20,
        stage: "relaxed",
      });
      nominatimQueryStages.push({
        query: context ? `bakery near ${context}` : "bakery near me",
        bounded: false,
        limit: 20,
        stage: "relaxed",
      });
    }

    for (const stage of nominatimQueryStages) {
      if (!stage.query) continue;
      const remote = await searchNominatim(stage.query, {
        lat: searchLat,
        lon: searchLon,
        bounded: stage.bounded,
        limit: stage.limit,
      });
      if (remote.warning && !warnings.some((w) => w.code === remote.warning?.code)) {
        warnings.push(remote.warning);
      }
      const stagedResults = remote.items
        .filter(isAllowedNominatimPlace)
        .map((item) => {
          const latNum = Number(item.lat ?? "0");
          const lonNum = Number(item.lon ?? "0");
          return {
            source: "nominatim",
            id: `nominatim:${item.place_id ?? `${item.osm_type}:${item.osm_id}`}`,
            nominatimPlaceId: item.place_id ? String(item.place_id) : null,
            name: item.name || item.display_name || "Restaurant",
            displayName: item.display_name || item.name || "Restaurant",
            cuisine: item.extratags?.cuisine,
            address: item.display_name || null,
            suburb: toSuburb(item.address),
            latitude: latNum,
            longitude: lonNum,
            reviewCount: 0,
            overallRating: 0,
            comfortBadge: "Mixed",
            canRateNow: true,
            userHasReview: false,
            distanceKm:
              hasCoords && typeof searchLat === "number" && typeof searchLon === "number"
                ? Number(distanceKm(searchLat, searchLon, latNum, lonNum).toFixed(1))
                : null,
            extratags: item.extratags ?? {},
            osmType: item.osm_type ?? null,
            osmId: item.osm_id ? String(item.osm_id) : null,
          };
        })
        .filter((item) => {
          const nominatimId = maybeString(item.nominatimPlaceId);
          if (nominatimId && localPlaceByNominatimId.has(nominatimId)) {
            const place = localPlaceByNominatimId.get(nominatimId)!;
            const reviewCount = place.reviews.length;
            const userHasReview = place.reviews.some((r: { userId: string }) => r.userId === userId);
            const overall =
              reviewCount > 0
                ? place.reviews.reduce((sum: number, r: { overallRating: number }) => sum + r.overallRating, 0) /
                  reviewCount
                : 0;
            localResults.push({
              source: "bitebud",
              id: place.id,
              name: place.name,
              displayName: place.displayName,
              cuisine: place.cuisine,
              address: place.address,
              suburb: place.suburb,
              latitude: place.latitude,
              longitude: place.longitude,
              reviewCount,
              userHasReview,
              overallRating: Number(overall.toFixed(1)),
              comfortBadge: reviewCount > 0 ? comfortBadge(overall) : "Mixed",
              canRateNow: true,
              distanceKm:
                hasCoords && typeof searchLat === "number" && typeof searchLon === "number"
                  ? Number(distanceKm(searchLat, searchLon, place.latitude, place.longitude).toFixed(1))
                  : null,
            });
            return false;
          }
          const itemName = typeof item.name === "string" ? item.name : "restaurant";
          const key = dedupeKey(itemName, Number(item.latitude), Number(item.longitude));
          return !localResultKeys.has(key);
        })
        .filter((item) =>
          typeof item.distanceKm === "number" ? item.distanceKm <= NEARBY_RADIUS_KM : true,
        )
        .filter((item) => isInAustralia(item.latitude, item.longitude));
      if (stagedResults.length > 0) {
        nominatimResults = stagedResults.slice(0, 8);
        fallbackStageUsed = stage.stage;
        break;
      }
    }

    if (!localResults.length && !nominatimResults.length) {
      const nominatimWarningCodes = new Set([
        "NOMINATIM_HTTP_ERROR",
        "NOMINATIM_ERROR",
        "NOMINATIM_TIMEOUT",
      ]);
      const hadNominatimIssue = warnings.some((w) => nominatimWarningCodes.has(w.code));
      if (hadNominatimIssue) {
        const kept = warnings.filter((w) => !nominatimWarningCodes.has(w.code));
        warnings.length = 0;
        warnings.push(...kept, { code: "LOCATION_INVALID", error: "Location invalid" });
      } else {
        warnings.push({
          code: "NO_NEARBY_RESULTS",
          error: "No nearby places found yet. Try Use area or type a place name.",
        });
      }
    }

    const dedupedLocal = Array.from(
      new Map(localResults.map((r) => [r.id, r])).values(),
    );

    return {
      areaContext: localContextSuburb ?? null,
      results: [...dedupedLocal, ...nominatimResults],
      warnings,
      modeUsed,
      fallbackStageUsed,
      sourceCounts: {
        bitebud: dedupedLocal.length,
        nominatim: nominatimResults.length,
      },
    };
  });

  app.post("/api/restaurants/from-nominatim", async (request, reply) => {
    const parsed = CREATE_FROM_NOMINATIM_SCHEMA.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid nominatim place payload" });
    }
    try {
      const payload = parsed.data;
      const place = await restaurantRepository.restaurantPlaceUpsert({
        where: { nominatimPlaceId: payload.nominatimPlaceId },
        update: {
          name: payload.name,
          displayName: payload.displayName,
          cuisine: payload.cuisine ?? null,
          address: payload.address ?? null,
          suburb: payload.suburb ?? null,
          latitude: payload.latitude,
          longitude: payload.longitude,
          extratags: (payload.extratags ?? {}) as Prisma.InputJsonValue,
          osmType: payload.osmType ?? null,
          osmId: payload.osmId ?? null,
        },
        create: {
          nominatimPlaceId: payload.nominatimPlaceId,
          name: payload.name,
          displayName: payload.displayName,
          cuisine: payload.cuisine ?? null,
          address: payload.address ?? null,
          suburb: payload.suburb ?? null,
          latitude: payload.latitude,
          longitude: payload.longitude,
          extratags: (payload.extratags ?? {}) as Prisma.InputJsonValue,
          osmType: payload.osmType ?? null,
          osmId: payload.osmId ?? null,
        },
      });
      return { ok: true, placeId: place.id };
    } catch (err) {
      if (isPrismaSchemaMissingError(err)) {
        return reply.status(503).send(schemaMissingResponse());
      }
      throw err;
    }
  });

  app.get("/api/restaurants/:placeId/details", async (request, reply) => {
    try {
      await ensureSeedData();
    } catch (err) {
      if (isPrismaSchemaMissingError(err)) {
        return reply.status(503).send(schemaMissingResponse());
      }
      throw err;
    }
    const params = request.params as { placeId: string };
    const userId = (request.headers["x-user-id"] as string | undefined) ?? DEFAULT_USER_ID;
    const place = await restaurantRepository.restaurantPlaceFindUnique({
      where: { id: params.placeId },
      include: { reviews: true, favorites: { where: { userId } } },
    });
    if (!place) {
      return reply.status(404).send({ error: "Restaurant not found" });
    }
    const reviewCount = place.reviews.length;
    const userHasReview = place.reviews.some((r) => r.userId === userId);
    const avg = (key: keyof (typeof place.reviews)[number]) =>
      reviewCount > 0
        ? place.reviews.reduce((sum, r) => sum + Number(r[key] ?? 0), 0) / reviewCount
        : 0;
    const overall = avg("overallRating");
    return {
      place: {
        id: place.id,
        name: place.name,
        displayName: place.displayName,
        cuisine: place.cuisine,
        address: place.address,
        suburb: place.suburb,
        latitude: place.latitude,
        longitude: place.longitude,
      },
      summary: {
        reviewCount,
        userHasReview,
        overallRating: Number(overall.toFixed(1)),
        comfortBadge: comfortBadge(overall),
        noiseRating: Number(avg("noiseRating").toFixed(1)),
        musicRating: Number(avg("musicRating").toFixed(1)),
        lightRating: Number(avg("lightRating").toFixed(1)),
        crowdsRating: Number(avg("crowdsRating").toFixed(1)),
        smellsRating: Number(avg("smellsRating").toFixed(1)),
        recentBestMealBlocks: [...new Set(place.reviews.flatMap((r) => (r.bestMealBlocks as string[]) ?? []))].slice(
          0,
          3,
        ),
        recentBestTimesOfDay: [...new Set(place.reviews.flatMap((r) => (r.bestTimesOfDay as string[]) ?? []))].slice(
          0,
          3,
        ),
        recentBestDaysOfWeek: [...new Set(place.reviews.flatMap((r) => (r.bestDaysOfWeek as string[]) ?? []))].slice(
          0,
          3,
        ),
      },
      isFavorite: place.favorites.length > 0,
      reviews: place.reviews
        .slice(0, 20)
        .map((r) => ({
          id: r.id,
          userId: r.userId,
          overallRating: r.overallRating,
          noiseRating: r.noiseRating,
          musicRating: r.musicRating,
          lightRating: r.lightRating,
          crowdsRating: r.crowdsRating,
          smellsRating: r.smellsRating,
          bestMealBlocks: r.bestMealBlocks,
          bestTimesOfDay: r.bestTimesOfDay,
          bestDaysOfWeek: r.bestDaysOfWeek,
          createdAt: r.createdAt,
        })),
    };
  });

  app.post("/api/restaurants/:placeId/reviews/rating", async (request, reply) => {
    const params = request.params as { placeId: string };
    const parsed = RATING_BODY_SCHEMA.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid rating payload" });
    }
    const userId = (request.headers["x-user-id"] as string | undefined) ?? DEFAULT_USER_ID;
    let created;
    try {
      const existing = await restaurantRepository.restaurantReviewFindFirst({
        where: { placeId: params.placeId, userId },
        orderBy: { createdAt: "desc" },
      });
      created = existing
        ? await restaurantRepository.restaurantReviewUpdate({
            where: { id: existing.id },
            data: parsed.data,
          })
        : await restaurantRepository.restaurantReviewCreate({
            data: {
              placeId: params.placeId,
              userId,
              ...parsed.data,
            },
          });
    } catch (err) {
      if (isPrismaSchemaMissingError(err)) {
        return reply.status(503).send(schemaMissingResponse());
      }
      throw err;
    }
    return { ok: true, reviewId: created.id };
  });

  app.get("/api/restaurants/reviews/:reviewId", async (request, reply) => {
    const params = request.params as { reviewId: string };
    const userId = (request.headers["x-user-id"] as string | undefined) ?? DEFAULT_USER_ID;
    let review;
    try {
      review = await restaurantRepository.restaurantReviewFindFirst({
        where: { id: params.reviewId, userId },
        select: {
          id: true,
          placeId: true,
          overallRating: true,
          noiseRating: true,
          musicRating: true,
          lightRating: true,
          crowdsRating: true,
          smellsRating: true,
          bestMealBlocks: true,
          bestTimesOfDay: true,
          bestDaysOfWeek: true,
        },
      });
    } catch (err) {
      if (isPrismaSchemaMissingError(err)) {
        return reply.status(503).send(schemaMissingResponse());
      }
      throw err;
    }
    if (!review) {
      return reply.status(404).send({ error: "Review not found" });
    }
    return {
      reviewId: review.id,
      placeId: review.placeId,
      overallRating: Number(review.overallRating),
      noiseRating: review.noiseRating,
      musicRating: review.musicRating,
      lightRating: review.lightRating,
      crowdsRating: review.crowdsRating,
      smellsRating: review.smellsRating,
      bestMealBlocks: (review.bestMealBlocks as string[]) ?? [],
      bestTimesOfDay: (review.bestTimesOfDay as string[]) ?? [],
      bestDaysOfWeek: (review.bestDaysOfWeek as string[]) ?? [],
    };
  });

  app.patch("/api/restaurants/reviews/:reviewId/best-time", async (request, reply) => {
    const params = request.params as { reviewId: string };
    const parsed = BEST_TIME_BODY_SCHEMA.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid best-time payload" });
    }
    let updated;
    try {
      updated = await restaurantRepository.restaurantReviewUpdate({
        where: { id: params.reviewId },
        data: parsed.data,
      });
    } catch (err) {
      if (isPrismaSchemaMissingError(err)) {
        return reply.status(503).send(schemaMissingResponse());
      }
      throw err;
    }
    return { ok: true, reviewId: updated.id };
  });

  app.post("/api/restaurants/:placeId/favorite", async (request, reply) => {
    const params = request.params as { placeId: string };
    const userId = (request.headers["x-user-id"] as string | undefined) ?? DEFAULT_USER_ID;
    try {
      await restaurantRepository.restaurantFavoriteUpsert({
        where: { placeId_userId: { placeId: params.placeId, userId } },
        update: {},
        create: { placeId: params.placeId, userId },
      });
    } catch (err) {
      if (isPrismaSchemaMissingError(err)) {
        return reply.status(503).send(schemaMissingResponse());
      }
      throw err;
    }
    return { ok: true };
  });

  app.delete("/api/restaurants/:placeId/favorite", async (request, reply) => {
    const params = request.params as { placeId: string };
    const userId = (request.headers["x-user-id"] as string | undefined) ?? DEFAULT_USER_ID;
    try {
      await restaurantRepository.restaurantFavoriteDeleteMany({
        where: { placeId: params.placeId, userId },
      });
    } catch (err) {
      if (isPrismaSchemaMissingError(err)) {
        return reply.status(503).send(schemaMissingResponse());
      }
      throw err;
    }
    return { ok: true };
  });
}
