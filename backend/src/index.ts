import "./env.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerRecipeRoutes } from "./routes/recipes.js";
import { registerIconRoutes } from "./routes/icons.js";
import { registerSensoryRoutes } from "./routes/sensory.js";

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST ?? "0.0.0.0";

const app = Fastify({ logger: true });

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

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
