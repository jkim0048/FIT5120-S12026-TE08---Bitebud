# BiteBud

BiteBud is a neurodiverse friendly cooking assistant with visual recipe flow, sensory profiling, and guided cooking.

## Tech stack

- **Frontend**: Vue 3, Vite, TypeScript
- **Backend**: Node.js (TypeScript), Fastify
- **Database**: PostgreSQL via Prisma
- **AI**: Gemini (Google Generative AI)
- **Deploy (optional)**: Google Cloud Run (API) + Firebase Hosting (web)

## Quick start (local dev)

From the repo root:

- **Install**
  - `npm install`
  - `npm install --prefix backend`
  - `npm install --prefix frontend`

- **Environment**
  - Create a root env file: `.env` (used by backend scripts via `dotenv -e ../.env ...`).
  - Minimum backend vars commonly used:
    - `DATABASE_URL`
    - `DIRECT_URL`
    - `GEMINI_API_KEY` (optional if you don’t use AI features)

- **Run**
  - `npm run dev` (backend + frontend)
  - Or separately: `npm run dev:backend`, `npm run dev:frontend`

## Key features

- **Recipe search + library browsing** (including prep-time filters)
- **Recipe visual overview** (lane-based flow + inline step details)
- **Full steps view**
- **Guided cooking mode** (ingredient checklist + step-by-step)
- **Sensory profile setup** + ingredient conflict warnings
- **Dietary & cultural constraint checks**
- **Import recipes** (paste text or fetch from URL)
- **AI refine + recipe lede generation**

