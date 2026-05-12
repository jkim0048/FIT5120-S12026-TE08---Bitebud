import { computed, ref, watch, type Ref } from 'vue'
import { useSession } from './useSession'

export type InsightsRangePreset = '7d' | '30d' | '90d' | '12m' | 'custom'

type Stored =
  | { preset: Exclude<InsightsRangePreset, 'custom'> }
  | { preset: 'custom'; from: string; to: string }

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
  const t = new Date()
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), 0, 0, 0, 0))
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

function key(uid: string) {
  return `bb.insightsRange.${uid}`
}

function computeRange(preset: Exclude<InsightsRangePreset, 'custom'>): { from: Date; to: Date } {
  const to = todayUtc()
  if (preset === '7d') return { from: addDays(to, -6), to }
  if (preset === '30d') return { from: addDays(to, -29), to }
  if (preset === '90d') return { from: addDays(to, -89), to }
  if (preset === '12m') return { from: addMonths(to, -12), to }
  return { from: addDays(to, -6), to }
}

export function useInsightsRange(): {
  from: Ref<Date>
  to: Ref<Date>
  preset: Ref<InsightsRangePreset>
  setPreset: (p: Exclude<InsightsRangePreset, 'custom'>) => void
  setCustom: (from: Date, to: Date) => void
  storageKey: Ref<string>
} {
  const { userId } = useSession()
  const storageKey = computed(() => (userId.value ? key(userId.value) : ''))

  const preset = ref<InsightsRangePreset>('7d')
  const from = ref<Date>(computeRange('7d').from)
  const to = ref<Date>(computeRange('7d').to)

  function loadFromStorage() {
    if (!storageKey.value) return
    try {
      const raw = localStorage.getItem(storageKey.value)
      if (!raw) return
      const parsed = JSON.parse(raw) as Stored
      if (!parsed || typeof parsed !== 'object') return
      if (parsed.preset && parsed.preset !== 'custom') {
        // Back-compat: older persisted "all" becomes "12m".
        const p = parsed.preset === ('all' as any) ? '12m' : parsed.preset
        preset.value = p as InsightsRangePreset
        const r = computeRange(p as Exclude<InsightsRangePreset, 'custom'>)
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
    if (!storageKey.value) return
    const out: Stored =
      preset.value === 'custom'
        ? { preset: 'custom', from: isoDateOnly(from.value), to: isoDateOnly(to.value) }
        : { preset: preset.value }
    localStorage.setItem(storageKey.value, JSON.stringify(out))
  }

  function setPreset(p: Exclude<InsightsRangePreset, 'custom'>) {
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
      // When user changes, reload their last choice.
      loadFromStorage()
    },
    { immediate: true },
  )

  return { from, to, preset, setPreset, setCustom, storageKey }
}

