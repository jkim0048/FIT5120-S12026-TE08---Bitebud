#!/usr/bin/env node
/**
 * Dump the Supabase Postgres database to a local SQL file under backend/backups/.
 *
 * Requires PostgreSQL client tools (`pg_dump`) on your PATH.
 * Windows: install from https://www.postgresql.org/download/windows/ and add .../bin to PATH.
 *
 * Uses DIRECT_URL (session pooler, port 5432) when set — not the transaction pooler (6543 / pgbouncer).
 *
 * Usage (from backend/):
 *   npm run db:backup
 *   node scripts/backup-supabase-db.mjs
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
const backendRoot = join(__dirname, '..')
const repoRoot = join(backendRoot, '..')

function loadEnv() {
  const candidates = [
    join(repoRoot, '.env'),
    join(backendRoot, '.env'),
    join(process.cwd(), '.env'),
    join(process.cwd(), '..', '.env'),
  ]
  for (const path of candidates) {
    if (existsSync(path)) {
      config({ path, override: false })
      return path
    }
  }
  return null
}

function resolveDatabaseUrl() {
  const direct = process.env.DIRECT_URL?.trim()
  const pooled = process.env.DATABASE_URL?.trim()

  if (direct) return { url: direct, source: 'DIRECT_URL' }

  if (pooled) {
    const isPooler =
      pooled.includes('pgbouncer=true') ||
      /:6543\//.test(pooled) ||
      pooled.includes('pooler.supabase.com:6543')
    if (isPooler) {
      console.error(
        'DATABASE_URL points at the transaction pooler (PgBouncer). pg_dump needs DIRECT_URL on port 5432.',
      )
      console.error('Add DIRECT_URL to your .env (Supabase → Settings → Database → Connection string → Session).')
      process.exit(1)
    }
    return { url: pooled, source: 'DATABASE_URL' }
  }

  console.error('Missing DIRECT_URL or DATABASE_URL in .env')
  process.exit(1)
}

/** Prisma adds `schema` / `pgbouncer` query params that libpq/pg_dump reject. */
function sanitizeUrlForPgDump(url) {
  try {
    const parsed = new URL(url)
    parsed.searchParams.delete('schema')
    parsed.searchParams.delete('pgbouncer')
    return parsed.toString()
  } catch {
    return url.replace(/([?&])schema=[^&]*&?/g, '$1').replace(/[?&]$/, '')
  }
}

function findPgDump() {
  const names = process.platform === 'win32' ? ['pg_dump', 'pg_dump.exe'] : ['pg_dump']
  for (const name of names) {
    const check = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    })
    if (check.status === 0) return name
  }
  if (process.platform === 'win32') {
    const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files'
    const glob = ['18', '17', '16', '15'].map((v) =>
      join(programFiles, 'PostgreSQL', v, 'bin', 'pg_dump.exe'),
    )
    for (const candidate of glob) {
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

const envPath = loadEnv()
const { url: rawUrl, source } = resolveDatabaseUrl()
const url = sanitizeUrlForPgDump(rawUrl)
const pgDump = findPgDump()

if (!pgDump) {
  console.error('pg_dump was not found on your PATH.')
  console.error('Install PostgreSQL client tools and retry.')
  process.exit(1)
}

const outDir = join(backendRoot, 'backups')
mkdirSync(outDir, { recursive: true })

const stamp = timestampSlug()
const sqlFile = join(outDir, `supabase-${stamp}.sql`)

console.log(`Env: ${envPath ?? '(process environment)'}`)
console.log(`Connection: ${source}`)
console.log(`Output: ${sqlFile}`)
console.log('Running pg_dump…')

const args = [
  `--dbname=${url}`,
  '--no-owner',
  '--no-acl',
  '--schema=public',
  '--format=plain',
  '--file',
  sqlFile,
]

const result = spawnSync(pgDump, args, {
  stdio: 'inherit',
  env: process.env,
  shell: false,
})

if (result.status !== 0) {
  console.error('pg_dump failed.')
  process.exit(result.status ?? 1)
}

console.log('Backup complete.')
console.log(`Restore example: psql "<DIRECT_URL>" -f "${sqlFile}"`)
