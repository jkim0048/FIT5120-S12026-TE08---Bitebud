<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { apiFetch } from '../lib/api'
import { useSession } from '../composables/useSession'
import { useSettings } from '../composables/useSettings'
import { useInsightsRange, type InsightsRangePreset } from '../composables/useInsightsRange'

type InsightCard = {
  id: string
  category: string
  headline: string
  detail: string
  recordCount: number
}

type InsightsResponse = {
  range: { from: string; to: string }
  progress: {
    calendar: Array<{ date: string; recipes: number; dining: number }>
    weeklyBars: Array<{ weekStart: string; recipes: number; dining: number }>
    typeBreakdown: { recipes: number; dining: number }
  }
  cooking: { works: InsightCard[]; doesntWork: InsightCard[] }
  dining: { works: InsightCard[] }
  thresholds: {
    cooking: { have: number; need: 3 }
    dining: { have: number; need: 2 }
    progress: { have: number; need: 3 }
  }
}

const { userId, isSignedIn } = useSession()
const { settings } = useSettings()
const insightsRange = useInsightsRange()

const loading = ref(false)
const error = ref('')
const data = ref<InsightsResponse | null>(null)
const rangeMsg = ref('')
const rangeInvalid = computed(() => rangeMsg.value.trim().length > 0)

const customFromInput = ref('')
const customToInput = ref('')
let debounceTimer: number | null = null
const monthPage = ref(0)

const insightsDisabled = computed(() => settings.value.insightsEnabled === false)

function usesSingleMonthCalendar(): boolean {
  const preset = insightsRange.preset.value
  return preset === '30d' || preset === '90d' || preset === '12m' || preset === 'custom'
}

function monthPageSize(): number {
  if (usesSingleMonthCalendar()) return 1
  return window.matchMedia?.('(max-width: 900px)')?.matches ? 3 : 4
}

const visibleMonthGrids = computed(() => {
  const all = monthGrids.value
  if (!all.length) return []
  const size = monthPageSize()
  const start = monthPage.value * size
  return all.slice(start, start + size)
})

const visibleMonthGrid = computed(() => visibleMonthGrids.value[0] ?? null)

const monthNavLabel = computed(() => {
  if (!usesSingleMonthCalendar()) return ''
  const total = monthGrids.value.length
  if (total <= 1) return ''
  return `${monthPage.value + 1} of ${total}`
})

const canPrevMonths = computed(() => monthPage.value > 0)
const canNextMonths = computed(() => {
  const size = monthPageSize()
  return (monthPage.value + 1) * size < monthGrids.value.length
})

function prevMonths() {
  if (!canPrevMonths.value) return
  monthPage.value -= 1
}
function nextMonths() {
  if (!canNextMonths.value) return
  monthPage.value += 1
}

function isoToPretty(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return iso
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

const MELBOURNE_CALENDAR = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Australia/Melbourne',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function isoToday(): string {
  return MELBOURNE_CALENDAR.format(new Date())
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

const showProgressCalendar = computed(() => {
  const d = data.value
  if (!d) return false
  return d.thresholds.progress.have > 0 || (d.progress.calendar?.length ?? 0) > 0
})

function setPreset(p: Exclude<InsightsRangePreset, 'custom'>) {
  insightsRange.setPreset(p)
  customFromInput.value = toIso(insightsRange.from.value)
  customToInput.value = toIso(insightsRange.to.value)
  rangeMsg.value = ''
  monthPage.value = 0
}

function selectCustom() {
  insightsRange.preset.value = 'custom'
  customFromInput.value = toIso(insightsRange.from.value)
  customToInput.value = toIso(insightsRange.to.value)
  rangeMsg.value = ''
  monthPage.value = 0
}

function validateCustom(fromIso: string, toIsoStr: string): { ok: boolean; msg: string } {
  if (!fromIso || !toIsoStr) return { ok: false, msg: 'Choose both dates.' }
  if (fromIso > toIsoStr) return { ok: false, msg: 'From cannot be after To.' }
  if (toIsoStr > isoToday()) return { ok: false, msg: 'To cannot be in the future.' }
  return { ok: true, msg: '' }
}

function applyCustomDebounced() {
  if (debounceTimer) window.clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(() => {
    if (insightsRange.preset.value !== 'custom') return
    const v = validateCustom(customFromInput.value, customToInput.value)
    rangeMsg.value = v.msg
    if (!v.ok) return
    insightsRange.setCustom(
      new Date(`${customFromInput.value}T00:00:00.000Z`),
      new Date(`${customToInput.value}T00:00:00.000Z`),
    )
  }, 250)
}

const GAUGE_ARC_LENGTH_PERCENT = 100

const insightsRangeCaption = computed(() => {
  const preset = insightsRange.preset.value
  if (preset === '7d') return 'Last 7 days'
  if (preset === '30d') return 'Last 30 days'
  if (preset === '90d') return 'Last 90 days'
  if (preset === '12m') return 'Last 12 months'
  if (preset === 'custom' && data.value) {
    return `${isoToPretty(data.value.range.from)} to ${isoToPretty(data.value.range.to)}`
  }
  return 'Selected period'
})

function rangeActivityBreakdown(): { cookedRecipes: number; dinedOut: number } {
  const d = data.value
  if (!d) return { cookedRecipes: 0, dinedOut: 0 }
  const cooked = d.progress.typeBreakdown.recipes ?? 0
  const dined = d.progress.typeBreakdown.dining ?? 0
  if (cooked + dined > 0) return { cookedRecipes: cooked, dinedOut: dined }
  let cookedFromCalendar = 0
  let dinedFromCalendar = 0
  for (const row of d.progress.calendar ?? []) {
    cookedFromCalendar += row.recipes ?? 0
    dinedFromCalendar += row.dining ?? 0
  }
  return { cookedRecipes: cookedFromCalendar, dinedOut: dinedFromCalendar }
}

const rangeActivityStats = computed(() => rangeActivityBreakdown())

const rangeGaugeMax = computed(() => {
  const { cookedRecipes, dinedOut } = rangeActivityStats.value
  return Math.max(cookedRecipes, dinedOut, 1)
})

function clampGaugeValue(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.max(0, Math.round(value))
}

function gaugePercent(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0 || max <= 0) return 0
  return Math.min(GAUGE_ARC_LENGTH_PERCENT, (value / max) * GAUGE_ARC_LENGTH_PERCENT)
}

const cookedRecipesInRange = computed(() => clampGaugeValue(rangeActivityStats.value.cookedRecipes))
const dinedOutInRange = computed(() => clampGaugeValue(rangeActivityStats.value.dinedOut))

const cookedRecipesGaugePercent = computed(() => gaugePercent(cookedRecipesInRange.value, rangeGaugeMax.value))
const dinedOutGaugePercent = computed(() => gaugePercent(dinedOutInRange.value, rangeGaugeMax.value))

const cookedRecipesDisplay = computed(() => String(cookedRecipesInRange.value))
const dinedOutDisplay = computed(() => String(dinedOutInRange.value))

const cookedRecipesUnitLabel = computed(() => (cookedRecipesInRange.value === 1 ? 'recipe' : 'recipes'))
const dinedOutUnitLabel = computed(() => (dinedOutInRange.value === 1 ? 'review' : 'reviews'))

const calendarTooltipDateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  timeZone: 'UTC',
})

function calendarCellTooltip(date: string, recipes: number, reviews: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim())
  const dateLabel = m
    ? calendarTooltipDateFormatter.format(
        new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))),
      )
    : date
  const recipeCount = Math.max(0, recipes | 0)
  const reviewCount = Math.max(0, reviews | 0)
  if (recipeCount === 0 && reviewCount === 0) return `${dateLabel} — no activity`
  const parts: string[] = []
  if (recipeCount > 0) {
    parts.push(`${recipeCount} ${recipeCount === 1 ? 'recipe' : 'recipes'} cooked`)
  }
  if (reviewCount > 0) {
    parts.push(`${reviewCount} restaurant ${reviewCount === 1 ? 'review' : 'reviews'}`)
  }
  return `${dateLabel}: ${parts.join(', ')}`
}

async function load() {
  if (!isSignedIn.value || !userId.value) return
  if (insightsDisabled.value) {
    data.value = null
    return
  }

  loading.value = true
  error.value = ''
  try {
    const base = `/api/me/insights`
    const params = new URLSearchParams()
    params.set('from', toIso(insightsRange.from.value))
    params.set('to', toIso(insightsRange.to.value))
    const url = `${base}?${params.toString()}`
    data.value = await apiFetch<InsightsResponse>(url, {
      headers: { 'X-User-Id': userId.value },
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  customFromInput.value = toIso(insightsRange.from.value)
  customToInput.value = toIso(insightsRange.to.value)
  void load()
})

watch(
  () => [insightsRange.preset.value, insightsRange.from.value.getTime(), insightsRange.to.value.getTime()],
  () => {
    if (insightsRange.preset.value !== 'custom') {
      customFromInput.value = toIso(insightsRange.from.value)
      customToInput.value = toIso(insightsRange.to.value)
      rangeMsg.value = ''
    }
    monthPage.value = 0
    void load()
  },
)

watch(insightsDisabled, (off) => {
  if (off) {
    data.value = null
    error.value = ''
    loading.value = false
  } else {
    void load()
  }
})

type MonthGrid = {
  monthKey: string
  label: string
  days: Array<{
    date: string
    inMonth: boolean
    recipes: number
    reviews: number
    total: number
  }>
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function startOfWeekMonday(d: Date): Date {
  const out = new Date(d)
  out.setUTCHours(0, 0, 0, 0)
  const day = out.getUTCDay()
  const diff = (day + 6) % 7
  out.setUTCDate(out.getUTCDate() - diff)
  return out
}

function endOfWeekMonday(d: Date): Date {
  const start = startOfWeekMonday(d)
  const out = new Date(start)
  out.setUTCDate(out.getUTCDate() + 6)
  return out
}

function addUtcDays(d: Date, days: number): Date {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() + days)
  return out
}

const calendarMap = computed(() => {
  const m = new Map<string, { recipes: number; reviews: number }>()
  for (const row of data.value?.progress.calendar ?? []) {
    const iso = row.date.trim().slice(0, 10)
    if (!iso) continue
    m.set(iso, { recipes: row.recipes ?? 0, reviews: row.dining ?? 0 })
  }
  return m
})

const monthGrids = computed<MonthGrid[]>(() => {
  if (!data.value) return []
  const from = new Date(`${data.value.range.from}T00:00:00.000Z`)
  const to = new Date(`${data.value.range.to}T00:00:00.000Z`)
  const grids: MonthGrid[] = []
  let cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1))
  const endMonth = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1))
  while (cur.getTime() <= endMonth.getTime()) {
    const monthStart = new Date(cur)
    const monthEnd = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0))
    const gridStart = startOfWeekMonday(monthStart)
    const gridEnd = endOfWeekMonday(monthEnd)
    const days: MonthGrid['days'] = []
    let d = gridStart
    while (d.getTime() <= gridEnd.getTime()) {
      const iso = d.toISOString().slice(0, 10)
      const inMonth = d.getUTCMonth() === cur.getUTCMonth()
      const counts = calendarMap.value.get(iso)
      const recipes = counts?.recipes ?? 0
      const reviews = counts?.reviews ?? 0
      days.push({
        date: iso,
        inMonth,
        recipes,
        reviews,
        total: recipes + reviews,
      })
      d = addUtcDays(d, 1)
    }
    grids.push({
      monthKey: `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, '0')}`,
      label: monthLabel(cur),
      days,
    })
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1))
  }
  return grids
})

watch(monthGrids, (grids) => {
  const maxPage = Math.max(0, Math.ceil(grids.length / monthPageSize()) - 1)
  if (monthPage.value > maxPage) monthPage.value = maxPage
})
</script>

<template>
  <div class="insights-activity-range">
    <p v-if="insightsDisabled" class="guidance" role="status">
      Insights are turned off in Settings. Turn them on to see range activity here.
    </p>

    <template v-else>
      <section class="range">
        <div class="range-head">
          <div class="range-title">Show data from</div>
          <div class="range-sub">Pick a time window. Defaults to the last 7 days.</div>
        </div>
        <div class="range-chips" role="group" aria-label="Time window">
          <button type="button" class="range-chip" :class="{ active: insightsRange.preset.value === '7d' }" @click="setPreset('7d')">Last 7 days</button>
          <button type="button" class="range-chip" :class="{ active: insightsRange.preset.value === '30d' }" @click="setPreset('30d')">Last 30 days</button>
          <button type="button" class="range-chip" :class="{ active: insightsRange.preset.value === '90d' }" @click="setPreset('90d')">Last 90 days</button>
          <button type="button" class="range-chip" :class="{ active: insightsRange.preset.value === '12m' }" @click="setPreset('12m')">Last 12 months</button>
          <button type="button" class="range-chip" :class="{ active: insightsRange.preset.value === 'custom' }" @click="selectCustom">Custom</button>
        </div>

        <div v-if="insightsRange.preset.value === 'custom'" class="range-custom">
          <label class="range-field">
            <span>From</span>
            <input v-model="customFromInput" type="date" :max="customToInput || isoToday()" @input="applyCustomDebounced" />
          </label>
          <label class="range-field">
            <span>To</span>
            <input v-model="customToInput" type="date" :max="isoToday()" @input="applyCustomDebounced" />
          </label>
          <p v-if="rangeInvalid" class="range-msg" role="status">{{ rangeMsg }}</p>
        </div>
      </section>

      <p v-if="loading" class="hint">Loading…</p>
      <p v-else-if="error" class="error" role="status">{{ error }}</p>

      <template v-else-if="data">
        <section class="band">
          <div v-if="!showProgressCalendar" class="guidance">
            Log cooking or dining to see your activity calendar.
          </div>
          <div v-else class="progress-grid">
            <p
              v-if="data.thresholds.progress.have < data.thresholds.progress.need"
              class="calendar-note"
              role="status"
            >
              After {{ data.thresholds.progress.need - data.thresholds.progress.have }}
              {{ data.thresholds.progress.need - data.thresholds.progress.have === 1 ? 'more activity' : 'more activities' }},
              your weekly charts will fill in.
            </p>
            <div class="calendar calendar-panel">
              <div class="calendar-title">{{ isoToPretty(data.range.from) }} to {{ isoToPretty(data.range.to) }}</div>
              <p class="calendar-hint">Hover over any day to see details.</p>
              <div class="months">
                <section v-if="visibleMonthGrid" class="month">
                  <div class="month-title">{{ visibleMonthGrid.label }}</div>
                  <div class="dow" aria-hidden="true">
                    <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
                  </div>
                  <div class="grid" :aria-label="`Calendar: ${visibleMonthGrid.label}`">
                    <button
                      v-for="d in visibleMonthGrid.days"
                      :key="`${visibleMonthGrid.monthKey}-${d.date}`"
                      type="button"
                      class="cell"
                      :class="[{ 'cell--out': !d.inMonth }, d.total > 0 ? 'cell--active' : 'cell--idle']"
                      :data-tip="calendarCellTooltip(d.date, d.recipes, d.reviews)"
                      :aria-label="calendarCellTooltip(d.date, d.recipes, d.reviews)"
                    >
                      <span v-if="d.inMonth" class="day">{{ Number(d.date.slice(8, 10)) }}</span>
                      <span class="sr">{{ d.date }}</span>
                    </button>
                  </div>
                </section>
              </div>

              <div v-if="monthGrids.length > 1" class="month-nav" aria-label="Calendar month navigation">
                <button class="bb-btn bb-btn--secondary" type="button" :disabled="!canPrevMonths" @click="prevMonths">Previous month</button>
                <span v-if="monthNavLabel" class="month-nav-label" aria-live="polite">{{ monthNavLabel }}</span>
                <button class="bb-btn bb-btn--secondary" type="button" :disabled="!canNextMonths" @click="nextMonths">Next month</button>
              </div>
            </div>

            <div class="weekly-gauges">
              <article class="gauge-card gauge-card--cooking">
                <h3 class="gauge-title">
                  Cooked recipes: <strong>{{ cookedRecipesDisplay }}</strong>
                  {{ cookedRecipesUnitLabel }} in {{ insightsRangeCaption }}
                </h3>
                <div
                  class="gauge"
                  role="img"
                  :aria-label="`Cooked recipes in ${insightsRangeCaption}: ${cookedRecipesDisplay} ${cookedRecipesUnitLabel}`"
                >
                  <svg viewBox="0 0 120 120" class="gauge-svg" aria-hidden="true">
                    <path
                      class="gauge-track"
                      d="M 28.18 91.82 A 45 45 0 1 1 91.82 91.82"
                      pathLength="100"
                      fill="none"
                    />
                    <path
                      class="gauge-fill gauge-fill--cooking"
                      d="M 28.18 91.82 A 45 45 0 1 1 91.82 91.82"
                      pathLength="100"
                      fill="none"
                      :stroke-dasharray="`${cookedRecipesGaugePercent} 100`"
                    />
                  </svg>
                  <div class="gauge-readout">
                    <span class="gauge-value">{{ cookedRecipesDisplay }}</span>
                    <span class="gauge-unit">{{ cookedRecipesUnitLabel }} total</span>
                  </div>
                </div>
                <p class="gauge-caption">{{ insightsRangeCaption }}</p>
              </article>

              <article class="gauge-card gauge-card--dining">
                <h3 class="gauge-title">
                  Dined out: <strong>{{ dinedOutDisplay }}</strong>
                  {{ dinedOutUnitLabel }} in {{ insightsRangeCaption }}
                </h3>
                <div
                  class="gauge"
                  role="img"
                  :aria-label="`Dined out in ${insightsRangeCaption}: ${dinedOutDisplay} ${dinedOutUnitLabel}`"
                >
                  <svg viewBox="0 0 120 120" class="gauge-svg" aria-hidden="true">
                    <path
                      class="gauge-track"
                      d="M 28.18 91.82 A 45 45 0 1 1 91.82 91.82"
                      pathLength="100"
                      fill="none"
                    />
                    <path
                      class="gauge-fill gauge-fill--dining"
                      d="M 28.18 91.82 A 45 45 0 1 1 91.82 91.82"
                      pathLength="100"
                      fill="none"
                      :stroke-dasharray="`${dinedOutGaugePercent} 100`"
                    />
                  </svg>
                  <div class="gauge-readout">
                    <span class="gauge-value">{{ dinedOutDisplay }}</span>
                    <span class="gauge-unit">{{ dinedOutUnitLabel }} total</span>
                  </div>
                </div>
                <p class="gauge-caption">{{ insightsRangeCaption }}</p>
              </article>
            </div>
          </div>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.insights-activity-range {
  display: grid;
  gap: 1.2rem;
}
.hint {
  margin: 0;
  color: color-mix(in srgb, var(--bb-text) 70%, var(--bb-muted));
}
.error {
  margin: 0;
  color: #b42318;
}

.range {
  border: 1px solid var(--bb-border);
  border-radius: 16px;
  background: var(--bb-surface-low);
  padding: 1rem;
  display: grid;
  gap: 0.75rem;
}
.range-title {
  font-family: var(--bb-font-headline);
  font-weight: 900;
  font-size: 1.05rem;
}
.range-sub {
  color: color-mix(in srgb, var(--bb-text) 70%, var(--bb-muted));
  margin-top: 0.2rem;
}
.range-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}
.range-chip {
  border: 1px solid var(--bb-border);
  border-radius: 999px;
  background: var(--bb-surface-lowest);
  padding: 0.35rem 0.7rem;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  color: var(--bb-text);
}
.range-chip.active {
  border-color: var(--bb-accent);
  background: color-mix(in srgb, var(--bb-accent) 14%, var(--bb-surface-lowest));
}
.range-custom {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  align-items: end;
}
.range-field {
  display: grid;
  gap: 0.3rem;
  font-weight: 800;
}
.range-field span {
  font-size: 0.9rem;
}
.range-field input {
  border: 1px solid var(--bb-border);
  border-radius: 12px;
  padding: 0.55rem 0.7rem;
  background: var(--bb-surface-lowest);
  font: inherit;
  color: #000;
  -webkit-text-fill-color: #000;
}
.range-msg {
  grid-column: 1 / -1;
  margin: 0;
  color: color-mix(in srgb, var(--bb-text) 70%, var(--bb-muted));
}

.band {
  border: 1px solid var(--bb-border);
  border-radius: 16px;
  background: var(--bb-surface-low);
  padding: 1rem;
}
.progress-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  gap: 1rem;
  align-items: stretch;
}
.calendar-panel {
  min-width: 0;
  padding: 0.85rem;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--bb-border) 70%, transparent);
  background: var(--bb-surface-lowest);
  overflow: visible;
}
.calendar-title {
  font-weight: 800;
  font-size: 0.9rem;
  color: var(--bb-text);
  margin-bottom: 0.35rem;
}
.calendar-hint {
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  font-style: italic;
  color: var(--bb-muted);
}

.months {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.9rem;
}
.month {
  min-width: 0;
  overflow: visible;
}
.month-title {
  font-weight: 900;
  font-size: 0.95rem;
  margin-bottom: 0.25rem;
}
.dow {
  display: grid;
  grid-template-columns: repeat(7, minmax(2rem, 1fr));
  gap: 0.35rem;
  margin-bottom: 0.35rem;
  color: color-mix(in srgb, var(--bb-text) 65%, var(--bb-muted));
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}
.dow span {
  text-align: center;
}
.grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(2rem, 1fr));
  gap: 0.35rem;
  overflow: visible;
}
.cell {
  width: 100%;
  min-width: 0;
  min-height: 2.15rem;
  aspect-ratio: 1 / 1;
  border-radius: 10px;
  border: 1px solid var(--bb-border);
  background: transparent;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  overflow: visible;
  overflow-wrap: normal;
  word-break: keep-all;
  white-space: nowrap;
}
.cell:hover,
.cell:focus-visible {
  z-index: 20;
}
.day {
  font-size: clamp(0.72rem, 1.6vw, 0.84rem);
  font-weight: 800;
  color: var(--bb-text);
  line-height: 1;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  flex-shrink: 0;
}
.cell--out {
  opacity: 0.35;
}
.cell--idle {
  background: transparent;
}
.cell--active {
  background: #d9e8f0;
  border-color: #8fb0c4;
}
.cell--active .day {
  color: var(--bb-text);
}
.calendar-note {
  grid-column: 1 / -1;
  margin: 0 0 0.35rem;
  font-size: 0.82rem;
  color: var(--bb-muted);
}

.month-nav {
  margin-top: 0.85rem;
  display: flex;
  gap: 0.5rem;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}
.month-nav-label {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--bb-muted);
  font-variant-numeric: tabular-nums;
}
.cell::after,
.cell::before {
  position: absolute;
  left: 50%;
  pointer-events: none;
  opacity: 0;
  transition: opacity 140ms ease-out, transform 140ms ease-out;
  z-index: 10;
}
.cell::after {
  content: attr(data-tip);
  bottom: calc(100% + 10px);
  transform: translate(-50%, 4px);
  white-space: nowrap;
  font-size: 0.78rem;
  line-height: 1.25;
  padding: 0.5rem 0.65rem;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--bb-border) 70%, transparent);
  background: var(--bb-surface-highest);
  color: var(--bb-text);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.18);
  font-variant-numeric: tabular-nums;
}
.cell::before {
  content: '';
  bottom: calc(100% + 4px);
  transform: translate(-50%, 4px) rotate(45deg);
  width: 8px;
  height: 8px;
  background: var(--bb-surface-highest);
  border-right: 1px solid color-mix(in srgb, var(--bb-border) 70%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--bb-border) 70%, transparent);
  box-shadow: 2px 2px 6px rgba(0, 0, 0, 0.08);
}
.cell:hover::after,
.cell:focus-visible::after {
  opacity: 1;
  transform: translate(-50%, 0);
}
.cell:hover::before,
.cell:focus-visible::before {
  opacity: 1;
  transform: translate(-50%, 0) rotate(45deg);
}
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.weekly-gauges {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
.gauge-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  padding: 0.75rem 0.6rem;
  background: var(--bb-surface-lowest);
  border: 1px solid color-mix(in srgb, var(--bb-border) 70%, transparent);
  border-radius: 14px;
  text-align: center;
}
.gauge-title {
  margin: 0;
  font-family: var(--bb-font-headline);
  font-size: 0.95rem;
  font-weight: 600;
  line-height: 1.25;
  color: var(--bb-text);
}
.gauge-title strong {
  font-weight: 800;
}
.gauge {
  position: relative;
  width: min(180px, 100%);
  aspect-ratio: 1 / 1;
}
.gauge-svg {
  width: 100%;
  height: 100%;
  display: block;
}
.gauge-track {
  stroke: color-mix(in srgb, var(--bb-border) 55%, transparent);
  stroke-width: 10;
  stroke-linecap: round;
}
.gauge-fill {
  stroke-width: 10;
  stroke-linecap: round;
  transition: stroke-dasharray 320ms ease-out;
}
.gauge-fill--cooking {
  stroke: color-mix(in srgb, var(--bb-accent) 75%, white);
}
.gauge-fill--dining {
  stroke: color-mix(in srgb, var(--bb-primary) 75%, white);
}
.gauge-readout {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.gauge-value {
  font-family: var(--bb-font-headline);
  font-size: 1.9rem;
  font-weight: 800;
  line-height: 1;
  color: var(--bb-text);
  font-variant-numeric: tabular-nums;
}
.gauge-unit {
  margin-top: 0.15rem;
  font-size: 0.75rem;
  color: var(--bb-muted);
}
.gauge-caption {
  margin: 0;
  font-size: 0.8rem;
  color: var(--bb-muted);
}

.guidance {
  border: 1px solid var(--bb-border);
  background: var(--bb-surface-low);
  border-radius: 14px;
  padding: 0.8rem 0.9rem;
  color: color-mix(in srgb, var(--bb-text) 82%, var(--bb-muted));
  line-height: 1.5;
}

@media (max-width: 900px) {
  .progress-grid {
    grid-template-columns: 1fr;
  }
  .months {
    grid-template-columns: 1fr;
  }
  .range-custom {
    grid-template-columns: 1fr;
  }
}
</style>
