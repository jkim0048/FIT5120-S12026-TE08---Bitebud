-- INSTRUCTOR ONLY — DESTRUCTIVE
-- Drops and recreates the entire `public` schema. All data in `public` is lost.
-- Use only when intentionally wiping a Supabase dev DB before `prisma migrate deploy`.
-- Do NOT run against production or shared class databases without explicit approval.

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO postgres;
GRANT CREATE ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;
