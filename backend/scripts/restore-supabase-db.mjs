#!/usr/bin/env node
/**
 * Restore a plain SQL dump (from backup-supabase-db.mjs) into Supabase/Postgres.
 *
 * DESTRUCTIVE: can overwrite existing data. Requires explicit confirmation.
 *
 * Usage (from backend/):
 *   RESTORE_CONFIRM=yes npm run db:restore -- --latest
 *   RESTORE_CONFIRM=yes npm run db:restore -- backups/supabase-2026-05-18T05-11-31.sql
 *
 * Do not run against production unless you intend to replace data.
 */

import { readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
const backendRoot = join(__dirname, '..')
const repoRoot = join(backendRoot, '..')
const backupsDir = join(backendRoot, 'backups')

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
      console.error('Use DIRECT_URL (session pooler, port 5432) for restore, not the transaction pooler.')
      process.exit(1)
    }
    return { url: pooled, source: 'DATABASE_URL' }
  }

  console.error('Missing DIRECT_URL or DATABASE_URL in .env')
  process.exit(1)
}

function sanitizeUrlForLibpq(url) {
  try {
    const parsed = new URL(url)
    parsed.searchParams.delete('schema')
    parsed.searchParams.delete('pgbouncer')
    return parsed.toString()
  } catch {
    return url.replace(/([?&])schema=[^&]*&?/g, '$1').replace(/[?&]$/, '')
  }
}

function findPgBin(tool) {
  const win = process.platform === 'win32'
  const names = win ? [`${tool}.exe`, tool] : [tool]
  for (const name of names) {
    const check = spawnSync(win ? 'where' : 'which', [name], {
      encoding: 'utf8',
      shell: win,
    })
    if (check.status === 0) return name
  }
  if (win) {
    const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files'
    for (const ver of ['18', '17', '16', '15']) {
      const candidate = join(programFiles, 'PostgreSQL', ver, 'bin', `${tool}.exe`)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function resolveSqlFile(argv) {
  const args = argv.slice(2)
  if (args.includes('--latest') || args.length === 0) {
    if (!existsSync(backupsDir)) {
      console.error(`No backups folder: ${backupsDir}`)
      process.exit(1)
    }
    const sqlFiles = readdirSync(backupsDir)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => {
        const full = join(backupsDir, name)
        return { full, mtime: statSync(full).mtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime)
    if (!sqlFiles.length) {
      console.error('No .sql backups found. Run npm run db:backup first.')
      process.exit(1)
    }
    return sqlFiles[0].full
  }

  const pathArg = args.find((a) => !a.startsWith('--'))
  if (!pathArg) {
    console.error('Pass a backup file path or --latest')
    process.exit(1)
  }
  const full = resolve(pathArg.startsWith('/') || /^[A-Za-z]:/.test(pathArg) ? pathArg : join(backendRoot, pathArg))
  if (!existsSync(full)) {
    console.error(`Backup file not found: ${full}`)
    process.exit(1)
  }
  if (!full.endsWith('.sql')) {
    console.error('Expected a .sql file from npm run db:backup')
    process.exit(1)
  }
  return full
}

const envPath = loadEnv()
const confirmed =
  process.env.RESTORE_CONFIRM === 'yes' ||
  process.env.RESTORE_CONFIRM === '1' ||
  process.argv.includes('--confirm')

if (!confirmed) {
  console.error('Restore is blocked until you confirm.')
  console.error('This overwrites data in the target database.')
  console.error('')
  console.error('Example:')
  console.error('  RESTORE_CONFIRM=yes npm run db:restore -- --latest')
  process.exit(1)
}

const { url: rawUrl, source } = resolveDatabaseUrl()
const url = sanitizeUrlForLibpq(rawUrl)
const psql = findPgBin('psql')
const sqlFile = resolveSqlFile(process.argv)

if (!psql) {
  console.error('psql was not found on your PATH (install PostgreSQL client tools).')
  process.exit(1)
}

console.log('')
console.log('*** DATABASE RESTORE ***')
console.log(`Env: ${envPath ?? '(process environment)'}`)
console.log(`Target: ${source}`)
console.log(`File:   ${sqlFile}`)
console.log('')
console.log('Starting in 5 seconds. Press Ctrl+C to cancel.')
console.log('')

const waitUntil = Date.now() + 5000
while (Date.now() < waitUntil) {
  /* brief pause */
}

const result = spawnSync(
  psql,
  [`--dbname=${url}`, '--file', sqlFile, '--set', 'ON_ERROR_STOP=1'],
  { stdio: 'inherit', env: process.env, shell: false },
)

if (result.status !== 0) {
  console.error('Restore failed (psql exited with an error).')
  process.exit(result.status ?? 1)
}

console.log('Restore finished.')
