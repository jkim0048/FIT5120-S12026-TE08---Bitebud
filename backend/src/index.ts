import "./env.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { registerRecipeRoutes } from "./routes/recipes.js";
import { registerIconRoutes } from "./routes/icons.js";
import { registerSensoryRoutes } from "./routes/sensory.js";
import { registerRestaurantRoutes } from "./routes/restaurants.js";

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST ?? "0.0.0.0";

const app = Fastify({ logger: true });

app.setErrorHandler((err, _request, reply) => {
  // Ensure user-facing validation errors are returned as 400s with a readable message.
  if (err instanceof ZodError) {
    const first = err.issues[0];
    // We intentionally return only the first issue to keep UI errors short and actionable.
    const message = first?.message?.trim() || "Invalid request";
    return reply.status(400).send({ error: message, code: "INVALID_INPUT" });
  }
  return reply.send(err);
});

await app.register(cors, {
  origin: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-User-Id"],
});

app.get("/", async () => ({
  service: "bitesbud-api",
  health: "/api/health",
}));

app.get("/api/health", async () => ({ ok: true }));

await registerRecipeRoutes(app);
await registerIconRoutes(app);
await registerSensoryRoutes(app);
await registerRestaurantRoutes(app);

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
