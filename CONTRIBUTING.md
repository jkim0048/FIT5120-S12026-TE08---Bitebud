# Contributing (course / team)

## Keeping behavior stable

Small doc or comment edits are fine. For anything that touches **runtime** (`*.ts`, `*.vue`, `package.json`, Prisma schema/migrations, Docker/Firebase config), use a **branch**, run **`npm run dev`** and **`npm run build --prefix frontend`**, and avoid rewriting migrations that are already applied to shared databases.

- **Do not commit secrets.** Never add `.env`, `deploy/cloudrun-env.generated.yaml`, `frontend/.env.production`, or API keys to the repo.
- **Branches:** Use short, descriptive branch names (e.g. `fix/cors`, `feature/sensory-filter`).
- **Before opening a PR:** From repo root, run `npm run build --prefix frontend` and ensure `npm run dev` still starts. If you changed the database schema, add a Prisma migration (`cd backend && npm run prisma:migrate`) and describe it in the PR.
- **Questions:** Ask your instructor or maintainer for review before large refactors or dependency upgrades.
