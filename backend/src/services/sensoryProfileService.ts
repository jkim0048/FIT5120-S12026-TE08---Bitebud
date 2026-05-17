import crypto from "crypto";
import type { SensoryFoodStatus } from "@prisma/client";
import { iconCatalogDatabase } from "../database/iconCatalogDatabase.js";
import { sensoryProfileDatabase } from "../database/sensoryProfileDatabase.js";
import { formatIngredientDisplayLabel } from "./icons.js";

const profileInclude = { foodItems: true } as const;

/** SHA-256 digest of a profile retrieval code (never store the raw code). */
export function hashSensoryCode(code: string): string {
  return crypto.createHash("sha256").update(`bitebud:${code}`).digest("hex");
}

/** Load the user's sensory profile and food items, if any. */
export async function getSensoryProfileForUser(userId: string) {
  const profile = await sensoryProfileDatabase.sensoryProfileFindUnique({
    where: { userId },
    include: profileInclude,
  });
  return { hasProfile: Boolean(profile), profile: profile ?? null };
}

/** Create or update profile settings (texture, dietary, cultural) for a user. */
export async function saveSensoryProfile(
  userId: string,
  body: {
    texturePrefs: string[];
    dietaryNeeds: string[];
    culturalRequirements: string[];
  },
) {
  const codeHash = hashSensoryCode(userId);
  const profile = await sensoryProfileDatabase.sensoryProfileUpsert({
    where: { userId },
    create: {
      userId,
      codeHash,
      texturePrefs: body.texturePrefs,
      dietaryNeeds: body.dietaryNeeds,
      culturalRequirements: body.culturalRequirements,
    },
    update: {
      codeHash,
      texturePrefs: body.texturePrefs,
      dietaryNeeds: body.dietaryNeeds,
      culturalRequirements: body.culturalRequirements,
    },
    include: profileInclude,
  });
  return { ok: true, profileId: profile.id, profile };
}

export type SensoryItemError =
  | { kind: "no_profile" }
  | { kind: "unknown_icon" }
  | { kind: "unknown_ingredient" }
  | { kind: "missing_name" }
  | { kind: "duplicate" };

/** Add a food item to the user's sensory profile. */
export async function createSensoryFoodItem(
  userId: string,
  body: {
    name?: string;
    ingredientKey?: string;
    wickedIconId?: string;
    status: SensoryFoodStatus;
    notes?: Record<string, unknown>;
  },
) {
  const prof = await sensoryProfileDatabase.sensoryProfileFindUnique({
    where: { userId },
    select: { id: true },
  });
  if (!prof) return { kind: "no_profile" } as SensoryItemError;

  const existing = await sensoryProfileDatabase.sensoryFoodItemFindMany({
    where: { profileId: prof.id },
  });

  let name = body.name?.trim() ?? "";
  let notes: Record<string, unknown> = { ...(body.notes ?? {}) };

  if (body.wickedIconId) {
    const id = body.wickedIconId.trim();
    const icon = await iconCatalogDatabase.wickedIconFindUnique({ where: { id } });
    if (!icon) return { kind: "unknown_icon" } as SensoryItemError;
    const base = icon.name?.trim() || formatIngredientDisplayLabel(id.replace(/-/g, " "));
    name = base.slice(0, 200);
    notes = { ...notes, wickedIconId: id };
    delete notes.ingredientKey;
  } else if (body.ingredientKey) {
    const key = body.ingredientKey.trim();
    const mapRow = await iconCatalogDatabase.ingredientIconMapFindUnique({
      where: { ingredientKey: key },
    });
    if (!mapRow) return { kind: "unknown_ingredient" } as SensoryItemError;
    name = formatIngredientDisplayLabel(key);
    notes = { ...notes, ingredientKey: key };
    delete notes.wickedIconId;
  }

  if (!name) return { kind: "missing_name" } as SensoryItemError;

  const wid = typeof notes.wickedIconId === "string" ? notes.wickedIconId : undefined;
  const keyFromNotes = typeof notes.ingredientKey === "string" ? notes.ingredientKey : undefined;
  if (wid) {
    const dup = existing.some((row) => {
      const n = row.notes as { wickedIconId?: string } | null;
      return n?.wickedIconId === wid;
    });
    if (dup) return { kind: "duplicate" } as SensoryItemError;
  } else if (keyFromNotes) {
    const dup = existing.some((row) => {
      const n = row.notes as { ingredientKey?: string } | null;
      return n?.ingredientKey === keyFromNotes;
    });
    if (dup) return { kind: "duplicate" } as SensoryItemError;
  } else {
    const dupName = existing.some((row) => row.name.trim().toLowerCase() === name.toLowerCase());
    if (dupName) return { kind: "duplicate" } as SensoryItemError;
  }

  const item = await sensoryProfileDatabase.sensoryFoodItemCreate({
    data: {
      profileId: prof.id,
      name,
      status: body.status,
      notes: notes as object,
    },
  });
  return { item };
}

export type ItemNotFound = { kind: "not_found" };

/** Update a food item on the user's profile. */
export async function patchSensoryFoodItem(
  userId: string,
  itemId: string,
  body: {
    name?: string;
    status?: SensoryFoodStatus;
    notes?: Record<string, unknown>;
  },
) {
  const existing = await sensoryProfileDatabase.sensoryFoodItemFindFirst({
    where: { id: itemId, profile: { userId } },
  });
  if (!existing) return { kind: "not_found" } as ItemNotFound;
  const item = await sensoryProfileDatabase.sensoryFoodItemUpdate({
    where: { id: existing.id },
    data: {
      ...(body.name != null ? { name: body.name } : {}),
      ...(body.status != null ? { status: body.status } : {}),
      ...(body.notes !== undefined ? { notes: body.notes as object } : {}),
    },
  });
  return { item };
}

/** Remove a food item from the user's profile. */
export async function deleteSensoryFoodItem(userId: string, itemId: string) {
  const existing = await sensoryProfileDatabase.sensoryFoodItemFindFirst({
    where: { id: itemId, profile: { userId } },
  });
  if (!existing) return { kind: "not_found" } as ItemNotFound;
  await sensoryProfileDatabase.sensoryFoodItemDelete({ where: { id: existing.id } });
  return { ok: true };
}

export type RetrieveLocked = { kind: "locked"; retrySeconds: number };
export type RetrieveInvalid = { kind: "invalid" };

/** Look up a sensory profile by its retrieval code (with brute-force lockout). */
export async function retrieveSensoryProfileByCode(code: string) {
  const codeHash = hashSensoryCode(code);
  const attempt = await sensoryProfileDatabase.sensoryCodeAttemptFindUnique({
    where: { codeHash },
  });
  const now = new Date();
  if (attempt?.lockoutUntil && attempt.lockoutUntil > now) {
    const retrySeconds = Math.ceil((attempt.lockoutUntil.getTime() - now.getTime()) / 1000);
    return { kind: "locked", retrySeconds } as RetrieveLocked;
  }

  const profile = await sensoryProfileDatabase.sensoryProfileFindUnique({
    where: { codeHash },
    include: profileInclude,
  });
  if (!profile) {
    const nextCount = (attempt?.failedCount ?? 0) + 1;
    const lockoutUntil =
      nextCount >= 10
        ? new Date(Date.now() + 10 * 60 * 1000)
        : new Date(Date.now() + Math.min(nextCount * 5, 60) * 1000);
    await sensoryProfileDatabase.sensoryCodeAttemptUpsert({
      where: { codeHash },
      create: {
        codeHash,
        failedCount: nextCount,
        lockoutUntil,
        lastFailedAt: now,
      },
      update: {
        failedCount: nextCount,
        lockoutUntil,
        lastFailedAt: now,
      },
    });
    return { kind: "invalid" } as RetrieveInvalid;
  }

  if (attempt) {
    await sensoryProfileDatabase.sensoryCodeAttemptDelete({ where: { codeHash } });
  }
  return { ok: true, profile };
}
