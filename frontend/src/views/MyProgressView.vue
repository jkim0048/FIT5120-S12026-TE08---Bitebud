<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { getBiteBudUserId } from '../composables/useUserId'
import { fetchMotivationProgress, type MotivationProgressPayload } from '../lib/motivationApi'

const router = useRouter()
const loading = ref(true)
const err = ref('')
const data = ref<MotivationProgressPayload | null>(null)

const MIN = 3

const now = new Date()
const viewYear = ref(now.getFullYear())
const viewMonth = ref(now.getMonth() + 1)

const monthTitle = computed(() => {
  const d = data.value
  if (!d) return ''
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(
    new Date(Date.UTC(d.calendarYear, d.calendarMonth - 1, 1)),
  )
})

/** Sun-first calendar: leading blanks + days of month from API (UTC month alignment). */
const calendarCells = computed(() => {
  const cells: Array<{ date: string; count: number; label: string | null }> = []
  const month = data.value?.calendarMonthDays ?? []
  if (!month.length) return cells
  const first = month[0]
  const y = Number(first.date.slice(0, 4))
  const m = Number(first.date.slice(5, 7)) - 1
  const jsDow = new Date(Date.UTC(y, m, 1)).getUTCDay()
  for (let i = 0; i < jsDow; i++) {
    cells.push({ date: '', count: 0, label: null })
  }
  for (const c of month) {
    cells.push({
      date: c.date,
      count: c.count,
      label: String(Number(c.date.slice(8, 10))),
    })
  }
  return cells
})

const recipeCount = computed(() => data.value?.breakdown.recipe_completed ?? 0)
const reviewCount = computed(() => data.value?.breakdown.restaurant_review_submitted ?? 0)

const dayDetailFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

function calendarCellTitle(cell: { date: string; count: number }): string | undefined {
  if (!cell.date) return undefined
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cell.date.trim())
  const dateLabel = m
    ? dayDetailFormatter.format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))))
    : cell.date
  if (cell.count <= 0) return `${dateLabel} — no activity`
  return `${dateLabel}: ${cell.count} ${cell.count === 1 ? 'activity' : 'activities'}`
}

const activityBarDenominator = computed(() => {
  return Math.max(1, recipeCount.value, reviewCount.value)
})

const recipeBarPct = computed(() => (recipeCount.value / activityBarDenominator.value) * 100)
const reviewBarPct = computed(() => (reviewCount.value / activityBarDenominator.value) * 100)

const showUnlockHint = computed(() => (data.value?.eligibleTotal ?? 0) < MIN)

async function loadProgress() {
  const uid = getBiteBudUserId()
  if (!uid) {
    void router.replace({ name: 'auth', query: { redirect: '/progress' } })
    return
  }
  const firstLoad = !data.value
  if (firstLoad) loading.value = true
  err.value = ''
  try {
    data.value = await fetchMotivationProgress({
      year: viewYear.value,
      month: viewMonth.value,
    })
  } catch (e) {
    err.value = e instanceof Error ? e.message : 'Could not load progress'
  } finally {
    if (firstLoad) loading.value = false
  }
}

function shiftMonth(delta: number) {
  let m = viewMonth.value + delta
  let y = viewYear.value
  while (m > 12) {
    m -= 12
    y += 1
  }
  while (m < 1) {
    m += 12
    y -= 1
  }
  viewMonth.value = m
  viewYear.value = y
  void loadProgress()
}

onMounted(() => {
  void loadProgress()
})
</script>

<template>
  <main class="page">
    <header class="head">
      <h1 class="h1">My Progress</h1>
      <p class="lead">Your activity, just for you.</p>
    </header>

    <p v-if="loading && !data" class="hint">Loading…</p>
    <p v-else-if="err" class="err">{{ err }}</p>

    <template v-else-if="data">
      <p v-if="showUnlockHint" class="unlock-hint">
        Log a few more cooking or dining moments to unlock richer insights elsewhere. You have
        {{ data.eligibleTotal }} recorded (we suggest at least {{ MIN }}).
      </p>

      <section class="section">
        <h2 class="h2">Activity this month</h2>
        <div class="month-nav">
          <button type="button" class="nav-btn" aria-label="Previous month" @click="shiftMonth(-1)">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"
              />
            </svg>
          </button>
          <span class="month-title">{{ monthTitle }}</span>
          <button type="button" class="nav-btn" aria-label="Next month" @click="shiftMonth(1)">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"
              />
            </svg>
          </button>
        </div>

        <div class="cal-head">
          <span>Sun</span>
          <span>Mon</span>
          <span>Tue</span>
          <span>Wed</span>
          <span>Thu</span>
          <span>Fri</span>
          <span>Sat</span>
        </div>
        <div class="cal">
          <div
            v-for="(cell, idx) in calendarCells"
            :key="cell.date || `pad-${idx}`"
            class="cal-cell"
            :class="{
              'cal-cell--pad': !cell.date,
              'cal-cell--active': cell.date && cell.count > 0,
            }"
            :title="calendarCellTitle(cell)"
            :aria-label="cell.date ? calendarCellTitle(cell) : undefined"
          >
            <template v-if="cell.date">
              <span class="cal-d">{{ cell.label }}</span>
            </template>
          </div>
        </div>
        <p class="month-foot">
          <em
            >Active {{ data.activeDaysThisMonth }} of {{ data.daysInMonth }} days this month.</em
          >
        </p>
      </section>

      <section class="section">
        <h2 class="h2">Your rhythm</h2>
        <div class="rhythm">
          <div class="rhythm-card">
            <span class="rhythm-num">{{ data.currentStreak }}</span>
            <span class="rhythm-label">Current streak</span>
          </div>
          <div class="rhythm-card">
            <span class="rhythm-num">{{ data.longestStreak }}</span>
            <span class="rhythm-label">Best run so far</span>
          </div>
          <div class="rhythm-card">
            <span class="rhythm-num">{{ data.totalActiveDays }}</span>
            <span class="rhythm-label">Total active days</span>
          </div>
        </div>
      </section>

      <section class="section">
        <h2 class="h2">What you have been doing</h2>
        <ul class="activity-list">
          <li class="activity-row">
            <span class="activity-icon" aria-hidden="true">
              <svg class="ico" viewBox="0 0 24 24" width="22" height="22">
                <path
                  fill="currentColor"
                  d="M12 3c-2 0-3.5 2-3.5 4.5V9h7v-1.5C15.5 5 14 3 12 3zm-8 7v2c0 3.5 2.5 6 6 6v5h2v-5c3.5 0 6-2.5 6-6v-2H4z"
                />
              </svg>
            </span>
            <div class="activity-main">
              <div class="activity-top">
                <span class="activity-name">Recipes cooked</span>
                <span class="activity-count">{{ recipeCount }}</span>
              </div>
              <div class="bar-track">
                <div class="bar-fill" :style="{ width: `${recipeBarPct}%` }" />
              </div>
            </div>
          </li>
          <li class="activity-row">
            <span class="activity-icon" aria-hidden="true">
              <svg class="ico" viewBox="0 0 24 24" width="22" height="22">
                <path
                  fill="currentColor"
                  d="M8.1 13.34l2.83-2.83L3 3v2.83l5.1 5.51zM14.53 12.98l7.07 7.07 1.41-1.41-7.07-7.07-2.83 2.83zM20.41 5.41l-3.83-3.83-9.19 9.19v3.83h3.83l9.19-9.19z"
                />
              </svg>
            </span>
            <div class="activity-main">
              <div class="activity-top">
                <span class="activity-name">Restaurants reviewed</span>
                <span class="activity-count">{{ reviewCount }}</span>
              </div>
              <div class="bar-track">
                <div class="bar-fill" :style="{ width: `${reviewBarPct}%` }" />
              </div>
            </div>
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
  --mp-text: #4a5568;
  --mp-card: #e2e8f0;
  --mp-border: rgba(74, 85, 104, 0.18);

  max-width: 26rem;
  margin: 0 auto;
  padding: 1.25rem 1rem 2.5rem;
  background: var(--mp-bg);
  min-height: 100vh;
  box-sizing: border-box;
}

.head {
  margin-bottom: 1.25rem;
}

.h1 {
  margin: 0 0 0.35rem;
  font-family: var(--bb-font-headline, system-ui, sans-serif);
  font-size: clamp(1.6rem, 4.5vw, 2rem);
  font-weight: 800;
  color: var(--mp-teal);
  letter-spacing: -0.02em;
}

.lead {
  margin: 0;
  color: var(--mp-text);
  font-weight: 500;
  font-size: 0.95rem;
  opacity: 0.9;
}

.h2 {
  margin: 0 0 0.75rem;
  font-size: 1rem;
  font-weight: 700;
  color: var(--mp-text);
}

.hint {
  margin: 0 0 0.75rem;
  color: var(--mp-text);
  font-size: 0.88rem;
  opacity: 0.8;
}

.err {
  color: #b42318;
}

.unlock-hint {
  margin: 0 0 1rem;
  padding: 0.75rem 0.9rem;
  border-radius: 14px;
  background: color-mix(in srgb, var(--mp-teal) 12%, white);
  color: var(--mp-text);
  font-size: 0.88rem;
  line-height: 1.45;
}

.section {
  margin-bottom: 1.5rem;
}

.month-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.month-title {
  font-weight: 700;
  font-size: 0.95rem;
  color: var(--mp-text);
}

.nav-btn {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 999px;
  border: 1px solid var(--mp-border);
  background: #fff;
  color: var(--mp-text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  transition: background 0.15s ease;
}

.nav-btn:hover {
  background: color-mix(in srgb, var(--mp-teal) 12%, white);
}

.cal-head {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.35rem;
  margin-bottom: 0.35rem;
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--mp-text);
  opacity: 0.65;
  text-align: center;
}

.cal {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.4rem;
}

.cal-cell {
  aspect-ratio: 1;
  border-radius: 12px;
  border: 1px solid var(--mp-border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  font-weight: 700;
  background: #fff;
  color: var(--mp-text);
}

.cal-cell--pad {
  border: none;
  background: transparent;
  pointer-events: none;
}

.cal-cell--active {
  background: #d9e8f0;
  border-color: #8fb0c4;
  color: var(--mp-text);
}

.cal-d {
  font-variant-numeric: tabular-nums;
}

.month-foot {
  margin: 0.75rem 0 0;
  font-size: 0.8rem;
  color: var(--mp-text);
  opacity: 0.85;
}

.rhythm {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
}

.rhythm-card {
  background: var(--mp-card);
  border-radius: 16px;
  padding: 0.9rem 0.5rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
}

.rhythm-num {
  font-size: 1.65rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--mp-text);
  line-height: 1.1;
}

.rhythm-label {
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--mp-text);
  opacity: 0.85;
  line-height: 1.25;
}

.activity-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.activity-row {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
}

.activity-icon {
  flex-shrink: 0;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 12px;
  background: #fff;
  border: 1px solid var(--mp-border);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--mp-teal);
}

.ico {
  display: block;
}

.activity-main {
  flex: 1;
  min-width: 0;
}

.activity-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}

.activity-name {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--mp-text);
}

.activity-count {
  font-size: 0.95rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--mp-text);
}

.bar-track {
  height: 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--mp-text) 10%, var(--mp-bg));
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--mp-teal);
  transition: width 0.25s ease;
}

.back {
  margin-top: 1rem;
}

.back a {
  color: var(--mp-teal);
  font-weight: 600;
  text-decoration: none;
}

.back a:hover {
  text-decoration: underline;
}
</style>
