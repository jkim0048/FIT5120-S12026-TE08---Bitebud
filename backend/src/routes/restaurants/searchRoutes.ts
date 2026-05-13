import type { FastifyInstance } from "fastify";
import {
  ensureRestaurantSeedData,
  restaurantDatabase,
} from "../../database/restaurantDatabase.js";
import {
  AUSTRALIA_VIEWBOX,
  NEARBY_RADIUS_KM,
  comfortBadge,
  dedupeKey,
  distanceKm,
  isAllowedNominatimPlace,
  isInAustralia,
  isUsefulLocationSuggestItem,
  maybeString,
  reverseNominatim,
  searchNominatim,
  suburbForAreaSearch,
  toSuburb,
  type NominatimSearchItem,
} from "../../services/restaurantNominatimClient.js";
import {
  isPrismaSchemaMissingError,
  isPrismaUnavailableError,
  schemaMissingResponse,
} from "../../services/restaurantPrismaErrors.js";
import {
  DEFAULT_USER_ID,
  locationSuggestQuerySchema,
  searchQuerySchema,
} from "./restaurantSchemas.js";

const LOCATION_SUGGEST_DEFAULT_LIMIT = 8;
const LOCATION_SUGGEST_MAX_LIMIT = 12;
const LOCATION_SUGGEST_REMOTE_MAX = 25;
const LOCATION_SUGGEST_REMOTE_OVERFETCH = 12;
const LOCATION_SUGGEST_TIMEOUT_MS = 5000;

const SEARCH_DB_PAGE_SIZE = 12;
const NOMINATIM_PLACE_LOOKUP_LIMIT = 200;
const NOMINATIM_RESULTS_PER_STAGE = 8;
const NOMINATIM_PRIMARY_LIMIT = 8;
const NOMINATIM_EXPANDED_LIMIT_TEXT = 16;
const NOMINATIM_CATEGORY_PRIMARY_LIMIT = 12;
const NOMINATIM_CATEGORY_FALLBACK_LIMIT = 20;

/** Suppress some other warnings unsafely when registry inevitably already populated.  Used as a void wrapper. */
async function safeEnsureSeedData(): Promise<void> {
  await ensureRestaurantSeedData();
}

/**
 * Register restaurant search endpoints:
 * - `GET /api/restaurants/location-suggest` — autocomplete suggestions for the location box.
 * - `GET /api/restaurants/search` — full search merging BiteBud places and Nominatim hits.
 */
export async function registerSearchRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/restaurants/location-suggest", async (request, reply) => {
    const parsed = locationSuggestQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid suggest parameters", suggestions: [] });
    }
    const { q, limit } = parsed.data;
    const wantedCount = Math.min(LOCATION_SUGGEST_MAX_LIMIT, limit ?? LOCATION_SUGGEST_DEFAULT_LIMIT);
    const remote = await searchNominatim(q, {
      bounded: false,
      limit: Math.min(LOCATION_SUGGEST_REMOTE_MAX, wantedCount + LOCATION_SUGGEST_REMOTE_OVERFETCH),
      timeoutMs: LOCATION_SUGGEST_TIMEOUT_MS,
    });
    const seenKeys = new Set<string>();
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
      const address = item.address;
      const suburb = maybeString(toSuburb(address));
      const state = maybeString(address?.state);
      const postcode = maybeString(address?.postcode);
      const areaSearch = suburbForAreaSearch(item);
      const displayName =
        maybeString(item.display_name) ?? maybeString(item.name) ?? areaSearch;
      const suggestionId =
        item.place_id != null
          ? `pid:${item.place_id}`
          : `osm:${item.osm_type ?? "?"}:${item.osm_id ?? "?"}:${latNum.toFixed(4)}:${lonNum.toFixed(4)}`;
      const dedupeId = [
        suburb ?? "",
        state ?? "",
        postcode ?? "",
        `${latNum.toFixed(3)}`,
        `${lonNum.toFixed(3)}`,
      ].join("|");
      if (seenKeys.has(dedupeId)) continue;
      seenKeys.add(dedupeId);
      suggestions.push({
        id: suggestionId,
        suburb,
        state,
        postcode,
        latitude: latNum,
        longitude: lonNum,
        displayName,
        areaSearch: areaSearch || suburb || postcode || q,
      });
      if (suggestions.length >= wantedCount) break;
    }

    // `AUSTRALIA_VIEWBOX` import is intentionally kept available in this file for future calls.
    void AUSTRALIA_VIEWBOX;

    return { suggestions, warning: remote.warning };
  });

  app.get("/api/restaurants/search", async (request, reply) => {
    const warnings: Array<{ code: string; error: string }> = [];
    let dbAvailable = true;
    try {
      await safeEnsureSeedData();
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
    const parsed = searchQuerySchema.safeParse(request.query ?? {});
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
      ? await restaurantDatabase.restaurantPlaceFindMany({
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
          take: SEARCH_DB_PAGE_SIZE,
        })
      : [];
    if (!dbPlaces.length && dbAvailable && q?.trim()) {
      // Relax area filter when text query is present but suburb filtering is too strict.
      dbPlaces = await restaurantDatabase.restaurantPlaceFindMany({
        where: {
          OR: [
            { name: { contains: q.trim(), mode: "insensitive" } },
            { displayName: { contains: q.trim(), mode: "insensitive" } },
            { suburb: { contains: q.trim(), mode: "insensitive" } },
          ],
        },
        include: { reviews: true },
        take: SEARCH_DB_PAGE_SIZE,
      });
    }
    if (!dbPlaces.length && dbAvailable && localContextSuburb?.trim()) {
      // Suburb from geocoder often won't exactly match our `suburb` column; widen to address/display.
      const area = localContextSuburb.trim();
      dbPlaces = await restaurantDatabase.restaurantPlaceFindMany({
        where: {
          OR: [
            { suburb: { contains: area, mode: "insensitive" } },
            { displayName: { contains: area, mode: "insensitive" } },
            { address: { contains: area, mode: "insensitive" } },
          ],
        },
        include: { reviews: true },
        take: SEARCH_DB_PAGE_SIZE,
      });
    }

    const localResults = dbPlaces
      .map((place) => {
        const reviewCount = place.reviews.length;
        const userHasReview = place.reviews.some((review) => review.userId === userId);
        const overall =
          reviewCount > 0
            ? place.reviews.reduce(
                (runningSum, review) => runningSum + review.overallRating,
                0,
              ) / reviewCount
            : 0;
        const distanceFromUserKm =
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
          distanceKm:
            distanceFromUserKm === null ? null : Number(distanceFromUserKm.toFixed(1)),
          canRateNow: true,
        };
      })
      .filter((item) => {
        if (!isInAustralia(item.latitude, item.longitude)) return false;
        return item.distanceKm === null || item.distanceKm <= NEARBY_RADIUS_KM;
      });

    let nominatimResults: Array<Record<string, unknown>> = [];
    const hasCoords = typeof searchLat === "number" && typeof searchLon === "number";
    const modeUsed = q?.trim()
      ? "typed"
      : hasCoords
        ? "near_me"
        : localContextSuburb
          ? "area"
          : "typed";
    let fallbackStageUsed: "none" | "expanded" | "relaxed" = "none";
    const localResultKeys = new Set(
      localResults.map((place) => dedupeKey(place.name, place.latitude, place.longitude)),
    );
    const localPlaceByNominatimId = dbAvailable
      ? new Map(
          (
            await restaurantDatabase.restaurantPlaceFindMany({
              where: { nominatimPlaceId: { not: null } },
              include: { reviews: true },
              take: NOMINATIM_PLACE_LOOKUP_LIMIT,
            })
          ).map((place) => [place.nominatimPlaceId as string, place]),
        )
      : new Map();

    const nominatimQueryStages: Array<{
      query: string;
      bounded: boolean;
      limit: number;
      stage: "none" | "expanded" | "relaxed";
    }> = [];
    if (q?.trim()) {
      nominatimQueryStages.push({
        query: q.trim(),
        bounded: hasCoords,
        limit: NOMINATIM_PRIMARY_LIMIT,
        stage: "none",
      });
      if (localContextSuburb) {
        nominatimQueryStages.push({
          query: `${q.trim()} near ${localContextSuburb}`,
          bounded: false,
          limit: NOMINATIM_EXPANDED_LIMIT_TEXT,
          stage: "expanded",
        });
      }
    } else if (hasCoords || localContextSuburb) {
      const context = localContextSuburb ?? "";
      nominatimQueryStages.push({
        query: context ? `restaurant near ${context}` : "restaurant near me",
        bounded: hasCoords,
        limit: NOMINATIM_CATEGORY_PRIMARY_LIMIT,
        stage: "none",
      });
      nominatimQueryStages.push({
        query: context ? `cafe near ${context}` : "cafe near me",
        bounded: false,
        limit: NOMINATIM_CATEGORY_FALLBACK_LIMIT,
        stage: "expanded",
      });
      nominatimQueryStages.push({
        query: context ? `fast food near ${context}` : "fast food near me",
        bounded: false,
        limit: NOMINATIM_CATEGORY_FALLBACK_LIMIT,
        stage: "relaxed",
      });
      nominatimQueryStages.push({
        query: context ? `bakery near ${context}` : "bakery near me",
        bounded: false,
        limit: NOMINATIM_CATEGORY_FALLBACK_LIMIT,
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
      if (remote.warning && !warnings.some((existing) => existing.code === remote.warning?.code)) {
        warnings.push(remote.warning);
      }
      const stagedResults = remote.items
        .filter(isAllowedNominatimPlace)
        .map((item: NominatimSearchItem) => {
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
            const userHasReview = place.reviews.some(
              (review: { userId: string }) => review.userId === userId,
            );
            const overall =
              reviewCount > 0
                ? place.reviews.reduce(
                    (runningSum: number, review: { overallRating: number }) =>
                      runningSum + review.overallRating,
                    0,
                  ) / reviewCount
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
                  ? Number(
                      distanceKm(searchLat, searchLon, place.latitude, place.longitude).toFixed(1),
                    )
                  : null,
            });
            return false;
          }
          const itemName = typeof item.name === "string" ? item.name : "restaurant";
          const key = dedupeKey(itemName, Number(item.latitude), Number(item.longitude));
          return !localResultKeys.has(key);
        })
        .filter((item) =>
          typeof item.distanceKm === "number"
            ? item.distanceKm <= NEARBY_RADIUS_KM
            : true,
        )
        .filter((item) => isInAustralia(item.latitude, item.longitude));
      if (stagedResults.length > 0) {
        nominatimResults = stagedResults.slice(0, NOMINATIM_RESULTS_PER_STAGE);
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
      const hadNominatimIssue = warnings.some((warning) =>
        nominatimWarningCodes.has(warning.code),
      );
      if (hadNominatimIssue) {
        const kept = warnings.filter(
          (warning) => !nominatimWarningCodes.has(warning.code),
        );
        warnings.length = 0;
        warnings.push(...kept, {
          code: "LOCATION_INVALID",
          error: "Location invalid",
        });
      } else {
        warnings.push({
          code: "NO_NEARBY_RESULTS",
          error: "No nearby places found yet. Try Use area or type a place name.",
        });
      }
    }

    const dedupedLocal = Array.from(
      new Map(localResults.map((place) => [place.id, place])).values(),
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
}
