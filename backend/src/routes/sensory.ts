import type { FastifyInstance } from "fastify";
import crypto from "crypto";
import { z } from "zod";
import type { SensoryFoodStatus } from "@prisma/client";
import { parseBiteBudUserId } from "../biteBudUserId.js";
import { prisma } from "../prisma.js";
import { formatIngredientDisplayLabel } from "../services/icons.js";

const saveBody = z
  .object({
    texturePrefs: z.array(z.string()).default([]),
    temperaturePref: z.string().optional().nullable(),
    dietaryNeeds: z.array(z.string()).default([]),
    culturalRequirements: z.array(z.string()).default([]),
  })
  .strip();

const notesSchema = z
  .object({
    texture: z.string().max(500).optional(),
    smell: z.string().max(500).optional(),
    temperature: z.string().max(500).optional(),
    ingredientKey: z.string().max(200).optional(),
    wickedIconId: z.string().max(200).optional(),
  })
  .strict();

const createItemBody = z
  .object({
    name: z.string().min(1).max(200).trim().optional(),
    ingredientKey: z.string().min(1).max(200).trim().optional(),
    wickedIconId: z.string().min(1).max(200).trim().optional(),
    status: z.enum(["SAFE", "UNSURE", "UNSAFE"]),
    notes: notesSchema.optional(),
  })
  .refine((b) => Boolean(b.name?.length || b.ingredientKey?.length || b.wickedIconId?.length), {
    message: "Provide name, ingredientKey, or wickedIconId",
    path: ["name"],
  });

const patchItemBody = z.object({
  name: z.string().min(1).max(200).trim().optional(),
  status: z.enum(["SAFE", "UNSURE", "UNSAFE"]).optional(),
  notes: notesSchema.optional(),
});

const retrieveBody = z.object({
  code: z
    .string()
    .transform((s) => s.trim().toUpperCase())
    .refine((s) => /^\d{3}$/.test(s) || /^[A-Z0-9]{3}$/.test(s)),
});

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(`bitebud:${code}`).digest("hex");
}

const profileInclude = { foodItems: true } as const;

export async function registerSensoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/sensory/me", async (request, reply) => {
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) {
      return reply.status(400).send({ error: "Missing or invalid X-User-Id" });
    }
    const profile = await prisma.sensoryProfile.findUnique({
      where: { userId },
      include: profileInclude,
    });
    return { hasProfile: Boolean(profile), profile: profile ?? null };
  });

  app.post("/api/sensory/profile", async (request, reply) => {
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) {
      return reply.status(400).send({ error: "Missing or invalid X-User-Id" });
    }
    const body = saveBody.parse(request.body);
    const codeHash = hashCode(userId);

    const profile = await prisma.sensoryProfile.upsert({
      where: { userId },
      create: {
        userId,
        codeHash,
        texturePrefs: body.texturePrefs,
        temperaturePref: body.temperaturePref ?? null,
        dietaryNeeds: body.dietaryNeeds,
        culturalRequirements: body.culturalRequirements,
      },
      update: {
        codeHash,
        texturePrefs: body.texturePrefs,
        temperaturePref: body.temperaturePref ?? null,
        dietaryNeeds: body.dietaryNeeds,
        culturalRequirements: body.culturalRequirements,
      },
      include: profileInclude,
    });
    return { ok: true, profileId: profile.id, profile };
  });

  app.post("/api/sensory/items", async (request, reply) => {
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) {
      return reply.status(400).send({ error: "Missing or invalid X-User-Id" });
    }
    const body = createItemBody.parse(request.body);
    const prof = await prisma.sensoryProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!prof) {
      return reply
        .status(400)
        .send({ error: "Save your profile (code and settings) before adding foods." });
    }

    const existing = await prisma.sensoryFoodItem.findMany({
      where: { profileId: prof.id },
    });

    let name = body.name?.trim() ?? "";
    let notes: Record<string, unknown> = { ...(body.notes ?? {}) };

    if (body.wickedIconId) {
      const id = body.wickedIconId.trim();
      const icon = await prisma.wickedIcon.findUnique({ where: { id } });
      if (!icon) {
        return reply.status(400).send({ error: "Unknown icon — pick from the list." });
      }
      const base = icon.name?.trim() || formatIngredientDisplayLabel(id.replace(/-/g, " "));
      name = base.slice(0, 200);
      notes = { ...notes, wickedIconId: id };
      delete notes.ingredientKey;
    } else if (body.ingredientKey) {
      const key = body.ingredientKey.trim();
      const mapRow = await prisma.ingredientIconMap.findUnique({
        where: { ingredientKey: key },
      });
      if (!mapRow) {
        return reply.status(400).send({ error: "Unknown ingredient — pick from the list." });
      }
      name = formatIngredientDisplayLabel(key);
      notes = { ...notes, ingredientKey: key };
      delete notes.wickedIconId;
    }

    if (!name) {
      return reply.status(400).send({ error: "Missing food name" });
    }

    const wid = typeof notes.wickedIconId === "string" ? notes.wickedIconId : undefined;
    const keyFromNotes = typeof notes.ingredientKey === "string" ? notes.ingredientKey : undefined;
    if (wid) {
      const dup = existing.some((row) => {
        const n = row.notes as { wickedIconId?: string } | null;
        return n?.wickedIconId === wid;
      });
      if (dup) {
        return reply.status(409).send({ error: "That icon is already on your list." });
      }
    } else if (keyFromNotes) {
      const dup = existing.some((row) => {
        const n = row.notes as { ingredientKey?: string } | null;
        return n?.ingredientKey === keyFromNotes;
      });
      if (dup) {
        return reply.status(409).send({ error: "That ingredient is already on your list." });
      }
    } else {
      const dupName = existing.some((row) => row.name.trim().toLowerCase() === name.toLowerCase());
      if (dupName) {
        return reply.status(409).send({ error: "That food is already on your list." });
      }
    }

    const item = await prisma.sensoryFoodItem.create({
      data: {
        profileId: prof.id,
        name,
        status: body.status as SensoryFoodStatus,
        notes: notes as object,
      },
    });
    return reply.send({ item });
  });

  app.patch("/api/sensory/items/:itemId", async (request, reply) => {
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) {
      return reply.status(400).send({ error: "Missing or invalid X-User-Id" });
    }
    const { itemId } = request.params as { itemId: string };
    const idParse = z.string().uuid().safeParse(itemId);
    if (!idParse.success) {
      return reply.status(400).send({ error: "Invalid item id" });
    }
    const body = patchItemBody.parse(request.body);
    const existing = await prisma.sensoryFoodItem.findFirst({
      where: { id: idParse.data, profile: { userId } },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Not found" });
    }
    const item = await prisma.sensoryFoodItem.update({
      where: { id: existing.id },
      data: {
        ...(body.name != null ? { name: body.name } : {}),
        ...(body.status != null ? { status: body.status as SensoryFoodStatus } : {}),
        ...(body.notes !== undefined ? { notes: body.notes as object } : {}),
      },
    });
    return reply.send({ item });
  });

  app.delete("/api/sensory/items/:itemId", async (request, reply) => {
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) {
      return reply.status(400).send({ error: "Missing or invalid X-User-Id" });
    }
    const { itemId } = request.params as { itemId: string };
    const idParse = z.string().uuid().safeParse(itemId);
    if (!idParse.success) {
      return reply.status(400).send({ error: "Invalid item id" });
    }
    const existing = await prisma.sensoryFoodItem.findFirst({
      where: { id: idParse.data, profile: { userId } },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Not found" });
    }
    await prisma.sensoryFoodItem.delete({ where: { id: existing.id } });
    return reply.send({ ok: true });
  });

  app.post("/api/sensory/retrieve", async (request, reply) => {
    const body = retrieveBody.parse(request.body);
    const codeHash = hashCode(body.code);
    const attempt = await prisma.sensoryCodeAttempt.findUnique({
      where: { codeHash },
    });
    const now = new Date();
    if (attempt?.lockoutUntil && attempt.lockoutUntil > now) {
      const retrySeconds = Math.ceil(
        (attempt.lockoutUntil.getTime() - now.getTime()) / 1000,
      );
      return reply
        .status(429)
        .send({ error: "Code temporarily locked", retrySeconds });
    }

    const profile = await prisma.sensoryProfile.findUnique({
      where: { codeHash },
      include: profileInclude,
    });
    if (!profile) {
      const nextCount = (attempt?.failedCount ?? 0) + 1;
      const lockoutUntil =
        nextCount >= 10
          ? new Date(Date.now() + 10 * 60 * 1000)
          : new Date(Date.now() + Math.min(nextCount * 5, 60) * 1000);
      await prisma.sensoryCodeAttempt.upsert({
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
      return reply.status(404).send({ error: "Invalid code" });
    }

    if (attempt) {
      await prisma.sensoryCodeAttempt.delete({ where: { codeHash } });
    }
    return { ok: true, profile };
  });
}
