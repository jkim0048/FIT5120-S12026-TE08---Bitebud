<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import InsightsRangePicker from '../components/InsightsRangePicker.vue'
import { useProgressRange } from '../composables/useProgressRange'
import { useSettings } from '../composables/useSettings'
import { getBiteBudUserId } from '../composables/useUserId'
import {
  fetchProgressDashboard,
  type DayRatingBand,
  type ProgressDashboardPayload,
  type ProgressMilestoneStatus,
} from '../lib/progressApi'

const router = useRouter()
const { settings } = useSettings()
const progressRange = useProgressRange()

const loading = ref(true)
const err = ref('')
const data = ref<ProgressDashboardPayload | null>(null)
const monthPage = ref(0)

const isStateNew = computed(() => data.value?.uiState === 'new')
const isStateEstablished = computed(() => data.value?.uiState === 'established')

const progressRangeCaption = computed(() => {
  const preset = progressRange.preset.value
  if (preset === '7d') return 'Last 7 days'
  if (preset === '30d') return 'Last 30 days'
  if (preset === '90d') return 'Last 90 days'
  if (preset === '12m') return 'Last 12 months'
  if (preset === 'custom' && data.value) {
    return `${isoToPretty(data.value.range.from)} to ${isoToPretty(data.value.range.to)}`
  }
  return 'Selected period'
})

function isoToPretty(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return iso
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function formatDelta(delta: number, label: string): string {
  if (delta > 0) return `+ ${delta} more than ${label}`
  if (delta < 0) return `${Math.abs(delta)} fewer than ${label}`
  return `Same as ${label}`
}

const statCards = computed(() => {
  const d = data.value
  if (!d) return []
  const label = d.deltaLabel
  if (d.uiState === 'new') {
    return [
      { key: 'recipes', value: '0', sub: 'No data yet' },
      { key: 'reviews', value: '0', sub: 'No data yet' },
      { key: 'days', value: '0', sub: 'No data yet' },
    ]
  }
  return [
    {
      key: 'recipes',
      value: String(d.stats.recipesCooked),
      sub: formatDelta(d.statsDelta.recipesCooked, label),
    },
    {
      key: 'reviews',
      value: String(d.stats.diningReviews),
      sub: formatDelta(d.statsDelta.diningReviews, label),
    },
    {
      key: 'days',
      value: String(d.stats.daysActive),
      sub: formatDelta(d.statsDelta.daysActive, label),
    },
  ]
})

const GAUGE_ARC = 100

const gaugeMax = computed(() => {
  const d = data.value
  if (!d) return 1
  return Math.max(d.stats.recipesCooked, d.stats.diningReviews, 1)
})

function gaugePercent(value: number): number {
  const max = gaugeMax.value
  if (!max || value <= 0) return 0
  return Math.min(GAUGE_ARC, (value / max) * GAUGE_ARC)
}

type MonthGrid = {
  monthKey: string
  label: string
  days: Array<{
    date: string
    inMonth: boolean
    recipes: number
    reviews: number
    ratingBand: DayRatingBand
  }>
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function startOfWeekMonday(d: Date): Date {
  const out = new Date(d)
  out.setUTCHours(0, 0, 0, 0)
  const day = out.getUTCDay()
  const diff = (day + 6) % 7
  out.setUTCDate(out.getUTCDate() - diff)
  return out
}

const calendarByDay = computed(() => {
  const map = new Map<string, ProgressDashboardPayload['calendar'][number]>()
  for (const row of data.value?.calendar ?? []) {
    map.set(row.date, row)
  }
  return map
})

const monthGrids = computed<MonthGrid[]>(() => {
  const d = data.value
  if (!d?.calendar.length) return []
  const from = new Date(`${d.range.from}T00:00:00.000Z`)
  const to = new Date(`${d.range.to}T00:00:00.000Z`)
  const grids: MonthGrid[] = []
  let cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1))
  const endMonth = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1))
  while (cur.getTime() <= endMonth.getTime()) {
    const year = cur.getUTCFullYear()
    const month = cur.getUTCMonth()
    const monthStart = new Date(Date.UTC(year, month, 1))
    const monthEnd = new Date(Date.UTC(year, month + 1, 0))
    const gridStart = startOfWeekMonday(monthStart)
    const gridEnd = startOfWeekMonday(monthEnd)
    gridEnd.setUTCDate(gridEnd.getUTCDate() + 6)
    const days: MonthGrid['days'] = []
    let walk = new Date(gridStart)
    while (walk.getTime() <= gridEnd.getTime()) {
      const iso = toIso(walk)
      const inMonth = walk.getUTCMonth() === month
      const row = calendarByDay.value.get(iso)
      days.push({
        date: iso,
        inMonth,
        recipes: row?.recipes ?? 0,
        reviews: row?.reviews ?? 0,
        ratingBand: inMonth ? (row?.ratingBand ?? 'none') : 'none',
      })
      walk = new Date(walk)
      walk.setUTCDate(walk.getUTCDate() + 1)
    }
    grids.push({
      monthKey: `${year}-${String(month + 1).padStart(2, '0')}`,
      label: monthLabel(monthStart),
      days,
    })
    cur = new Date(Date.UTC(year, month + 1, 1))
  }
  return grids
})

const usesSingleMonth = computed(() => {
  const preset = progressRange.preset.value
  return preset === '30d' || preset === '90d' || preset === '12m' || preset === 'custom'
})

const monthPageSize = computed(() => (usesSingleMonth.value ? 1 : 3))

const visibleMonthGrids = computed(() => {
  const size = monthPageSize.value
  const start = monthPage.value * size
  return monthGrids.value.slice(start, start + size)
})

const monthNavLabel = computed(() => {
  if (!usesSingleMonth.value || monthGrids.value.length <= 1) return ''
  return `${monthPage.value + 1} of ${monthGrids.value.length}`
})

const canPrevMonths = computed(() => monthPage.value > 0)
const canNextMonths = computed(() => (monthPage.value + 1) * monthPageSize.value < monthGrids.value.length)

function cellBandClass(band: DayRatingBand, inMonth: boolean): string {
  if (!inMonth) return 'cell--out'
  if (band === 'high') return 'cell--high'
  if (band === 'mixed') return 'cell--mixed'
  if (band === 'low') return 'cell--low'
  return 'cell--idle'
}

function cellTooltip(date: string, recipes: number, reviews: number, band: DayRatingBand): string {
  const pretty = isoToPretty(date)
  if (recipes === 0 && reviews === 0) return `${pretty} — no activity`
  const parts: string[] = []
  if (recipes > 0) parts.push(`${recipes} recipe${recipes === 1 ? '' : 's'}`)
  if (reviews > 0) parts.push(`${reviews} review${reviews === 1 ? '' : 's'}`)
  const bandLabel =
    band === 'high' ? 'high-rated' : band === 'low' ? 'low-rated' : band === 'mixed' ? 'mixed' : ''
  return `${pretty}: ${parts.join(', ')}${bandLabel ? ` (${bandLabel})` : ''}`
}

const cookingInsightPct = computed(() => {
  const t = data.value?.thresholds.cooking
  if (!t || t.need <= 0) return 0
  return Math.min(100, Math.round((t.have / t.need) * 100))
})

const diningInsightPct = computed(() => {
  const t = data.value?.thresholds.dining
  if (!t || t.need <= 0) return 0
  return Math.min(100, Math.round((t.have / t.need) * 100))
})

const showRatingTrend = computed(() => {
  if (isStateNew.value) return false
  return (data.value?.ratingTrend.length ?? 0) > 0
})

const ratingTrendMax = computed(() => {
  const weeks = data.value?.ratingTrend ?? []
  return Math.max(5, ...weeks.map((w) => w.averageRating ?? 0), 1)
})

function milestoneBadge(status: ProgressMilestoneStatus, m: ProgressDashboardPayload['milestones'][number]): string {
  if (status === 'earned') return 'Earned'
  if (status === 'almost' && m.progress) {
    const left = Math.max(0, m.progress.need - m.progress.have)
    return left > 0 ? `${left} to go` : 'Almost there'
  }
  if (status === 'almost') return 'Almost there'
  return 'Not yet'
}

async function loadDashboard() {
  const uid = getBiteBudUserId()
  if (!uid) {
    void router.replace({ name: 'auth', query: { redirect: '/progress' } })
    return
  }
  const firstLoad = !data.value
  if (firstLoad) loading.value = true
  err.value = ''
  try {
    data.value = await fetchProgressDashboard(
      toIso(progressRange.from.value),
      toIso(progressRange.to.value),
    )
  } catch (e) {
    err.value = e instanceof Error ? e.message : 'Could not load progress'
  } finally {
    if (firstLoad) loading.value = false
  }
}

watch(
  () => [progressRange.preset.value, progressRange.from.value.getTime(), progressRange.to.value.getTime()],
  () => {
    monthPage.value = 0
    void loadDashboard()
  },
)

watch(monthGrids, (grids) => {
  const maxPage = Math.max(0, Math.ceil(grids.length / monthPageSize.value) - 1)
  if (monthPage.value > maxPage) monthPage.value = maxPage
})

onMounted(() => {
  void loadDashboard()
})
</script>

<template>
  <main class="page">
    <header class="head">
      <h1 class="h1">See my activity</h1>
      <p class="page-lede">See how your cooking and dining activity builds over time.</p>
    </header>

    <div id="range-activity" tabindex="-1">
      <InsightsRangePicker :disabled="isStateNew && !loading" />
    </div>

    <p v-if="loading && !data" class="hint">Loading…</p>
    <p v-else-if="err" class="err" role="status">{{ err }}</p>

    <template v-else-if="data">
      <section class="stat-row" aria-label="Summary for selected period">
        <article v-for="card in statCards" :key="card.key" class="stat-card">
          <span class="stat-card__value">{{ card.value }}</span>
          <span class="stat-card__label">
            {{
              card.key === 'recipes'
                ? 'Recipes cooked'
                : card.key === 'reviews'
                  ? 'Dining reviews'
                  : 'Days active'
            }}
          </span>
          <span class="stat-card__sub" :class="{ muted: card.sub === 'No data yet' }">{{ card.sub }}</span>
        </article>
      </section>

      <section class="activity-band">
        <div v-if="isStateNew" class="onboard-placeholder">
          <div class="onboard-placeholder__icon" aria-hidden="true">📅</div>
          <h2 class="onboard-placeholder__title">Your activity calendar will appear here</h2>
          <p class="onboard-placeholder__text">
            Complete your first recipe or leave a restaurant review and your progress will start building here — day
            by day.
          </p>
          <RouterLink class="onboard-placeholder__btn" :to="{ name: 'home' }">Browse recipes</RouterLink>
        </div>

        <template v-else>
          <div class="progress-grid">
            <div class="calendar-panel">
              <p class="calendar-range">{{ isoToPretty(data.range.from) }} to {{ isoToPretty(data.range.to) }}</p>
              <p class="calendar-hint">Hover over any day to see details.</p>
              <div class="legend" aria-hidden="true">
                <span class="legend__item"><i class="dot dot--high" /> High-rated</span>
                <span class="legend__item"><i class="dot dot--mixed" /> Mixed</span>
                <span class="legend__item"><i class="dot dot--low" /> Low-rated</span>
              </div>
              <div class="months">
                <section v-for="grid in visibleMonthGrids" :key="grid.monthKey" class="month">
                  <h3 class="month-title">{{ grid.label }}</h3>
                  <div class="dow" aria-hidden="true">
                    <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
                  </div>
                  <div class="grid" :aria-label="`Calendar: ${grid.label}`">
                    <button
                      v-for="d in grid.days"
                      :key="`${grid.monthKey}-${d.date}`"
                      type="button"
                      class="cell"
                      :class="cellBandClass(d.ratingBand, d.inMonth)"
                      :data-tip="d.inMonth ? cellTooltip(d.date, d.recipes, d.reviews, d.ratingBand) : ''"
                      :aria-label="d.inMonth ? cellTooltip(d.date, d.recipes, d.reviews, d.ratingBand) : undefined"
                      :tabindex="d.inMonth ? 0 : -1"
                    >
                      <span v-if="d.inMonth" class="day">{{ Number(d.date.slice(8, 10)) }}</span>
                    </button>
                  </div>
                </section>
              </div>
              <div v-if="monthGrids.length > 1" class="month-nav">
                <button type="button" class="month-nav-btn" :disabled="!canPrevMonths" @click="monthPage -= 1">
                  Previous
                </button>
                <span v-if="monthNavLabel" class="month-nav-label">{{ monthNavLabel }}</span>
                <button type="button" class="month-nav-btn" :disabled="!canNextMonths" @click="monthPage += 1">
                  Next
                </button>
              </div>
            </div>

            <div class="gauges">
              <article class="gauge-card">
                <h3 class="gauge-title">
                  Cooked recipes: <strong>{{ data.stats.recipesCooked }}</strong>
                </h3>
                <div class="gauge" role="img" :aria-label="`Cooked recipes in ${progressRangeCaption}`">
                  <svg viewBox="0 0 120 120" class="gauge-svg" aria-hidden="true">
                    <path class="gauge-track" d="M 28.18 91.82 A 45 45 0 1 1 91.82 91.82" pathLength="100" fill="none" />
                    <path
                      class="gauge-fill gauge-fill--cook"
                      d="M 28.18 91.82 A 45 45 0 1 1 91.82 91.82"
                      pathLength="100"
                      fill="none"
                      :stroke-dasharray="`${gaugePercent(data.stats.recipesCooked)} 100`"
                    />
                  </svg>
                  <div class="gauge-readout">
                    <span class="gauge-value">{{ data.stats.recipesCooked }}</span>
                    <span class="gauge-unit">recipes</span>
                  </div>
                </div>
                <p class="gauge-caption">{{ progressRangeCaption }}</p>
              </article>
              <article class="gauge-card">
                <h3 class="gauge-title">
                  Dined out: <strong>{{ data.stats.diningReviews }}</strong>
                </h3>
                <div class="gauge" role="img" :aria-label="`Dining reviews in ${progressRangeCaption}`">
                  <svg viewBox="0 0 120 120" class="gauge-svg" aria-hidden="true">
                    <path class="gauge-track" d="M 28.18 91.82 A 45 45 0 1 1 91.82 91.82" pathLength="100" fill="none" />
                    <path
                      class="gauge-fill gauge-fill--dine"
                      d="M 28.18 91.82 A 45 45 0 1 1 91.82 91.82"
                      pathLength="100"
                      fill="none"
                      :stroke-dasharray="`${gaugePercent(data.stats.diningReviews)} 100`"
                    />
                  </svg>
                  <div class="gauge-readout">
                    <span class="gauge-value">{{ data.stats.diningReviews }}</span>
                    <span class="gauge-unit">reviews</span>
                  </div>
                </div>
                <p class="gauge-caption">{{ progressRangeCaption }}</p>
              </article>
            </div>
          </div>
        </template>
      </section>

      <section
        v-if="settings.insightsEnabled !== false && !isStateNew"
        class="insights-panel"
        :class="isStateEstablished ? 'insights-panel--active' : 'insights-panel--unlock'"
        aria-label="Patterns status"
      >
        <template v-if="isStateEstablished">
          <div class="insights-active">
            <span class="insights-active__icon" aria-hidden="true">💡</span>
            <div>
              <h2 class="insights-active__title">Your patterns are ready</h2>
              <p class="insights-active__text">
                Both cooking and dining patterns are now being tracked. See your patterns to find out what we&apos;ve learned.
              </p>
              <RouterLink class="insights-active__link" :to="{ name: 'myInsights' }">See my patterns</RouterLink>
            </div>
          </div>
        </template>
        <template v-else>
          <h2 class="unlock-title">Unlock your Insights</h2>
          <div class="unlock-row">
            <div class="unlock-row__head">
              <span>Cooking patterns</span>
              <span>{{ data.thresholds.cooking.have }} of {{ data.thresholds.cooking.need }} recipes rated</span>
            </div>
            <div class="unlock-bar" aria-hidden="true">
              <div class="unlock-bar__fill unlock-bar__fill--cook" :style="{ width: `${cookingInsightPct}%` }" />
            </div>
            <p class="unlock-hint">Rate {{ data.thresholds.cooking.need }} recipes to unlock your cooking patterns.</p>
          </div>
          <div class="unlock-row">
            <div class="unlock-row__head">
              <span>Dining patterns</span>
              <span>{{ data.thresholds.dining.have }} of {{ data.thresholds.dining.need }} reviews</span>
            </div>
            <div class="unlock-bar" aria-hidden="true">
              <div class="unlock-bar__fill unlock-bar__fill--dine" :style="{ width: `${diningInsightPct}%` }" />
            </div>
            <p class="unlock-hint">
              Review {{ data.thresholds.dining.need }} restaurants to unlock your dining patterns.
            </p>
          </div>
        </template>
      </section>

      <section v-if="showRatingTrend" class="trend-panel" aria-labelledby="trend-heading">
        <h2 id="trend-heading" class="trend-title">Your rating trend — Cooking</h2>
        <p class="trend-sub">Average recipe rating per week in this period</p>
        <div class="trend-chart" role="img" :aria-label="data.ratingTrendSummary ?? 'Weekly rating trend'">
          <div v-for="(week, idx) in data.ratingTrend" :key="week.weekStart" class="trend-bar-wrap">
            <div
              class="trend-bar"
              :class="{ 'trend-bar--muted': idx === 0 && (week.averageRating ?? 0) < 4 }"
              :style="{
                height: `${Math.max(8, ((week.averageRating ?? 0) / ratingTrendMax) * 100)}%`,
              }"
            />
            <span class="trend-bar-label">{{ week.weekLabel }}</span>
          </div>
        </div>
        <p v-if="data.ratingTrendSummary" class="trend-summary">{{ data.ratingTrendSummary }}</p>
      </section>

      <section class="milestones" aria-labelledby="milestones-heading">
        <h2 id="milestones-heading" class="milestones-title">Milestones</h2>
        <ul class="milestone-list">
          <li
            v-for="m in data.milestones"
            :key="m.id"
            class="milestone-item"
            :class="{
              'milestone-item--earned': m.status === 'earned',
              'milestone-item--almost': m.status === 'almost',
            }"
          >
            <span class="milestone-item__icon" aria-hidden="true">{{ m.status === 'earned' ? '✓' : '◎' }}</span>
            <div class="milestone-item__body">
              <span class="milestone-item__title">{{ m.title }}</span>
              <span class="milestone-item__desc">{{ m.description }}</span>
            </div>
            <span
              class="milestone-item__badge"
              :class="{
                earned: m.status === 'earned',
                almost: m.status === 'almost',
              }"
            >
              {{ milestoneBadge(m.status, m) }}
            </span>
          </li>
        </ul>
      </section>
    </template>

    <p class="back">
      <RouterLink to="/">Back to home</RouterLink>
    </p>
  </main>
</template>

<style scoped>
.page {
  --mp-bg: #f9f7f2;
  --mp-teal: #66999b;
  --mp-navy: #2d3a4a;
  --mp-text: #4a5568;
  --mp-border: rgba(74, 85, 104, 0.18);
  --mp-high: #5a9e9c;
  --mp-mixed: #e8c468;
  --mp-low: #e8a87c;

  max-width: min(72rem, 100%);
  margin: 0 auto;
  padding: 1.25rem 1rem 2.5rem;
  background: var(--mp-bg);
  min-height: 100vh;
  box-sizing: border-box;
}

.head {
  margin-bottom: 1rem;
}

.h1 {
  margin: 0;
  font-family: var(--bb-font-headline, system-ui, sans-serif);
  font-size: clamp(1.6rem, 4.5vw, 2rem);
  font-weight: 800;
  color: var(--mp-teal);
}

.page-lede {
  margin: 0.4rem 0 0;
  font-size: 0.9rem;
  line-height: 1.45;
  color: var(--mp-text);
  max-width: 36rem;
}

.hint,
.err {
  margin: 0.5rem 0;
  font-size: 0.88rem;
}

.err {
  color: #b42318;
}

.stat-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.65rem;
  margin: 1rem 0;
}

.stat-card {
  background: #fff;
  border: 1px solid var(--mp-border);
  border-radius: 14px;
  padding: 0.85rem 0.65rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.stat-card__value {
  font-size: 1.75rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--mp-navy);
  line-height: 1.1;
}

.stat-card__label {
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mp-text);
}

.stat-card__sub {
  font-size: 0.72rem;
  color: #2a9d5f;
  font-weight: 600;
}

.stat-card__sub.muted {
  color: var(--mp-text);
  opacity: 0.65;
  font-weight: 500;
}

.activity-band {
  margin-bottom: 1.25rem;
}

.onboard-placeholder {
  background: #fff;
  border: 1px solid var(--mp-border);
  border-radius: 16px;
  padding: 2rem 1.25rem;
  text-align: center;
}

.onboard-placeholder__icon {
  font-size: 2rem;
  margin-bottom: 0.5rem;
}

.onboard-placeholder__title {
  margin: 0 0 0.5rem;
  font-size: 1rem;
  font-weight: 800;
  color: var(--mp-navy);
}

.onboard-placeholder__text {
  margin: 0 auto 1rem;
  max-width: 28rem;
  font-size: 0.86rem;
  line-height: 1.5;
  color: var(--mp-text);
}

.onboard-placeholder__btn {
  display: inline-flex;
  padding: 0.55rem 1.1rem;
  border-radius: 999px;
  background: var(--mp-navy);
  color: #fff;
  font-weight: 700;
  font-size: 0.85rem;
  text-decoration: none;
}

.progress-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  gap: 1rem;
  align-items: stretch;
}

.calendar-panel {
  background: #fff;
  border: 1px solid var(--mp-border);
  border-radius: 16px;
  padding: 0.85rem;
}

.calendar-range {
  margin: 0 0 0.25rem;
  font-weight: 800;
  font-size: 0.88rem;
  color: var(--mp-navy);
}

.calendar-hint {
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  font-style: italic;
  color: var(--mp-text);
  opacity: 0.8;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  margin-bottom: 0.65rem;
  font-size: 0.72rem;
  color: var(--mp-text);
}

.legend__item {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.dot {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 50%;
  display: inline-block;
}

.dot--high {
  background: var(--mp-high);
}
.dot--mixed {
  background: var(--mp-mixed);
}
.dot--low {
  background: var(--mp-low);
}

.months {
  display: grid;
  gap: 1rem;
}

.month-title {
  margin: 0 0 0.35rem;
  font-size: 0.95rem;
  font-weight: 800;
  color: var(--mp-navy);
}

.dow {
  display: grid;
  grid-template-columns: repeat(7, minmax(2rem, 1fr));
  gap: 0.3rem;
  margin-bottom: 0.3rem;
  font-size: 0.72rem;
  color: var(--mp-text);
  opacity: 0.75;
}

.dow span {
  text-align: center;
}

.grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(2rem, 1fr));
  gap: 0.3rem;
}

.cell {
  aspect-ratio: 1;
  min-height: 2rem;
  border: none;
  border-radius: 8px;
  padding: 0;
  position: relative;
  cursor: default;
  background: #f1f5f9;
}

.cell--out {
  opacity: 0.25;
  pointer-events: none;
}

.cell--idle {
  background: #f1f5f9;
}

.cell--high {
  background: color-mix(in srgb, var(--mp-high) 55%, white);
}

.cell--mixed {
  background: color-mix(in srgb, var(--mp-mixed) 65%, white);
}

.cell--low {
  background: color-mix(in srgb, var(--mp-low) 55%, white);
}

.cell:hover::after,
.cell:focus-visible::after {
  content: attr(data-tip);
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  font-size: 0.72rem;
  padding: 0.35rem 0.5rem;
  border-radius: 8px;
  background: var(--mp-navy);
  color: #fff;
  z-index: 5;
  pointer-events: none;
}

.day {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--mp-navy);
}

.month-nav {
  margin-top: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.month-nav-btn {
  border: 1px solid var(--mp-border);
  background: #fff;
  border-radius: 999px;
  padding: 0.35rem 0.7rem;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
}

.month-nav-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.month-nav-label {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--mp-text);
}

.gauges {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.gauge-card {
  background: #fff;
  border: 1px solid var(--mp-border);
  border-radius: 14px;
  padding: 0.75rem;
  text-align: center;
}

.gauge-title {
  margin: 0 0 0.35rem;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--mp-text);
}

.gauge {
  position: relative;
  width: min(160px, 100%);
  margin: 0 auto;
  aspect-ratio: 1;
}

.gauge-svg {
  width: 100%;
  height: 100%;
}

.gauge-track {
  stroke: color-mix(in srgb, var(--mp-border) 60%, transparent);
  stroke-width: 10;
  stroke-linecap: round;
}

.gauge-fill {
  stroke-width: 10;
  stroke-linecap: round;
  transition: stroke-dasharray 0.35s ease;
}

.gauge-fill--cook {
  stroke: color-mix(in srgb, var(--mp-teal) 80%, white);
}

.gauge-fill--dine {
  stroke: color-mix(in srgb, #3d7ab8 75%, white);
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
  font-size: 1.75rem;
  font-weight: 800;
  color: var(--mp-navy);
}

.gauge-unit {
  font-size: 0.75rem;
  color: var(--mp-text);
}

.gauge-caption {
  margin: 0.25rem 0 0;
  font-size: 0.78rem;
  color: var(--mp-text);
  opacity: 0.85;
}

.insights-panel {
  border-radius: 16px;
  padding: 1rem 1.1rem;
  margin-bottom: 1.25rem;
}

.insights-panel--unlock {
  background: var(--mp-navy);
  color: #fff;
}

.insights-panel--active {
  background: color-mix(in srgb, #2a9d5f 12%, white);
  border: 1px solid color-mix(in srgb, #2a9d5f 35%, transparent);
}

.unlock-title {
  margin: 0 0 0.85rem;
  font-size: 1rem;
  font-weight: 800;
}

.unlock-row {
  margin-bottom: 0.85rem;
}

.unlock-row:last-of-type {
  margin-bottom: 0;
}

.unlock-row__head {
  display: flex;
  justify-content: space-between;
  font-size: 0.82rem;
  font-weight: 700;
  margin-bottom: 0.35rem;
}

.unlock-bar {
  height: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.2);
  overflow: hidden;
}

.unlock-bar__fill {
  height: 100%;
  border-radius: inherit;
  transition: width 0.35s ease;
}

.unlock-bar__fill--cook {
  background: #7ec8a8;
}

.unlock-bar__fill--dine {
  background: #8fb8e8;
}

.unlock-hint {
  margin: 0.35rem 0 0;
  font-size: 0.75rem;
  opacity: 0.85;
}

.insights-active {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
}

.insights-active__icon {
  font-size: 1.5rem;
}

.insights-active__title {
  margin: 0 0 0.35rem;
  font-size: 0.95rem;
  font-weight: 800;
  color: var(--mp-navy);
}

.insights-active__text {
  margin: 0 0 0.5rem;
  font-size: 0.84rem;
  line-height: 1.45;
  color: var(--mp-text);
}

.insights-active__link {
  font-weight: 800;
  font-size: 0.84rem;
  color: var(--mp-teal);
  text-decoration: none;
}

.insights-active__link:hover {
  text-decoration: underline;
}

.trend-panel {
  background: #fff;
  border: 1px solid var(--mp-border);
  border-radius: 16px;
  padding: 1rem;
  margin-bottom: 1.25rem;
}

.trend-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 800;
  color: var(--mp-navy);
}

.trend-sub {
  margin: 0.2rem 0 0.75rem;
  font-size: 0.78rem;
  color: var(--mp-text);
  opacity: 0.85;
}

.trend-chart {
  display: flex;
  align-items: flex-end;
  gap: 0.65rem;
  min-height: 120px;
  padding: 0.5rem 0;
}

.trend-bar-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  height: 100px;
  justify-content: flex-end;
}

.trend-bar {
  width: 100%;
  max-width: 3rem;
  border-radius: 6px 6px 2px 2px;
  background: var(--mp-high);
  min-height: 8px;
  transition: height 0.35s ease;
}

.trend-bar--muted {
  background: var(--mp-mixed);
}

.trend-bar-label {
  font-size: 0.68rem;
  color: var(--mp-text);
  text-align: center;
}

.trend-summary {
  margin: 0.65rem 0 0;
  font-size: 0.82rem;
  color: var(--mp-text);
  font-style: italic;
}

.milestones {
  background: #fff;
  border: 1px solid var(--mp-border);
  border-radius: 16px;
  padding: 1rem;
  margin-bottom: 1rem;
}

.milestones-title {
  margin: 0 0 0.75rem;
  font-size: 0.95rem;
  font-weight: 800;
  color: var(--mp-navy);
}

.milestone-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.milestone-item {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.65rem 0.75rem;
  border-radius: 12px;
  border: 1px solid var(--mp-border);
  background: #fafafa;
}

.milestone-item--earned {
  background: color-mix(in srgb, #2a9d5f 8%, white);
  border-color: color-mix(in srgb, #2a9d5f 25%, transparent);
}

.milestone-item--almost {
  opacity: 0.92;
}

.milestone-item__icon {
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 0.85rem;
  background: #e2e8f0;
  color: var(--mp-text);
  flex-shrink: 0;
}

.milestone-item--earned .milestone-item__icon {
  background: #2a9d5f;
  color: #fff;
}

.milestone-item__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.milestone-item__title {
  font-size: 0.84rem;
  font-weight: 800;
  color: var(--mp-navy);
}

.milestone-item__desc {
  font-size: 0.74rem;
  color: var(--mp-text);
  opacity: 0.88;
}

.milestone-item__badge {
  font-size: 0.68rem;
  font-weight: 800;
  padding: 0.2rem 0.45rem;
  border-radius: 999px;
  background: #e2e8f0;
  color: var(--mp-text);
  flex-shrink: 0;
}

.milestone-item__badge.earned {
  background: #2a9d5f;
  color: #fff;
}

.milestone-item__badge.almost {
  background: color-mix(in srgb, var(--mp-mixed) 40%, white);
  color: var(--mp-navy);
}

.back {
  margin-top: 1rem;
}

.back a {
  color: var(--mp-teal);
  font-weight: 600;
  text-decoration: none;
}

@media (max-width: 900px) {
  .progress-grid {
    grid-template-columns: 1fr;
  }

  .stat-row {
    grid-template-columns: 1fr;
  }
}
</style>
