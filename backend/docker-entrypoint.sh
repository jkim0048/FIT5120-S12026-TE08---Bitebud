#!/bin/sh
set -e
echo "Prisma migrate deploy..."
npx prisma migrate deploy
exec node dist/index.js
