import dotenv from "dotenv";
import path from "path";

const backendEnv = path.resolve(process.cwd(), ".env");
const rootEnv = path.resolve(process.cwd(), "../.env");

// Optional repo-local overrides (backend/.env) — loaded first, non-destructive.
dotenv.config({ path: backendEnv });
// Canonical app config from repo root `.env` — must win over OS-level DATABASE_URL
// and over backend/.env (dotenv default is not to override; we force override here).
dotenv.config({ path: rootEnv, override: true });

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing required env: ${name}`);
  return v.trim();
}
