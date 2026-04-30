import { computed, ref, watch } from 'vue'
import { getBiteBudUserId } from './useUserId'

export type BackgroundTint = 'none' | 'yellow' | 'blue' | 'green' | 'peach'
export type TextSize = 'small' | 'medium' | 'large'

export type UserSettings = {
  textSize: TextSize
  readAloud: boolean
  stepChime: boolean
  volume: number // 0..1
  rate: number // 0.5..2
  voice: string
  darkMode: boolean
  backgroundTint: BackgroundTint
}

const DEFAULTS: UserSettings = {
  textSize: 'medium',
  readAloud: false,
  stepChime: true,
  volume: 0.85,
  rate: 0.9,
  voice: 'Karen',
  darkMode: false,
  backgroundTint: 'none',
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function normalize(raw: Partial<UserSettings> | null): UserSettings {
  const r = raw ?? {}
  const textSize: TextSize =
    r.textSize === 'small' || r.textSize === 'large' ? r.textSize : 'medium'
  const backgroundTint: BackgroundTint =
    r.backgroundTint === 'yellow' ||
    r.backgroundTint === 'blue' ||
    r.backgroundTint === 'green' ||
    r.backgroundTint === 'peach'
      ? r.backgroundTint
      : 'none'
  return {
    textSize,
    readAloud: Boolean(r.readAloud),
    stepChime: r.stepChime == null ? DEFAULTS.stepChime : Boolean(r.stepChime),
    volume: clamp(Number(r.volume ?? DEFAULTS.volume), 0, 1),
    rate: clamp(Number(r.rate ?? DEFAULTS.rate), 0.5, 2),
    voice: typeof r.voice === 'string' ? r.voice : DEFAULTS.voice,
    darkMode: Boolean(r.darkMode),
    backgroundTint,
  }
}

function storageKey(userId: string | null): string {
  return `bitebud_settings_${userId ?? 'anon'}`
}

function readFromStorage(key: string): UserSettings {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<UserSettings>
    // Always boot in normal mode; dark mode can still be enabled manually after load.
    return {
      ...normalize(parsed),
      darkMode: false,
    }
  } catch {
    return DEFAULTS
  }
}

const sharedSettings = ref<UserSettings>(DEFAULTS)
let sharedInitDone = false
let sharedStorageWatchStop: (() => void) | null = null

export function useSettings() {
  const uid = getBiteBudUserId()
  const key = computed(() => storageKey(getBiteBudUserId() ?? uid ?? null))

  if (!sharedInitDone) {
    sharedSettings.value = readFromStorage(key.value)

    sharedStorageWatchStop = watch(
      sharedSettings,
      (s) => {
        localStorage.setItem(key.value, JSON.stringify(normalize(s)))
      },
      { deep: true },
    )

    sharedInitDone = true
  }

  watch(
    key,
    (k) => {
      sharedStorageWatchStop?.()
      sharedSettings.value = readFromStorage(k)
      sharedStorageWatchStop = watch(
        sharedSettings,
        (s) => {
          localStorage.setItem(k, JSON.stringify(normalize(s)))
        },
        { deep: true },
      )
    },
    { immediate: false },
  )

  return { settings: sharedSettings }
}

