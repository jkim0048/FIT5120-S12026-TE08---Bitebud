#!/bin/sh
set -e
# Set SKIP_PRISMA_MIGRATE=1 in Cloud Run if DIRECT_URL still points at a pooler (Prisma needs direct Postgres for advisory locks).
if [ "$SKIP_PRISMA_MIGRATE" = "1" ]; then
  echo "Skipping Prisma migrate on start (SKIP_PRISMA_MIGRATE=1)."
elif [ -n "$DIRECT_URL" ]; then
  echo "Prisma migrate deploy (direct connection)..."
  DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy
else
  echo "Prisma migrate deploy..."
  npx prisma migrate deploy
fi
exec node dist/index.js
