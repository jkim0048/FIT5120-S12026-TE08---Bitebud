import { computed, ref, watch, type Ref } from 'vue'
import { useSession } from './useSession'

export type ProgressRangePreset = '7d' | '30d' | '90d' | '12m' | 'custom'

type Stored =
  | { preset: Exclude<ProgressRangePreset, 'custom'> }
  | { preset: 'custom'; from: string; to: string }

const MELBOURNE_CALENDAR = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Australia/Melbourne',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function isoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function parseIsoDateOnly(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const da = Number(m[3])
  const d = new Date(Date.UTC(y, mo - 1, da, 0, 0, 0, 0))
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== da) return null
  return d
}

function todayUtc(): Date {
  const todayStr = MELBOURNE_CALENDAR.format(new Date())
  const parsed = parseIsoDateOnly(todayStr)
  if (!parsed) throw new Error('Failed to resolve Melbourne calendar date')
  return parsed
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() + days)
  return out
}

function addMonths(d: Date, months: number): Date {
  const out = new Date(d)
  out.setUTCMonth(out.getUTCMonth() + months)
  return out
}

function progressStorageKey(uid: string) {
  return `bb.progressRange.${uid}`
}

function computeRange(preset: Exclude<ProgressRangePreset, 'custom'>): { from: Date; to: Date } {
  const to = todayUtc()
  if (preset === '7d') return { from: addDays(to, -6), to }
  if (preset === '30d') return { from: addDays(to, -29), to }
  if (preset === '90d') return { from: addDays(to, -89), to }
  if (preset === '12m') return { from: addMonths(to, -12), to }
  return { from: addDays(to, -6), to }
}

export type ProgressRangeReactive = {
  from: Ref<Date>
  to: Ref<Date>
  preset: Ref<ProgressRangePreset>
  setPreset: (p: Exclude<ProgressRangePreset, 'custom'>) => void
  setCustom: (from: Date, to: Date) => void
  storageKey: Ref<string>
}

let progressRangeStore: ProgressRangeReactive | null = null

function createProgressRangeStore(userId: Ref<string | null | undefined>): ProgressRangeReactive {
  const preset = ref<ProgressRangePreset>('7d')
  const from = ref<Date>(computeRange('7d').from)
  const to = ref<Date>(computeRange('7d').to)
  const storageKey = computed(() => (userId.value ? progressStorageKey(userId.value) : ''))

  function loadFromStorage() {
    const keyVal = storageKey.value
    if (!keyVal) return
    try {
      const raw = localStorage.getItem(keyVal)
      if (!raw) return
      const parsedRaw = JSON.parse(raw) as Record<string, unknown>
      if (!parsedRaw || typeof parsedRaw !== 'object') return
      const parsed = parsedRaw as Stored
      if (parsed.preset && parsed.preset !== 'custom') {
        const presetStr = String(parsed.preset)
        const p: Exclude<ProgressRangePreset, 'custom'> =
          presetStr === 'all' ? '12m' : (parsed.preset as Exclude<ProgressRangePreset, 'custom'>)
        preset.value = p as ProgressRangePreset
        const r = computeRange(p as Exclude<ProgressRangePreset, 'custom'>)
        from.value = r.from
        to.value = r.to
        return
      }
      if (parsed.preset === 'custom') {
        const f = typeof parsed.from === 'string' ? parseIsoDateOnly(parsed.from) : null
        const t = typeof parsed.to === 'string' ? parseIsoDateOnly(parsed.to) : null
        if (f && t) {
          preset.value = 'custom'
          from.value = f
          to.value = t
        }
      }
    } catch {
      /* ignore */
    }
  }

  function persist() {
    const keyVal = storageKey.value
    if (!keyVal) return
    const out: Stored =
      preset.value === 'custom'
        ? { preset: 'custom', from: isoDateOnly(from.value), to: isoDateOnly(to.value) }
        : { preset: preset.value }
    localStorage.setItem(keyVal, JSON.stringify(out))
  }

  function setPreset(p: Exclude<ProgressRangePreset, 'custom'>) {
    preset.value = p
    const r = computeRange(p)
    from.value = r.from
    to.value = r.to
    persist()
  }

  function setCustom(f: Date, t: Date) {
    preset.value = 'custom'
    from.value = f
    to.value = t
    persist()
  }

  watch(
    () => storageKey.value,
    () => {
      loadFromStorage()
    },
    { immediate: true },
  )

  return { preset, from, to, setPreset, setCustom, storageKey }
}

export function useProgressRange(): ProgressRangeReactive {
  if (!progressRangeStore) {
    const { userId } = useSession()
    progressRangeStore = createProgressRangeStore(userId)
  }
  return progressRangeStore
}
