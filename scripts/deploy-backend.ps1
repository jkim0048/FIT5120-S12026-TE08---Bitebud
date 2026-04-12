# Deploy API container to Cloud Run (run from repo root: wobble/)
# Continue: gcloud writes to stderr; Stop would treat that as a terminating error.
$ErrorActionPreference = "Continue"
$Project = "bitesbud"
$Region = "australia-southeast1"
$Service = "bitesbud-api"
$Repo = "bitesbud-repo"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "Preparing env YAML from .env..."
node "$Root/deploy/prepare-cloudrun-env.mjs"
if (-not (Test-Path "$Root/deploy/cloudrun-env.generated.yaml")) {
  throw "Missing deploy/cloudrun-env.generated.yaml"
}

gcloud config set project $Project | Out-Null

$exists = gcloud artifacts repositories describe $Repo --location=$Region 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Creating Artifact Registry repository $Repo..."
  gcloud artifacts repositories create $Repo --repository-format=docker --location=$Region
}

$Tag = Get-Date -Format "yyyyMMdd-HHmmss"
$Image = "$Region-docker.pkg.dev/$Project/$Repo/${Service}:$Tag"
Write-Host "Building $Image ..."
docker build -t $Image .
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Pushing..."
docker push $Image
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Deploying Cloud Run service $Service ..."
gcloud run deploy $Service `
  --image $Image `
  --region $Region `
  --platform managed `
  --allow-unauthenticated `
  --port 8080 `
  --memory 512Mi `
  --cpu 1 `
  --timeout 300 `
  --max-instances 10 `
  --env-vars-file "$Root/deploy/cloudrun-env.generated.yaml"

Write-Host "Done. Service URL:"
gcloud run services describe $Service --region $Region --format="value(status.url)"
