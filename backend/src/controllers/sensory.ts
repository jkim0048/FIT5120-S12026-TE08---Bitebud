import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SensoryFoodStatus } from "@prisma/client";
import { parseBiteBudUserId } from "../biteBudUserId.js";
import {
  createSensoryFoodItem,
  deleteSensoryFoodItem,
  getSensoryProfileForUser,
  patchSensoryFoodItem,
  retrieveSensoryProfileByCode,
  saveSensoryProfile,
} from "../services/sensoryProfileService.js";

const saveBody = z
  .object({
    texturePrefs: z.array(z.string()).default([]),
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

/**
 * Register every `/api/sensory/*` endpoint group on the Fastify app
 * (profile CRUD, food-item CRUD, and code-based profile retrieval with rate-limited brute-force guard).
 */
export async function registerSensoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/sensory/me", async (request, reply) => {
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) {
      return reply.status(400).send({ error: "Missing or invalid X-User-Id" });
    }
    return getSensoryProfileForUser(userId);
  });

  app.post("/api/sensory/profile", async (request, reply) => {
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) {
      return reply.status(400).send({ error: "Missing or invalid X-User-Id" });
    }
    const body = saveBody.parse(request.body);
    return saveSensoryProfile(userId, body);
  });

  app.post("/api/sensory/items", async (request, reply) => {
    const userId = parseBiteBudUserId(request.headers["x-user-id"] as string | undefined);
    if (!userId) {
      return reply.status(400).send({ error: "Missing or invalid X-User-Id" });
    }
    const body = createItemBody.parse(request.body);
    const result = await createSensoryFoodItem(userId, {
      ...body,
      status: body.status as SensoryFoodStatus,
      notes: body.notes,
    });
    if ("kind" in result) {
      if (result.kind === "no_profile") {
        return reply
          .status(400)
          .send({ error: "Save your profile (code and settings) before adding foods." });
      }
      if (result.kind === "unknown_icon") {
        return reply.status(400).send({ error: "Unknown icon — pick from the list." });
      }
      if (result.kind === "unknown_ingredient") {
        return reply.status(400).send({ error: "Unknown ingredient — pick from the list." });
      }
      if (result.kind === "missing_name") {
        return reply.status(400).send({ error: "Missing food name" });
      }
      if (result.kind === "duplicate") {
        return reply.status(409).send({ error: "That item is already on your list." });
      }
    }
    return reply.send(result);
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
    const result = await patchSensoryFoodItem(userId, idParse.data, {
      ...body,
      status: body.status as SensoryFoodStatus | undefined,
      notes: body.notes,
    });
    if ("kind" in result && result.kind === "not_found") {
      return reply.status(404).send({ error: "Not found" });
    }
    return reply.send(result);
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
    const result = await deleteSensoryFoodItem(userId, idParse.data);
    if ("kind" in result && result.kind === "not_found") {
      return reply.status(404).send({ error: "Not found" });
    }
    return reply.send(result);
  });

  app.post("/api/sensory/retrieve", async (request, reply) => {
    const body = retrieveBody.parse(request.body);
    const result = await retrieveSensoryProfileByCode(body.code);
    if ("kind" in result) {
      if (result.kind === "locked") {
        return reply
          .status(429)
          .send({ error: "Code temporarily locked", retrySeconds: result.retrySeconds });
      }
      if (result.kind === "invalid") {
        return reply.status(404).send({ error: "Invalid code" });
      }
    }
    return result;
  });
}
