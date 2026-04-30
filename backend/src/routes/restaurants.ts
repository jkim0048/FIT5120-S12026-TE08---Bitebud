import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";

type NominatimSearchItem = {
  place_id?: number;
  osm_type?: string;
  osm_id?: number | string;
  class?: string;
  type?: string;
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  extratags?: Record<string, string>;
  address?: Record<string, string>;
};

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

const SEEDED_PLACES = [
  {
    name: "Higher Ground",
    displayName: "Higher Ground, Little Bourke Street, Melbourne VIC",
    cuisine: "Cafe / Australian",
    address: "650 Little Bourke St, Melbourne VIC",
    suburb: "Melbourne",
    latitude: -37.8155,
    longitude: 144.9545,
    extratags: { wheelchair: "yes", outdoor_seating: "yes" },
  },
  {
    name: "Tipo 00",
    displayName: "Tipo 00, Little Bourke Street, Melbourne VIC",
    cuisine: "Italian",
    address: "361 Little Bourke St, Melbourne VIC",
    suburb: "Melbourne",
    latitude: -37.8133,
    longitude: 144.9636,
    extratags: { reservation: "recommended" },
  },
  {
    name: "Lune Croissanterie",
    displayName: "Lune Croissanterie, Rose Street, Fitzroy VIC",
    cuisine: "Bakery",
    address: "119 Rose St, Fitzroy VIC",
    suburb: "Fitzroy",
    latitude: -37.8024,
    longitude: 144.9783,
    extratags: { takeaway: "yes" },
  },
  {
    name: "Rice Paper Scissors",
    displayName: "Rice Paper Scissors, Liverpool Street, Melbourne VIC",
    cuisine: "Thai / Vietnamese",
    address: "15 Hardware Ln, Melbourne VIC",
    suburb: "Melbourne",
    latitude: -37.8124,
    longitude: 144.9617,
    extratags: { outdoor_seating: "yes" },
  },
  {
    name: "Green Man's Arms",
    displayName: "Green Man's Arms, Lygon Street, Carlton VIC",
    cuisine: "Vegetarian",
    address: "418 Lygon St, Carlton VIC",
    suburb: "Carlton",
    latitude: -37.7986,
    longitude: 144.9677,
    extratags: { vegetarian: "yes", vegan: "yes" },
  },
] as const;

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

function schemaMissingResponse() {
  return {
    error: "Restaurant tables are not ready. Run backend prisma migration and restart the API.",
    code: SCHEMA_MISSING_CODE,
  };
}

function isAllowedNominatimPlace(item: NominatimSearchItem): boolean {
  const cls = (item.class ?? "").toLowerCase();
  const type = (item.type ?? "").toLowerCase();
  if (type === "bar") return false;
  return (
    type === "restaurant" ||
    type === "cafe" ||
    type === "food_court" ||
    type === "bakery" ||
    type === "fast_food" ||
    (cls === "shop" && type === "bakery")
  );
}

async function ensureSeedData(): Promise<void> {
  const existing = await prisma.restaurantPlace.count();
  if (existing > 0) return;
  for (const place of SEEDED_PLACES) {
    const created = await prisma.restaurantPlace.create({
      data: {
        ...place,
        extratags: place.extratags as object,
      },
    });
    await prisma.restaurantReview.createMany({
      data: [
        {
          placeId: created.id,
          userId: "seed-user-1",
          overallRating: 4.2,
          noiseRating: 4,
          musicRating: 3,
          lightRating: 4,
          crowdsRating: 3,
          smellsRating: 4,
          bestMealBlocks: ["Brunch"],
          bestTimesOfDay: ["Morning"],
          bestDaysOfWeek: ["Monday", "Tuesday"],
        },
        {
          placeId: created.id,
          userId: "seed-user-2",
          overallRating: 3.8,
          noiseRating: 3,
          musicRating: 3,
          lightRating: 4,
          crowdsRating: 2,
          smellsRating: 4,
          bestMealBlocks: ["Lunch"],
          bestTimesOfDay: ["Midday"],
          bestDaysOfWeek: ["Wednesday", "Thursday"],
        },
      ],
    });
  }
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
    const delta = 0.08;
    const left = options.lon - delta;
    const right = options.lon + delta;
    const top = options.lat + delta;
    const bottom = options.lat - delta;
    params.set("viewbox", `${left},${top},${right},${bottom}`);
    if (options?.bounded ?? true) {
      params.set("bounded", "1");
    }
  }
  const timeoutMs = options?.timeoutMs ?? 6500;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: {
        "User-Agent": "BiteBud/1.0 (sensory restaurant search)",
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
    const data = (await res.json()) as NominatimSearchItem[];
    return { items: Array.isArray(data) ? data : [] };
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
  const cls = (item.class ?? "").toLowerCase();
  const type = (item.type ?? "").toLowerCase();
  if (cls === "highway" || cls === "shop" || cls === "amenity" || cls === "building") return false;
  if (type === "state" || type === "country" || type === "region" || type === "continent") return false;
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
      const reviews = await prisma.restaurantReview.findMany({
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
      await prisma.restaurantPlace.count();
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
      } else {
        throw err;
      }
    }
    const parsed = SEARCH_QUERY_SCHEMA.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid search parameters" });
    }
    const { q, lat, lon, suburb } = parsed.data;
    const userId = (request.headers["x-user-id"] as string | undefined) ?? DEFAULT_USER_ID;
    let localContextSuburb = suburb;
    if (!localContextSuburb && typeof lat === "number" && typeof lon === "number") {
      const reverse = await reverseNominatim(lat, lon);
      localContextSuburb = reverse.suburb;
    }

    let dbPlaces = dbAvailable
      ? await prisma.restaurantPlace.findMany({
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
      dbPlaces = await prisma.restaurantPlace.findMany({
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
      dbPlaces = await prisma.restaurantPlace.findMany({
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
          typeof lat === "number" && typeof lon === "number"
            ? distanceKm(lat, lon, place.latitude, place.longitude)
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
      .filter((item) => item.distanceKm === null || item.distanceKm <= 25);

    let nominatimResults: Array<Record<string, unknown>> = [];
    const hasCoords = typeof lat === "number" && typeof lon === "number";
    const modeUsed = q?.trim() ? "typed" : hasCoords ? "near_me" : localContextSuburb ? "area" : "typed";
    let fallbackStageUsed: "none" | "expanded" | "relaxed" = "none";
    const localResultKeys = new Set(
      localResults.map((place) => dedupeKey(place.name, place.latitude, place.longitude)),
    );
    const localPlaceByNominatimId = dbAvailable
      ? new Map(
          (
            await prisma.restaurantPlace.findMany({
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
      const remote = await searchNominatim(stage.query, { lat, lon, bounded: stage.bounded, limit: stage.limit });
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
              hasCoords && lat !== undefined && lon !== undefined
                ? Number(distanceKm(lat, lon, latNum, lonNum).toFixed(1))
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
                hasCoords && lat !== undefined && lon !== undefined
                  ? Number(distanceKm(lat, lon, place.latitude, place.longitude).toFixed(1))
                  : null,
            });
            return false;
          }
          const itemName = typeof item.name === "string" ? item.name : "restaurant";
          const key = dedupeKey(itemName, Number(item.latitude), Number(item.longitude));
          return !localResultKeys.has(key);
        })
        .filter((item) => (typeof item.distanceKm === "number" ? item.distanceKm <= 25 : true));
      if (stagedResults.length > 0) {
        nominatimResults = stagedResults.slice(0, 8);
        fallbackStageUsed = stage.stage;
        break;
      }
    }

    if (!localResults.length && !nominatimResults.length) {
      warnings.push({
        code: "NO_NEARBY_RESULTS",
        error: "No nearby places found yet. Try Use area or type a place name.",
      });
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
      const place = await prisma.restaurantPlace.upsert({
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
    const place = await prisma.restaurantPlace.findUnique({
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
      const existing = await prisma.restaurantReview.findFirst({
        where: { placeId: params.placeId, userId },
        orderBy: { createdAt: "desc" },
      });
      created = existing
        ? await prisma.restaurantReview.update({
            where: { id: existing.id },
            data: parsed.data,
          })
        : await prisma.restaurantReview.create({
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

  app.patch("/api/restaurants/reviews/:reviewId/best-time", async (request, reply) => {
    const params = request.params as { reviewId: string };
    const parsed = BEST_TIME_BODY_SCHEMA.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid best-time payload" });
    }
    let updated;
    try {
      updated = await prisma.restaurantReview.update({
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
      await prisma.restaurantFavorite.upsert({
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
      await prisma.restaurantFavorite.deleteMany({
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
