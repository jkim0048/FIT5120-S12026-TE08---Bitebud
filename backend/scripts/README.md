# Backend scripts

## Database backup (`backup-supabase-db.mjs`)

Creates a plain SQL dump of your Supabase `public` schema under `backend/backups/` (gitignored).

### Prerequisites

1. `DIRECT_URL` in the repo root `.env` or `backend/.env` (Supabase **Session** pooler, port **5432**).
2. [PostgreSQL client tools](https://www.postgresql.org/download/) installed. Scripts look for `pg_dump` / `psql` on PATH and, on Windows, under `C:\Program Files\PostgreSQL\<version>\bin\`.

### Backup

From `backend/`:

```bash
npm run db:backup
```

Output example: `backend/backups/supabase-2026-05-18T05-11-31.sql`

### Restore (`restore-supabase-db.mjs`)

**Warning:** restores SQL into the database pointed to by `DIRECT_URL`. Can overwrite existing rows. Not run automatically.

Requires explicit confirmation:

```bash
# Newest file in backend/backups/
RESTORE_CONFIRM=yes npm run db:restore -- --latest

# Specific file
RESTORE_CONFIRM=yes npm run db:restore -- backups/supabase-2026-05-18T05-11-31.sql
```

Uses `psql` with `ON_ERROR_STOP=1` and a 5-second cancel window before applying.

### Notes

- Do not commit `.env` or `backups/` — both are ignored by git.
- `DATABASE_URL` with `pgbouncer=true` / port 6543 is not suitable; use `DIRECT_URL`.
- Prisma-only query params (`schema=public`, `pgbouncer=true`) are stripped before connecting.
