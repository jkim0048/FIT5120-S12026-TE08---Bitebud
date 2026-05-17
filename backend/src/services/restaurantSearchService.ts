import {
  ensureRestaurantSeedData,
  restaurantDatabase,
} from "../database/restaurantDatabase.js";
import {
  NEARBY_RADIUS_KM,
  comfortBadge,
  dedupeKey,
  distanceKm,
  isAllowedNominatimPlace,
  isInAustralia,
  isUsefulLocationSuggestItem,
  maybeString,
  normalizeName,
  reverseNominatim,
  searchNominatim,
  suburbForAreaSearch,
  toSuburb,
  type NominatimSearchItem,
} from "./restaurantNominatimClient.js";
import {
  isPrismaSchemaMissingError,
  isPrismaUnavailableError,
  schemaMissingResponse,
} from "./restaurantPrismaErrors.js";

const LOCATION_SUGGEST_DEFAULT_LIMIT = 8;
const PLACE_SUGGEST_DEFAULT_LIMIT = 8;
const PLACE_SUGGEST_MAX_LIMIT = 12;
const PLACE_SUGGEST_DB_OVERFETCH = 16;
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

export type LocationSuggestionDto = {
  id: string;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  latitude: number;
  longitude: number;
  displayName: string;
  areaSearch: string;
};

export type PlaceSuggestionDto = {
  id: string;
  name: string;
  subtitle: string | null;
  source: "bitebud" | "nominatim";
  latitude: number;
  longitude: number;
  nominatimPlaceId?: string;
};

export type RestaurantSearchResultDto = Record<string, unknown>;

export type RestaurantSearchResponseDto = {
  areaContext: string | null;
  results: RestaurantSearchResultDto[];
  warnings: Array<{ code: string; error: string }>;
  modeUsed: "typed" | "near_me" | "area";
  fallbackStageUsed: "none" | "expanded" | "relaxed";
  sourceCounts: { bitebud: number; nominatim: number };
};

type PlaceSuggestRow = {
  id: string;
  name: string;
  subtitle: string | null;
  source: "bitebud" | "nominatim";
  latitude: number;
  longitude: number;
  nominatimPlaceId?: string;
  reviewCount: number;
  distanceKm: number | null;
};

type DbAvailability = { available: boolean; warnings: Array<{ code: string; error: string }> };

/** Ensure seed data; return whether Prisma is usable and any startup warnings. */
async function resolveDbAvailability(): Promise<DbAvailability> {
  const warnings: Array<{ code: string; error: string }> = [];
  try {
    await ensureRestaurantSeedData();
    return { available: true, warnings };
  } catch (err) {
    if (isPrismaSchemaMissingError(err)) {
      warnings.push(schemaMissingResponse());
      return { available: false, warnings };
    }
    if (isPrismaUnavailableError(err)) {
      warnings.push({
        code: "DB_UNAVAILABLE",
        error:
          "Restaurant database is not configured or unreachable (set DATABASE_URL in the repo root .env). Showing OpenStreetMap results only.",
      });
      return { available: false, warnings };
    }
    throw err;
  }
}

/** Rank autocomplete rows: exact/prefix name match, BiteBud source, reviews, and proximity to the anchor pin. */
function scorePlaceSuggestion(row: PlaceSuggestRow, normalizedQuery: string): number {
  let score = 0;
  const normalizedName = normalizeName(row.name);
  if (normalizedName === normalizedQuery) score += 120;
  else if (normalizedName.startsWith(normalizedQuery)) score += 90;
  else if (normalizedName.includes(normalizedQuery)) score += 55;
  if (row.source === "bitebud") score += 40;
  if (row.reviewCount > 0) score += 25;
  if (typeof row.distanceKm === "number") {
    score += Math.max(0, 30 - row.distanceKm);
  }
  return score;
}

/** Validate GPS pins for Australia; drop out-of-bounds coords and append a warning when ignored. */
function resolveSearchCoords(
  lat?: number,
  lon?: number,
  warnings?: Array<{ code: string; error: string }>,
): { searchLat?: number; searchLon?: number } {
  let searchLat = typeof lat === "number" && Number.isFinite(lat) ? lat : undefined;
  let searchLon = typeof lon === "number" && Number.isFinite(lon) ? lon : undefined;
  if (
    searchLat !== undefined &&
    searchLon !== undefined &&
    !isInAustralia(searchLat, searchLon)
  ) {
    warnings?.push({
      code: "LOCATION_OUTSIDE_AU",
      error:
        "Search is limited to Australia. GPS outside Australia was ignored — enter an Australian suburb or place name.",
    });
    searchLat = undefined;
    searchLon = undefined;
  }
  return { searchLat, searchLon };
}

/** Autocomplete suburbs/postcodes for the unified search bar. */
export async function suggestLocations(
  q: string,
  limit?: number,
): Promise<{ suggestions: LocationSuggestionDto[]; warning?: { code: string; error: string } }> {
  const wantedCount = Math.min(LOCATION_SUGGEST_MAX_LIMIT, limit ?? LOCATION_SUGGEST_DEFAULT_LIMIT);
  const remote = await searchNominatim(q, {
    bounded: false,
    limit: Math.min(LOCATION_SUGGEST_REMOTE_MAX, wantedCount + LOCATION_SUGGEST_REMOTE_OVERFETCH),
    timeoutMs: LOCATION_SUGGEST_TIMEOUT_MS,
  });
  const seenKeys = new Set<string>();
  const suggestions: LocationSuggestionDto[] = [];

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
    const displayName = maybeString(item.display_name) ?? maybeString(item.name) ?? areaSearch;
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

  return { suggestions, warning: remote.warning };
}

/** Autocomplete restaurant names (and cuisine text matches on BiteBud places). */
export async function suggestPlaces(params: {
  q: string;
  lat?: number;
  lon?: number;
  suburb?: string;
  limit?: number;
}): Promise<{ suggestions: PlaceSuggestionDto[]; warning?: { code: string; error: string } }> {
  const { q, lat, lon, suburb, limit } = params;
  const wantedCount = Math.min(PLACE_SUGGEST_MAX_LIMIT, limit ?? PLACE_SUGGEST_DEFAULT_LIMIT);
  const normalizedQuery = normalizeName(q);
  const warnings: Array<{ code: string; error: string }> = [];
  const { searchLat, searchLon } = resolveSearchCoords(lat, lon, warnings);
  const hasCoords = typeof searchLat === "number" && typeof searchLon === "number";
  let localContextSuburb = suburb?.trim() || undefined;
  if (!localContextSuburb && hasCoords) {
    const reverse = await reverseNominatim(searchLat!, searchLon!);
    localContextSuburb = reverse.suburb;
  }

  const candidates: PlaceSuggestRow[] = [];
  const seenKeys = new Set<string>();
  const dbState = await resolveDbAvailability();

  if (dbState.available) {
    let dbPlaces = await restaurantDatabase.restaurantPlaceFindMany({
      where: {
        AND: [
          {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { displayName: { contains: q, mode: "insensitive" } },
              { cuisine: { contains: q, mode: "insensitive" } },
            ],
          },
          localContextSuburb
            ? { suburb: { contains: localContextSuburb, mode: "insensitive" } }
            : {},
        ],
      },
      include: { reviews: true },
      take: PLACE_SUGGEST_DB_OVERFETCH,
    });
    if (!dbPlaces.length) {
      dbPlaces = await restaurantDatabase.restaurantPlaceFindMany({
        where: {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { displayName: { contains: q, mode: "insensitive" } },
            { cuisine: { contains: q, mode: "insensitive" } },
          ],
        },
        include: { reviews: true },
        take: PLACE_SUGGEST_DB_OVERFETCH,
      });
    }
    for (const place of dbPlaces) {
      if (!isInAustralia(place.latitude, place.longitude)) continue;
      const key = dedupeKey(place.name, place.latitude, place.longitude);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const distanceFromAnchor = hasCoords
        ? distanceKm(searchLat!, searchLon!, place.latitude, place.longitude)
        : null;
      if (typeof distanceFromAnchor === "number" && distanceFromAnchor > NEARBY_RADIUS_KM) {
        continue;
      }
      candidates.push({
        id: place.id,
        name: place.name,
        subtitle: place.suburb ?? place.address ?? place.displayName,
        source: "bitebud",
        latitude: place.latitude,
        longitude: place.longitude,
        reviewCount: place.reviews.length,
        distanceKm:
          distanceFromAnchor === null ? null : Number(distanceFromAnchor.toFixed(1)),
      });
    }
  }

  const nominatimQuery =
    localContextSuburb && hasCoords
      ? `${q} restaurant near ${localContextSuburb}`
      : localContextSuburb
        ? `${q} restaurant ${localContextSuburb}`
        : q;
  const remote = await searchNominatim(nominatimQuery, {
    lat: searchLat,
    lon: searchLon,
    bounded: hasCoords,
    limit: wantedCount + 6,
    timeoutMs: LOCATION_SUGGEST_TIMEOUT_MS,
  });
  for (const item of remote.items) {
    if (!isAllowedNominatimPlace(item)) continue;
    const latNum = Number(item.lat ?? "");
    const lonNum = Number(item.lon ?? "");
    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) continue;
    if (!isInAustralia(latNum, lonNum)) continue;
    const itemName = maybeString(item.name) ?? maybeString(item.display_name) ?? "Restaurant";
    const key = dedupeKey(itemName, latNum, lonNum);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const distanceFromAnchor = hasCoords
      ? distanceKm(searchLat!, searchLon!, latNum, lonNum)
      : null;
    if (typeof distanceFromAnchor === "number" && distanceFromAnchor > NEARBY_RADIUS_KM) {
      continue;
    }
    candidates.push({
      id:
        item.place_id != null
          ? `nominatim:${item.place_id}`
          : `nominatim:${item.osm_type ?? "?"}:${item.osm_id ?? "?"}`,
      name: itemName,
      subtitle: toSuburb(item.address) ?? maybeString(item.display_name),
      source: "nominatim",
      latitude: latNum,
      longitude: lonNum,
      nominatimPlaceId: item.place_id != null ? String(item.place_id) : undefined,
      reviewCount: 0,
      distanceKm:
        distanceFromAnchor === null ? null : Number(distanceFromAnchor.toFixed(1)),
    });
  }

  const suggestions = candidates
    .map((row) => ({ row, score: scorePlaceSuggestion(row, normalizedQuery) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, wantedCount)
    .map(({ row }) => ({
      id: row.id,
      name: row.name,
      subtitle: row.subtitle,
      source: row.source,
      latitude: row.latitude,
      longitude: row.longitude,
      ...(row.nominatimPlaceId ? { nominatimPlaceId: row.nominatimPlaceId } : {}),
    }));

  return { suggestions, warning: remote.warning };
}

/** Parallel area + place suggestions for one search bar. */
export async function suggestUnified(params: {
  q: string;
  lat?: number;
  lon?: number;
  suburb?: string;
  limit?: number;
}): Promise<{
  areas: LocationSuggestionDto[];
  places: PlaceSuggestionDto[];
  warning?: { code: string; error: string };
}> {
  const limit = params.limit ?? LOCATION_SUGGEST_DEFAULT_LIMIT;
  const [locations, places] = await Promise.all([
    suggestLocations(params.q, limit),
    suggestPlaces({ ...params, limit }),
  ]);
  return {
    areas: locations.suggestions,
    places: places.suggestions,
    warning: locations.warning ?? places.warning,
  };
}

/** Full restaurant search: BiteBud DB + Nominatim, area or typed mode. */
export async function searchRestaurants(params: {
  q?: string;
  lat?: number;
  lon?: number;
  suburb?: string;
  userId: string;
}): Promise<RestaurantSearchResponseDto> {
  const warnings: Array<{ code: string; error: string }> = [];
  const dbState = await resolveDbAvailability();
  warnings.push(...dbState.warnings);
  const dbAvailable = dbState.available;

  const { q, suburb, userId } = params;
  const { searchLat, searchLon } = resolveSearchCoords(params.lat, params.lon, warnings);

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
          ? place.reviews.reduce((runningSum, review) => runningSum + review.overallRating, 0) /
            reviewCount
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

  let nominatimResults: RestaurantSearchResultDto[] = [];
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
    if (hasCoords) {
      const context = localContextSuburb ?? "";
      nominatimQueryStages.push({
        query: context
          ? `${q.trim()} restaurant near ${context}`
          : `${q.trim()} restaurant`,
        bounded: true,
        limit: NOMINATIM_CATEGORY_PRIMARY_LIMIT,
        stage: "expanded",
      });
      nominatimQueryStages.push({
        query: context ? `${q.trim()} cafe near ${context}` : `${q.trim()} cafe`,
        bounded: false,
        limit: NOMINATIM_CATEGORY_FALLBACK_LIMIT,
        stage: "relaxed",
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
        typeof item.distanceKm === "number" ? item.distanceKm <= NEARBY_RADIUS_KM : true,
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
      const kept = warnings.filter((warning) => !nominatimWarningCodes.has(warning.code));
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
}
