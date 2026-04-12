# Deploy BiteBud (Cloud Run + Firebase Hosting)

Prerequisites: [Google Cloud SDK](https://cloud.google.com/sdk), [Firebase CLI](https://firebase.google.com/docs/cli) (or `npm i` at repo root). **Docker** is optional if you use **Cloud Build** (`gcloud builds submit`).

**Firebase Hosting + API:** If the Firebase GCP project has **no billing**, Hosting cannot attach rewrites to Cloud Run in that project. The default setup uses **`frontend/.env.production`** with **`VITE_API_ORIGIN`** set to your Cloud Run URL (copy from `frontend/.env.production.example`). With **Blaze** + Cloud Run API enabled on the Firebase project, you may restore a `run` rewrite in `firebase.json` and omit `VITE_API_ORIGIN` for same-origin `/api`.

## One-time GCP setup

```bash
gcloud config set project bitesbud
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com
gcloud artifacts repositories describe bitesbud-repo --location=australia-southeast1 || \
  gcloud artifacts repositories create bitesbud-repo --repository-format=docker --location=australia-southeast1
```

Configure Docker auth for Artifact Registry:

```bash
gcloud auth configure-docker australia-southeast1-docker.pkg.dev
```

## Backend (Cloud Run)

From the `wobble/` directory (same folder as `Dockerfile`):

1. Ensure `wobble/.env` contains production secrets (`DATABASE_URL`, `DIRECT_URL`, `GEMINI_API_KEY`, etc.).

2. Generate env file for Cloud Run (never commit `cloudrun-env.generated.yaml`):

   ```bash
   node deploy/prepare-cloudrun-env.mjs
   ```

3. Build and push the image — **either** local Docker **or** Cloud Build (no local Docker):

   ```bash
   # Cloud Build (recommended if Docker Desktop is unavailable)
   gcloud builds submit --tag australia-southeast1-docker.pkg.dev/bitesbud/bitesbud-repo/bitesbud-api:TAG --project=bitesbud --timeout=1200s .
   ```

   ```bash
   # Or local Docker
   docker build -t australia-southeast1-docker.pkg.dev/bitesbud/bitesbud-repo/bitesbud-api:TAG .
   docker push australia-southeast1-docker.pkg.dev/bitesbud/bitesbud-repo/bitesbud-api:TAG
   ```

4. Deploy:

   ```bash
   gcloud run deploy bitesbud-api ^
     --image %IMAGE% ^
     --region australia-southeast1 ^
     --platform managed ^
     --allow-unauthenticated ^
     --port 8080 ^
     --memory 512Mi ^
     --cpu 1 ^
     --timeout 300 ^
     --max-instances 10 ^
     --env-vars-file deploy/cloudrun-env.generated.yaml
   ```

Use a **direct** Supabase `DIRECT_URL` (`db.<project>.supabase.co`) if `prisma migrate deploy` fails or locks on the pooler.

## Frontend (Firebase Hosting)

From `wobble/`:

```bash
npm run build --prefix frontend
firebase deploy --only hosting --project bitesbud-6bb88
```

The first time, link Firebase to the GCP project if prompted. Ensure `firebase.json` matches your chosen routing (direct `VITE_API_ORIGIN` vs Hosting → Cloud Run rewrite).

## Instructor-only: wipe Supabase `public`

**[`deploy/instructor/instructor-supabase-reset.sql`](instructor/instructor-supabase-reset.sql)** runs `DROP SCHEMA public CASCADE` and recreates `public` with typical Supabase grants. It **deletes all tables and data** in `public`. Use only on disposable databases before `prisma migrate deploy`, never on production without explicit approval.

## Scripts

- `npm run deploy:backend` — build/push/deploy (requires Docker + gcloud; see `scripts/deploy-backend.ps1`)
- `npm run deploy:hosting` — build Vue app and `firebase deploy --only hosting`
