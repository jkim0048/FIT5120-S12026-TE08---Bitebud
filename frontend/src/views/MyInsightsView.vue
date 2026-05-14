<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { jsPDF } from 'jspdf'
import { RouterLink, useRouter } from 'vue-router'
import { apiFetch } from '../lib/api'
import { useSession } from '../composables/useSession'
import { useSettings } from '../composables/useSettings'
import { useInsightsRange } from '../composables/useInsightsRange'

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
  lifetime?: {
    cookingDaysTotal: number
    diningDaysTotal: number
    diningTotal: number
    firstActivityDate: string | null
    daysSinceFirstActivity: number
  }
  thisWeek?: {
    weekStart: string | null
    cookingDays: number
    diningReviews: number
  }
}

const router = useRouter()
const { userId, isSignedIn } = useSession()
const { settings } = useSettings()
const insightsRange = useInsightsRange()

const loading = ref(false)
const error = ref('')
const data = ref<InsightsResponse | null>(null)
const exporting = ref(false)
const pdfVisible = ref(false)
const pdfEl = ref<HTMLElement | null>(null)
const monthPage = ref(0)

function usesSingleMonthCalendar(): boolean {
  const preset = insightsRange.preset.value
  return preset === '30d' || preset === '90d' || preset === '12m' || preset === 'custom'
}

function monthPageSize(): number {
  if (usesSingleMonthCalendar()) return 1
  // Keep this calm and compact for short ranges; show 4 months per page on wide screens, 3 on narrow.
  return window.matchMedia?.('(max-width: 900px)')?.matches ? 3 : 4
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

const canExport = computed(() => {
  const d = data.value
  if (!d) return false
  const hasProgress =
    (d.progress.calendar?.length ?? 0) > 0 || (d.progress.weeklyBars?.length ?? 0) > 0
  const hasCooking = (d.cooking.works?.length ?? 0) + (d.cooking.doesntWork?.length ?? 0) > 0
  const hasDining = (d.dining.works?.length ?? 0) > 0
  const hasAnyGuidance =
    d.thresholds.progress.have < d.thresholds.progress.need ||
    d.thresholds.cooking.have < d.thresholds.cooking.need ||
    d.thresholds.dining.have < d.thresholds.dining.need
  // Export only when at least one section has content (not guidance-only).
  return hasProgress || hasCooking || hasDining || !hasAnyGuidance
})

function pdfFileName(fromIso: string, toIsoStr: string): string {
  return `bitebud-insights-${fromIso}-to-${toIsoStr}.pdf`
}

function activitySummary() {
  const d = data.value
  if (!d) return { recipes: 0, reviews: 0, daysAny: 0 }
  const recipes = d.progress.typeBreakdown.recipes ?? 0
  const reviews = d.progress.typeBreakdown.dining ?? 0
  const daysAny = Array.isArray(d.progress.calendar)
    ? d.progress.calendar.filter((x) => (x.recipes ?? 0) + (x.dining ?? 0) > 0).length
    : 0
  return { recipes, reviews, daysAny }
}

const cookingWorksUnlocked = computed(
  () => (data.value?.thresholds.cooking.have ?? 0) >= (data.value?.thresholds.cooking.need ?? 3),
)
const cookingDoesntWorkUnlocked = computed(() => cookingWorksUnlocked.value)
const diningWorksUnlocked = computed(
  () => (data.value?.thresholds.dining.have ?? 0) >= (data.value?.thresholds.dining.need ?? 2),
)

const cookingWorksEmptyMessage = computed(() => {
  if (!data.value || !cookingWorksUnlocked.value || data.value.cooking.works.length > 0) return ''
  return "Let's keep cooking — BiteBud is still learning what tends to work well for you."
})

const cookingDoesntWorkEmptyMessage = computed(() => {
  if (!data.value || !cookingDoesntWorkUnlocked.value || data.value.cooking.doesntWork.length > 0) return ''
  return 'Keep cooking — patterns will appear here as you complete more recipes.'
})

const diningWorksEmptyMessage = computed(() => {
  if (!data.value || !diningWorksUnlocked.value || data.value.dining.works.length > 0) return ''
  return "Let's keep dining out — BiteBud is still learning what tends to suit you."
})

/** Total insight cards returned for this range (real API counts). */
const patternsFoundCount = computed(() => {
  const d = data.value
  if (!d) return 0
  return d.cooking.works.length + d.cooking.doesntWork.length + d.dining.works.length
})

/** Activity events in range (recipes completed + reviews) — same basis as progress threshold. */
const completionsInRange = computed(() => data.value?.thresholds.progress.have ?? 0)

const INSIGHT_UI_CATEGORIES = 2

const cookingInsightCardTotal = computed(() => {
  const d = data.value
  if (!d) return 0
  return d.cooking.works.length + d.cooking.doesntWork.length
})

const diningInsightCardTotal = computed(() => {
  const d = data.value
  if (!d) return 0
  return d.dining.works.length
})

function insightShortTitle(card: InsightCard): string {
  const quoted = /^"([^"]+)"/.exec(card.headline)
  if (quoted) return quoted[1]
  const segs = card.id.split('.').filter(Boolean)
  const last = segs[segs.length - 1] ?? ''
  if (last && !/^(works|dine|noise|music|light|crowds|smells)$/i.test(last)) {
    return last.replace(/-/g, ' ')
  }
  if (card.headline.length > 36) return `${card.headline.slice(0, 36)}…`
  return card.headline
}

function cookingWorksRingMax(): number {
  const ws = data.value?.cooking.works ?? []
  return Math.max(1, ...ws.map((c) => c.recordCount))
}
function cookingDoesntRingMax(): number {
  const ws = data.value?.cooking.doesntWork ?? []
  return Math.max(1, ...ws.map((c) => c.recordCount))
}
function diningWorksRingMax(): number {
  const ws = data.value?.dining.works ?? []
  return Math.max(1, ...ws.map((c) => c.recordCount))
}

function ringStrokePct(recordCount: number, maxCount: number): number {
  const m = Math.max(1, maxCount)
  const pct = Math.round((recordCount / m) * 88 + 10)
  return Math.min(100, Math.max(12, pct))
}

const dowFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' })

function mostActiveDow() {
  const d = data.value
  if (!d) return null
  const counts = new Map<string, number>()
  for (const day of d.progress.calendar ?? []) {
    const total = (day.recipes ?? 0) + (day.dining ?? 0)
    if (total <= 0) continue
    const dow = dowFormatter.format(new Date(`${day.date}T00:00:00.000Z`))
    counts.set(dow, (counts.get(dow) ?? 0) + total)
  }
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  const top = sorted[0]
  if (!top) return null
  // Only show if it is meaningfully higher than the runner up.
  const second = sorted[1]?.[1] ?? 0
  if (top[1] < 3) return null
  if (second > 0 && top[1] / second < 1.35) return null
  return top[0]
}

async function load() {
  if (!isSignedIn.value || !userId.value) {
    void router.push({ name: 'home' })
    return
  }
  if (settings.value.insightsEnabled === false) {
    void router.push({ name: 'home' })
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
  void load()
})

watch(
  () => [insightsRange.preset.value, insightsRange.from.value.getTime(), insightsRange.to.value.getTime()],
  () => {
    monthPage.value = 0
    void load()
  },
)

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
  const day = out.getUTCDay() // Sun=0
  const diff = (day + 6) % 7 // Mon=0
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

function exportPdf() {
  if (!canExport.value) return
  if (exporting.value) return
  const d = data.value
  if (!d) return

  exporting.value = true
  try {
    void pdfVisible.value
    void pdfEl.value

    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const pageW = doc.internal.pageSize.getWidth()
    const pageH = doc.internal.pageSize.getHeight()
    const mL = 20
    const mR = 20
    const mT = 15
    const mB = 15
    const reserve = 15
    const cw = pageW - mL - mR
    let y = mT

    const bottomLimit = () => pageH - mB - reserve

    function ensure(mm: number) {
      if (y + mm > bottomLimit()) {
        doc.addPage()
        y = mT
      }
    }

    function drawHR() {
      ensure(5)
      doc.setDrawColor(200, 200, 200)
      doc.setLineWidth(0.07)
      doc.line(mL, y, pageW - mR, y)
      y += 4
    }

    function writeRawLines(lines: string[], x: number, fontSize: number, style: 'normal' | 'bold' | 'italic', lineGapMm: number, rgb?: [number, number, number]) {
      doc.setFont('helvetica', style)
      doc.setFontSize(fontSize)
      if (rgb) doc.setTextColor(rgb[0], rgb[1], rgb[2])
      else doc.setTextColor(0, 0, 0)
      const maxW = pageW - mR - x
      for (const raw of lines) {
        const wrapped = doc.splitTextToSize(raw, maxW) as string[]
        for (const line of wrapped) {
          ensure(lineGapMm + 1)
          doc.text(line, x, y, { baseline: 'top' })
          y += lineGapMm
        }
      }
    }

    function sectionHeading(text: string) {
      ensure(6)
      writeRawLines([text], mL, 12, 'bold', 4)
      y += 1
    }

    function subHeading(text: string) {
      ensure(5)
      writeRawLines([text], mL, 10, 'bold', 3)
    }

    function bodyLine(text: string, indent = 0) {
      writeRawLines([text], mL + indent, 9, 'normal', 3)
    }

    function bodyParagraph(text: string, indent = 0) {
      const maxW = cw - indent
      const lines = doc.splitTextToSize(text, maxW) as string[]
      writeRawLines(lines, mL + indent, 9, 'normal', 3)
    }

    function writeCookingBullet(card: InsightCard) {
      const bi = 5
      const di = 10
      const head = `- "${card.headline}"`
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(0, 0, 0)
      const hLines = doc.splitTextToSize(head, cw - bi) as string[]
      for (const ln of hLines) {
        ensure(4)
        doc.text(ln, mL + bi, y, { baseline: 'top' })
        y += 3
      }
      doc.setFont('helvetica', 'normal')
      const tail = `Based on ${card.recordCount} recipe${card.recordCount === 1 ? '' : 's'}.`
      const rest = `${card.detail} ${tail}`
      const dLines = doc.splitTextToSize(rest, cw - di) as string[]
      for (const ln of dLines) {
        ensure(4)
        doc.text(ln, mL + di, y, { baseline: 'top' })
        y += 3
      }
      y += 1
    }

    function writeDiningBullet(card: InsightCard) {
      const bi = 5
      const di = 10
      const head = `- "${card.headline}"`
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(0, 0, 0)
      const hLines = doc.splitTextToSize(head, cw - bi) as string[]
      for (const ln of hLines) {
        ensure(4)
        doc.text(ln, mL + bi, y, { baseline: 'top' })
        y += 3
      }
      doc.setFont('helvetica', 'normal')
      const tail = `Based on ${card.recordCount} review${card.recordCount === 1 ? '' : 's'}.`
      const rest = `${card.detail} ${tail}`
      const dLines = doc.splitTextToSize(rest, cw - di) as string[]
      for (const ln of dLines) {
        ensure(4)
        doc.text(ln, mL + di, y, { baseline: 'top' })
        y += 3
      }
      y += 1
    }

    function fmtCalCell(cell: MonthGrid['days'][number]): string {
      if (!cell.inMonth) return ' · '
      const n = Number(cell.date.slice(8, 10))
      const mark = cell.total > 0 ? '*' : ' '
      return `${String(n).padStart(2, ' ')}${mark}`
    }

    // — Cover
    ensure(12)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.setTextColor(0, 0, 0)
    doc.text('BiteBud — My Insights', mL, y, { baseline: 'top' })
    y += 6
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(100, 100, 100)
    doc.text('Personal food and dining patterns', mL, y, { baseline: 'top' })
    y += 4
    doc.setTextColor(0, 0, 0)
    doc.text(`Date range: ${isoToPretty(d.range.from)} to ${isoToPretty(d.range.to)}`, mL, y, { baseline: 'top' })
    y += 3
    doc.text(`Generated on: ${isoToday()}`, mL, y, { baseline: 'top' })
    y += 4
    drawHR()

    // — Summary
    sectionHeading('Summary')
    const sum = activitySummary()
    bodyLine(`Recipes completed in this period: ${sum.recipes}`)
    bodyLine(`Restaurant reviews in this period: ${sum.reviews}`)
    bodyLine(`Days with any activity: ${sum.daysAny}`)
    const dow = mostActiveDow()
    if (dow) bodyLine(`Most active day of week: ${dow}`)
    y += 1
    drawHR()

    // — My Progress
    sectionHeading('My Progress')
    if (d.thresholds.progress.have < d.thresholds.progress.need) {
      const remainingCount = d.thresholds.progress.need - d.thresholds.progress.have
      const remainingLabel = remainingCount === 1 ? 'more activity' : 'more activities'
      bodyParagraph(`After ${remainingCount} ${remainingLabel}, your progress view will fill in.`)
      y += 1
    } else {
      for (const month of monthGrids.value) {
        subHeading(`Calendar: ${month.label}`)
        writeRawLines(['Mon Tue Wed Thu Fri Sat Sun'], mL, 9, 'bold', 3)
        const DAYS_PER_WEEK = 7
        for (let weekStartIndex = 0; weekStartIndex < month.days.length; weekStartIndex += DAYS_PER_WEEK) {
          const week = month.days.slice(weekStartIndex, weekStartIndex + DAYS_PER_WEEK)
          bodyLine(week.map(fmtCalCell).join('  '))
        }
        y += 2
      }

      subHeading('Weekly activity')
      const bars = d.progress.weeklyBars ?? []
      const maxWeeklyTotal = Math.max(1, ...bars.map((weekBar) => weekBar.recipes + weekBar.dining))
      const labelW = 32
      const barH = 4
      const barMaxW = cw - labelW - 2
      for (const weekBar of bars) {
        ensure(barH + 4)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        doc.setTextColor(0, 0, 0)
        doc.text(weekBar.weekStart, mL, y, { baseline: 'top' })
        const weeklyTotal = weekBar.recipes + weekBar.dining
        const barWidth = (weeklyTotal / maxWeeklyTotal) * barMaxW
        doc.setFillColor(210, 210, 210)
        doc.rect(mL + labelW, y, barWidth, barH, 'F')
        y += barH + 2
      }

      y += 1
      subHeading('Type breakdown')
      bodyLine(`Cooked recipes: ${d.progress.typeBreakdown.recipes}`)
      bodyLine(`Dined out: ${d.progress.typeBreakdown.dining}`)
      y += 1
    }
    drawHR()

    // — Cooking
    sectionHeading('Cooking')
    subHeading('What works well for you')
    if (d.thresholds.cooking.have < d.thresholds.cooking.need) {
      const remainingCount = d.thresholds.cooking.need - d.thresholds.cooking.have
      const remainingLabel = remainingCount === 1 ? 'more rated recipe' : 'more rated recipes'
      bodyParagraph(`After ${remainingCount} ${remainingLabel}, I can show you what your favourites have in common.`)
    } else {
      for (const cookingCard of d.cooking.works) writeCookingBullet(cookingCard)
    }
    y += 1
    subHeading("What doesn't seem to work")
    if (d.thresholds.cooking.have < d.thresholds.cooking.need) {
      const remainingCount = d.thresholds.cooking.need - d.thresholds.cooking.have
      const remainingLabel = remainingCount === 1 ? 'more rated recipe' : 'more rated recipes'
      bodyParagraph(`After ${remainingCount} ${remainingLabel}, I can show you what your favourites have in common.`)
    } else if (d.cooking.doesntWork.length === 0) {
      bodyLine('None recorded.')
    } else {
      for (const cookingCard of d.cooking.doesntWork) writeCookingBullet(cookingCard)
    }
    y += 1
    drawHR()

    // — Dining
    sectionHeading('Dining')
    subHeading('What works well for you when you dine out')
    if (d.thresholds.dining.have < d.thresholds.dining.need) {
      const remainingCount = d.thresholds.dining.need - d.thresholds.dining.have
      const remainingLabel = remainingCount === 1 ? 'more restaurant review' : 'more restaurant reviews'
      bodyParagraph(`After ${remainingCount} ${remainingLabel}, I can show you which places tend to suit you best.`)
    } else {
      for (const diningCard of d.dining.works) writeDiningBullet(diningCard)
    }
    y += 1
    drawHR()

    // — About + footer
    sectionHeading('About this report')
    bodyParagraph(
      'BiteBud is a tool for finding and preparing food in a calm, sensory-aware way. The patterns above are drawn only from this user\'s own recorded activity over the selected date range. They are observations, not medical advice or a clinical assessment. Share this report with anyone you choose — your data stays on your device unless you do.',
    )
    y += 1
    drawHR()
    writeRawLines(
      ['Generated from your own activity. Not shared with anyone unless you choose to share this file.'],
      mL,
      8,
      'normal',
      3,
      [110, 110, 110],
    )

    doc.save(pdfFileName(d.range.from, d.range.to))
  } catch (e) {
    console.error('[BiteBud PDF] jsPDF export failed', e)
  } finally {
    exporting.value = false
  }
}

</script>

<template>
  <section class="page">
    <p class="page-back">
      <RouterLink class="page-back-link" :to="{ name: 'home' }">Back to home</RouterLink>
    </p>
    <header class="assign-head">
      <div class="assign-head__brand">
        <h1 class="assign-head__h1">My Insights</h1>
        <p class="assign-head__lede">A quiet mirror of your own patterns.</p>
      </div>
      <span class="assign-privacy-pill">
        <svg class="assign-privacy-pill__lock" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 7V5a4 4 0 1 0-8 0v2H3v7h10V7h-1ZM5 5a3 3 0 0 1 6 0v2H5V5Z"
          />
        </svg>
        Nothing here is shared
      </span>
    </header>

    <p v-if="loading" class="sr-only">Loading insights</p>
    <div v-if="loading" class="assign-skel" aria-hidden="true">
      <div class="sk sk-sum" />
      <div class="sk sk-panel" />
      <div class="sk sk-panel sk-panel--short" />
    </div>
    <div v-else-if="error" class="insights-error" role="status">
      <p class="insights-error__text">{{ error }}</p>
    </div>

    <template v-else-if="data">
      <div class="assign-body">
        <section class="assign-summary" aria-label="Insight summary">
          <div class="assign-summary__item">
            <span class="assign-summary__num">{{ patternsFoundCount }}</span>
            <span class="assign-summary__lbl">Patterns Found</span>
          </div>
          <div class="assign-summary__item">
            <span class="assign-summary__num">{{ INSIGHT_UI_CATEGORIES }}</span>
            <span class="assign-summary__lbl">Categories</span>
          </div>
          <div class="assign-summary__item">
            <span class="assign-summary__num">{{ completionsInRange }}</span>
            <span class="assign-summary__lbl">Completions</span>
          </div>
        </section>

        <p class="assign-period">{{ isoToPretty(data.range.from) }} – {{ isoToPretty(data.range.to) }}</p>

        <!-- Cooking -->
        <section class="assign-cat assign-cat--cook" aria-labelledby="assign-cook-title">
          <div class="assign-cat__head">
            <span class="assign-cat__icon assign-cat__icon--cook" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="10.5" cy="10.5" r="5.5" stroke="currentColor" stroke-width="1.75" />
                <path d="M15 15L19 19" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
              </svg>
            </span>
            <div class="assign-cat__head-main">
              <h2 id="assign-cook-title" class="assign-cat__title">Cooking</h2>
              <p class="assign-cat__meta">{{ cookingInsightCardTotal }} patterns</p>
            </div>
          </div>

          <div class="assign-rule" role="presentation">
            <span class="assign-rule__line" aria-hidden="true" />
            <span class="assign-rule__text">What works well for you</span>
            <span class="assign-rule__line" aria-hidden="true" />
          </div>
          <div v-if="data.thresholds.cooking.have < data.thresholds.cooking.need" class="assign-guidance">
            After {{ data.thresholds.cooking.need - data.thresholds.cooking.have }}
            {{ data.thresholds.cooking.need - data.thresholds.cooking.have === 1 ? 'more rated recipe' : 'more rated recipes' }},
            I can show you what your favourites have in common.
          </div>
          <p v-else-if="cookingWorksEmptyMessage" class="assign-guidance" role="status">{{ cookingWorksEmptyMessage }}</p>
          <div v-else class="assign-card-list">
            <article v-for="c in data.cooking.works" :key="c.id" class="assign-card">
              <div
                class="assign-card__ring assign-card__ring--cook"
                aria-hidden="true"
                :style="{ '--ring-pct': String(ringStrokePct(c.recordCount, cookingWorksRingMax())) }"
              >
                <span class="assign-card__ring-n">{{ c.recordCount }}</span>
              </div>
              <div class="assign-card__main">
                <h4 class="assign-card__slug">{{ insightShortTitle(c) }}</h4>
                <p class="assign-card__detail">{{ c.detail || c.headline }}</p>
                <span class="assign-chip assign-chip--cook-ok">
                  <svg class="assign-chip__tick" viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
                    <path
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.75"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M2.5 6l2.5 2.5L9.5 3.5"
                    />
                  </svg>
                  Works for you
                </span>
              </div>
            </article>
          </div>

          <div class="assign-rule" role="presentation">
            <span class="assign-rule__line" aria-hidden="true" />
            <span class="assign-rule__text">What doesn't seem to work</span>
            <span class="assign-rule__line" aria-hidden="true" />
          </div>
          <div v-if="data.thresholds.cooking.have < data.thresholds.cooking.need" class="assign-guidance">
            After {{ data.thresholds.cooking.need - data.thresholds.cooking.have }}
            {{ data.thresholds.cooking.need - data.thresholds.cooking.have === 1 ? 'more rated recipe' : 'more rated recipes' }},
            I can show you what your favourites have in common.
          </div>
          <div v-else-if="data.cooking.doesntWork.length" class="assign-card-list">
            <article v-for="c in data.cooking.doesntWork" :key="c.id" class="assign-card">
              <div
                class="assign-card__ring assign-card__ring--cook-warn"
                aria-hidden="true"
                :style="{ '--ring-pct': String(ringStrokePct(c.recordCount, cookingDoesntRingMax())) }"
              >
                <span class="assign-card__ring-n">{{ c.recordCount }}</span>
              </div>
              <div class="assign-card__main">
                <h4 class="assign-card__slug">{{ insightShortTitle(c) }}</h4>
                <p class="assign-card__detail">{{ c.detail || c.headline }}</p>
                <span class="assign-chip assign-chip--cook-warn">Watch-out</span>
              </div>
            </article>
          </div>
          <div v-else class="assign-empty">
            <div class="assign-empty__mascot" aria-hidden="true">
              <svg viewBox="0 0 64 72" width="56" height="63" class="assign-empty__robot">
                <ellipse cx="32" cy="66" rx="18" ry="5" fill="#e2e8f0" />
                <rect x="14" y="18" width="36" height="40" rx="10" fill="#f1f5f9" stroke="#94a3b8" stroke-width="2" />
                <circle cx="26" cy="36" r="4" fill="#446271" />
                <circle cx="38" cy="36" r="4" fill="#446271" />
                <path d="M26 48h12" stroke="#446271" stroke-width="2" stroke-linecap="round" />
                <rect x="24" y="8" width="16" height="12" rx="3" fill="#cbd5e1" stroke="#94a3b8" stroke-width="1.5" />
              </svg>
            </div>
            <p class="assign-empty__title">BiteBud is still learning.</p>
            <p class="assign-empty__text">{{ cookingDoesntWorkEmptyMessage }}</p>
          </div>
        </section>

        <!-- Dining -->
        <section class="assign-cat assign-cat--dine" aria-labelledby="assign-dine-title">
          <div class="assign-cat__head">
            <span class="assign-cat__icon assign-cat__icon--dine" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="12" cy="19" rx="7" ry="1.25" stroke="currentColor" stroke-width="1.5" />
                <path
                  d="M6 10c0-3 2.5-5.5 6-5.5S18 7 18 10v6.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 16.5V10Z"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linejoin="round"
                />
                <path d="M8 9V7.5a4 4 0 0 1 8 0V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
              </svg>
            </span>
            <div class="assign-cat__head-main">
              <h2 id="assign-dine-title" class="assign-cat__title">Dining</h2>
              <p class="assign-cat__meta">{{ diningInsightCardTotal }} patterns</p>
            </div>
          </div>

          <div class="assign-rule" role="presentation">
            <span class="assign-rule__line" aria-hidden="true" />
            <span class="assign-rule__text">What works well for you</span>
            <span class="assign-rule__line" aria-hidden="true" />
          </div>
          <div v-if="data.thresholds.dining.have < data.thresholds.dining.need" class="assign-guidance">
            After {{ data.thresholds.dining.need - data.thresholds.dining.have }}
            {{ data.thresholds.dining.need - data.thresholds.dining.have === 1 ? 'more restaurant review' : 'more restaurant reviews' }},
            I can show you which places tend to suit you best.
          </div>
          <p v-else-if="diningWorksEmptyMessage" class="assign-guidance" role="status">{{ diningWorksEmptyMessage }}</p>
          <div v-else class="assign-card-list">
            <article v-for="c in data.dining.works" :key="c.id" class="assign-card">
              <div
                class="assign-card__ring assign-card__ring--dine"
                aria-hidden="true"
                :style="{ '--ring-pct': String(ringStrokePct(c.recordCount, diningWorksRingMax())) }"
              >
                <span class="assign-card__ring-n">{{ c.recordCount }}</span>
              </div>
              <div class="assign-card__main">
                <h4 class="assign-card__slug">{{ insightShortTitle(c) }}</h4>
                <p class="assign-card__detail">{{ c.detail || c.headline }}</p>
                <span class="assign-chip assign-chip--dine-ok">
                  <svg class="assign-chip__tick" viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
                    <path
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.75"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M2.5 6l2.5 2.5L9.5 3.5"
                    />
                  </svg>
                  Pattern found
                </span>
              </div>
            </article>
          </div>

          <div class="assign-rule" role="presentation">
            <span class="assign-rule__line" aria-hidden="true" />
            <span class="assign-rule__text">What doesn't seem to work</span>
            <span class="assign-rule__line" aria-hidden="true" />
          </div>
          <div class="assign-empty assign-empty--dine">
            <div class="assign-empty__mascot" aria-hidden="true">
              <svg viewBox="0 0 64 72" width="56" height="63" class="assign-empty__robot">
                <ellipse cx="32" cy="66" rx="18" ry="5" fill="#e2e8f0" />
                <rect x="14" y="18" width="36" height="40" rx="10" fill="#f1f5f9" stroke="#94a3b8" stroke-width="2" />
                <circle cx="26" cy="36" r="4" fill="#446271" />
                <circle cx="38" cy="36" r="4" fill="#446271" />
                <path d="M26 48h12" stroke="#446271" stroke-width="2" stroke-linecap="round" />
                <rect x="24" y="8" width="16" height="12" rx="3" fill="#cbd5e1" stroke="#94a3b8" stroke-width="1.5" />
              </svg>
            </div>
            <p class="assign-empty__title">BiteBud is still learning.</p>
            <p class="assign-empty__text">
              Rate more dining experiences — patterns will appear here as you complete more reviews.
            </p>
          </div>
        </section>

        <div class="assign-export">
          <button v-if="canExport" type="button" class="assign-export-btn" :disabled="exporting" @click="exportPdf">
            {{ exporting ? 'Preparing PDF…' : 'Export as PDF' }}
          </button>
          <p v-else class="assign-export-hint">Log a bit more activity to enable PDF export.</p>
        </div>
      </div>

      <section v-if="pdfVisible && data" ref="pdfEl" class="pdf-export" aria-hidden="true">
        <div class="pdf-page">
          <header class="pdf-cover">
            <div class="pdf-h1">BiteBud — My Insights</div>
            <div class="pdf-subhead">Personal food and dining patterns</div>
            <div class="pdf-meta">
              <div><strong>Date range:</strong> {{ isoToPretty(data.range.from) }} to {{ isoToPretty(data.range.to) }}</div>
              <div><strong>Generated on:</strong> {{ isoToday() }}</div>
            </div>
          </header>

          <section class="pdf-block">
            <div class="pdf-h2">Summary</div>
            <div class="pdf-kv">
              <div>Recipes completed in this period: <strong>{{ activitySummary().recipes }}</strong></div>
              <div>Restaurant reviews in this period: <strong>{{ activitySummary().reviews }}</strong></div>
              <div>Days with any activity: <strong>{{ activitySummary().daysAny }}</strong></div>
              <div v-if="mostActiveDow()">Most active day of week: <strong>{{ mostActiveDow() }}</strong></div>
            </div>
          </section>

          <footer class="pdf-note">
            Generated from your own activity. Not shared with anyone unless you choose to share this file.
          </footer>
        </div>

        <div class="pdf-page">
          <div class="pdf-h2">My Progress</div>
          <section class="pdf-progress">
            <div class="pdf-calendar">
              <div class="pdf-label">Calendar</div>
              <div class="pdf-months">
                <section v-for="m in monthGrids" :key="`pdf-${m.monthKey}`" class="pdf-month">
                  <div class="pdf-month-title">{{ m.label }}</div>
                  <div class="pdf-dow">
                    <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
                  </div>
                  <div class="pdf-grid">
                    <div
                      v-for="d in m.days"
                      :key="`pdf-${m.monthKey}-${d.date}`"
                      class="pdf-cell"
                      :class="[{ 'pdf-cell--out': !d.inMonth }, d.total > 0 ? 'pdf-cell--active' : 'pdf-cell--idle']"
                    />
                  </div>
                </section>
              </div>
            </div>

            <div class="pdf-weekly">
              <div class="pdf-label">Weekly activity</div>
              <div class="pdf-bars">
                <div v-for="w in data.progress.weeklyBars" :key="`pdfw-${w.weekStart}`" class="pdf-bar">
                  <div class="pdf-bar-label">{{ w.weekStart }}</div>
                  <div class="pdf-bar-track">
                    <div class="pdf-bar-seg pdf-bar-seg--recipes" :style="{ width: `${Math.min(100, w.recipes * 18)}%` }" />
                    <div class="pdf-bar-seg pdf-bar-seg--dining" :style="{ width: `${Math.min(100, w.dining * 18)}%` }" />
                  </div>
                </div>
              </div>
            </div>

            <div class="pdf-breakdown">
              <div class="pdf-label">Type breakdown</div>
              <div class="pdf-kv">
                <div>Cooked recipes: <strong>{{ data.progress.typeBreakdown.recipes }}</strong></div>
                <div>Dined out: <strong>{{ data.progress.typeBreakdown.dining }}</strong></div>
              </div>
            </div>
          </section>
        </div>

        <div class="pdf-page">
          <div class="pdf-h2">Cooking</div>

          <section class="pdf-section">
            <div class="pdf-h3">What works well for you</div>
            <div v-if="data.thresholds.cooking.have < data.thresholds.cooking.need" class="pdf-guidance">
              After {{ data.thresholds.cooking.need - data.thresholds.cooking.have }}
              {{ data.thresholds.cooking.need - data.thresholds.cooking.have === 1 ? 'more rated recipe' : 'more rated recipes' }},
              I can show you what your favourites have in common.
            </div>
            <div v-else class="pdf-cards">
              <article v-for="c in data.cooking.works" :key="`pdfcw-${c.id}`" class="pdf-card">
                <div class="pdf-card-h">{{ c.headline }}</div>
                <div class="pdf-card-d">{{ c.detail }}</div>
              </article>
            </div>
          </section>

          <section class="pdf-section">
            <div class="pdf-h3">What doesn't seem to work</div>
            <div v-if="data.thresholds.cooking.have < data.thresholds.cooking.need" class="pdf-guidance">
              After {{ data.thresholds.cooking.need - data.thresholds.cooking.have }}
              {{ data.thresholds.cooking.need - data.thresholds.cooking.have === 1 ? 'more rated recipe' : 'more rated recipes' }},
              I can show you what your favourites have in common.
            </div>
            <div v-else class="pdf-cards">
              <article v-for="c in data.cooking.doesntWork" :key="`pdfcd-${c.id}`" class="pdf-card">
                <div class="pdf-card-h">{{ c.headline }}</div>
                <div class="pdf-card-d">{{ c.detail }}</div>
              </article>
            </div>
          </section>
        </div>

        <div class="pdf-page">
          <div class="pdf-h2">Dining</div>

          <section class="pdf-section">
            <div class="pdf-h3">What works well for you when you dine out</div>
            <div v-if="data.thresholds.dining.have < data.thresholds.dining.need" class="pdf-guidance">
              After {{ data.thresholds.dining.need - data.thresholds.dining.have }}
              {{ data.thresholds.dining.need - data.thresholds.dining.have === 1 ? 'more restaurant review' : 'more restaurant reviews' }},
              I can show you which places tend to suit you best.
            </div>
            <div v-else class="pdf-cards">
              <article v-for="c in data.dining.works" :key="`pdfdw-${c.id}`" class="pdf-card">
                <div class="pdf-card-h">{{ c.headline }}</div>
                <div class="pdf-card-d">{{ c.detail }}</div>
              </article>
            </div>
          </section>
        </div>

        <div class="pdf-page">
          <section class="pdf-about">
            <div class="pdf-h2">About this report</div>
            <p>
              BiteBud is a tool for finding and preparing food in a calm, sensory-aware way. The patterns above are drawn only from this user's own
              recorded activity over the selected date range. They are observations, not medical advice or a clinical assessment. Share this report
              with anyone you choose — your data stays on your device unless you do.
            </p>
          </section>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.page-back {
  margin: 0 0 0.75rem;
}
.page-back-link {
  font-weight: 700;
  font-size: 0.95rem;
  color: var(--bb-accent);
  text-decoration: none;
}
.page-back-link:hover {
  text-decoration: underline;
}
.page {
  --assign-navy: #1a2d42;
  --assign-cook-icon: #f4a24c;
  --assign-dine-icon: #5a9ec4;
  --assign-green: #1f8a4a;

  max-width: 26rem;
  margin: 0 auto;
  padding: 1.1rem 0.85rem 2.5rem;
  min-height: 60vh;
  background: color-mix(in srgb, #f7f4ef 94%, var(--bb-bg));
  color: var(--bb-text);
}

.assign-head {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.75rem;
  margin-bottom: 0.65rem;
}
.assign-head__brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.45rem;
}
.assign-head__h1 {
  margin: 0;
  font-family: var(--bb-font-headline);
  font-size: clamp(1.38rem, 4.2vw, 1.58rem);
  font-weight: 800;
  letter-spacing: -0.03em;
  color: var(--assign-navy);
}
.assign-head__lede {
  margin: 0;
  max-width: 20rem;
  font-size: 0.88rem;
  color: var(--bb-muted);
  line-height: 1.45;
}
.assign-privacy-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  background: color-mix(in srgb, var(--assign-green) 12%, #fff);
  color: var(--assign-green);
  border: 1px solid color-mix(in srgb, var(--assign-green) 35%, transparent);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  padding: 0.32rem 0.65rem;
  border-radius: 999px;
}
.assign-privacy-pill__lock {
  flex-shrink: 0;
  opacity: 0.95;
}

.assign-skel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.25rem 0 0.5rem;
}
.sk {
  border-radius: 14px;
  background: linear-gradient(90deg, #ebe6de 0%, #f5f1ea 50%, #ebe6de 100%);
  background-size: 200% 100%;
  animation: ins-skel 1.1s ease-in-out infinite;
}
.sk-sum {
  height: 4.25rem;
}
.sk-panel {
  height: 7.5rem;
}
.sk-panel--short {
  height: 4.5rem;
  max-width: 88%;
}
@media (prefers-reduced-motion: reduce) {
  .sk {
    animation: none;
  }
}
@keyframes ins-skel {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}

.assign-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.assign-period {
  margin: -0.15rem 0 0;
  text-align: center;
  font-size: 0.76rem;
  color: var(--bb-muted);
}

.assign-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: stretch;
  gap: 0;
  padding: 1rem 0.35rem;
  border-radius: 16px;
  background: var(--assign-navy);
  color: #f8fafc;
  text-align: center;
  box-shadow: 0 10px 26px rgba(26, 45, 66, 0.22);
}
.assign-summary__item {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 0 0.35rem;
}
.assign-summary__item:not(:last-child) {
  border-right: 1px solid rgba(255, 255, 255, 0.18);
}
.assign-summary__num {
  display: block;
  font-size: 1.45rem;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  line-height: 1.05;
  color: #fff;
}
.assign-summary__lbl {
  display: block;
  margin-top: 0.32rem;
  font-size: 0.56rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  line-height: 1.25;
  color: #b8d9f0;
}

.assign-cat {
  background: #fffefb;
  border-radius: 18px;
  padding: 0.95rem 0.8rem 1rem;
  box-shadow: 0 4px 18px rgba(30, 25, 20, 0.06);
  border: 1px solid #e8e2d8;
}
.assign-cat__head {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  margin-bottom: 0.55rem;
}
.assign-cat__head-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}
.assign-cat__icon {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 50%;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.assign-cat__icon--cook {
  background: linear-gradient(160deg, #ffd8a8, var(--assign-cook-icon));
  color: #5c2e0a;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45);
}
.assign-cat__icon--dine {
  background: linear-gradient(160deg, #b8daf0, var(--assign-dine-icon));
  color: #0f3550;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4);
}
.assign-cat__title {
  margin: 0;
  font-family: var(--bb-font-headline);
  font-size: 1.18rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--assign-navy);
}
.assign-cat__meta {
  margin: 0;
  flex-shrink: 0;
  font-size: 0.74rem;
  font-weight: 600;
  color: #6eb8e8;
  letter-spacing: 0.01em;
}

.assign-rule {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin: 0.5rem 0 0.55rem;
  width: 100%;
}
.assign-rule__line {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, transparent, #c9c2b6 18%, #c9c2b6 82%, transparent);
  min-width: 0;
}
.assign-rule__text {
  flex-shrink: 0;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #8a8278;
  text-align: center;
  max-width: 11rem;
  line-height: 1.25;
}
.assign-guidance {
  margin: 0 0 0.35rem;
  padding: 0.7rem 0.75rem;
  border-radius: 12px;
  border: 1px solid var(--bb-border);
  background: color-mix(in srgb, var(--bb-surface-low) 90%, transparent);
  font-size: 0.84rem;
  line-height: 1.45;
  color: color-mix(in srgb, var(--bb-text) 85%, var(--bb-muted));
}

.assign-card-list {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.assign-card {
  display: flex;
  gap: 0.7rem;
  align-items: flex-start;
  padding: 0.78rem 0.65rem;
  border-radius: 14px;
  border: 1px solid #ece6de;
  background: #fff;
  box-shadow: 0 2px 10px rgba(30, 25, 20, 0.06);
}
.assign-card__ring {
  --ring-pct: 50;
  --ring-accent: #2d9d5f;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  position: relative;
  background: conic-gradient(from 0.12turn, var(--ring-accent) calc(var(--ring-pct) * 1%), #e4e9ec 0);
}
.assign-card__ring::before {
  content: '';
  position: absolute;
  inset: 5px;
  border-radius: 50%;
  background: #fff;
}
.assign-card__ring-n {
  position: relative;
  z-index: 1;
  font-weight: 900;
  font-size: 0.92rem;
  font-variant-numeric: tabular-nums;
  color: var(--bb-text);
}
.assign-card__ring--cook {
  --ring-accent: #2a9d5f;
}
.assign-card__ring--cook-warn {
  --ring-accent: #e0902a;
}
.assign-card__ring--dine {
  --ring-accent: #3d7ab8;
}

.assign-card__main {
  min-width: 0;
  flex: 1;
}
.assign-card__slug {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 800;
  letter-spacing: 0.01em;
  color: var(--assign-navy);
}
.assign-card__detail {
  margin: 0.28rem 0 0.42rem;
  font-size: 0.78rem;
  line-height: 1.45;
  color: var(--bb-muted);
}
.assign-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  font-size: 0.58rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 0.2rem 0.45rem 0.2rem 0.38rem;
  border-radius: 999px;
}
.assign-chip__tick {
  flex-shrink: 0;
}
.assign-chip--cook-ok {
  background: color-mix(in srgb, var(--assign-green) 14%, #fff);
  color: #14532d;
  border: 1px solid color-mix(in srgb, var(--assign-green) 32%, transparent);
}
.assign-chip--cook-warn {
  background: color-mix(in srgb, #e0902a 16%, #fff);
  color: #7c2d12;
  border: 1px solid color-mix(in srgb, #e0902a 35%, transparent);
}
.assign-chip--dine-ok {
  background: color-mix(in srgb, var(--assign-green) 14%, #fff);
  color: #14532d;
  border: 1px solid color-mix(in srgb, var(--assign-green) 32%, transparent);
}

.assign-empty {
  border: 2px dashed #d8d0c4;
  border-radius: 16px;
  padding: 1.1rem 0.75rem;
  text-align: center;
  background: #fdfcfa;
}
.assign-empty__mascot {
  display: flex;
  justify-content: center;
}
.assign-empty__title {
  margin: 0.4rem 0 0;
  font-weight: 800;
  font-size: 0.92rem;
}
.assign-empty__text {
  margin: 0.35rem 0 0;
  font-size: 0.8rem;
  color: var(--bb-muted);
  line-height: 1.45;
}

.assign-export {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.15rem;
}
.assign-export-btn {
  padding: 0.55rem 1.2rem;
  border-radius: 999px;
  border: 1px solid var(--bb-border);
  background: var(--bb-surface-lowest);
  font: inherit;
  font-weight: 700;
  font-size: 0.88rem;
  color: var(--bb-text);
  cursor: pointer;
}
.assign-export-btn:hover:not(:disabled) {
  background: var(--bb-surface-low);
}
.assign-export-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.assign-export-hint {
  margin: 0;
  text-align: center;
  font-size: 0.8rem;
  color: var(--bb-muted);
  max-width: 20rem;
  line-height: 1.4;
}

@media (max-width: 380px) {
  .assign-summary__num {
    font-size: 1.2rem;
  }
  .assign-summary__lbl {
    font-size: 0.5rem;
  }
  .assign-rule__text {
    font-size: 0.55rem;
    letter-spacing: 0.06em;
  }
}

.sr-only {
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

.insights-error {
  border: 1px solid color-mix(in srgb, #b42318 35%, var(--bb-border));
  background: color-mix(in srgb, #b42318 8%, var(--bb-surface-low));
  border-radius: 16px;
  padding: 1rem 1.15rem;
  text-align: center;
}
.insights-error__text {
  margin: 0;
  color: #b42318;
  font-weight: 600;
  line-height: 1.45;
}

.pdf-export {
  position: absolute;
  left: 0;
  top: 0;
  width: 794px;
  max-width: 794px;
  box-sizing: border-box;
  height: auto;
  min-height: max-content;
  overflow: visible;
  display: block;
  color: #111;
  background: #fff;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  opacity: 0.01;
  pointer-events: none;
  z-index: 0;
}
.pdf-page {
  padding: 18mm;
  min-height: 297mm;
  box-sizing: border-box;
  page-break-after: always;
}
.pdf-page:last-child {
  page-break-after: auto;
}
.pdf-h1 {
  font-family: var(--bb-font-headline);
  font-weight: 900;
  font-size: 22px;
}
.pdf-subhead {
  margin-top: 6px;
  font-size: 14px;
  color: #374151;
}
.pdf-meta {
  margin-top: 10px;
  font-size: 12.5px;
  color: #111;
  display: grid;
  gap: 4px;
}
.pdf-h2 {
  font-family: var(--bb-font-headline);
  font-weight: 900;
  font-size: 16px;
  margin-bottom: 8px;
}
.pdf-h3 {
  font-family: var(--bb-font-headline);
  font-weight: 900;
  font-size: 13.5px;
  margin: 12px 0 8px;
}
.pdf-block {
  margin-top: 16px;
  border-top: 1px solid #e5e7eb;
  padding-top: 12px;
}
.pdf-kv {
  display: grid;
  gap: 6px;
  font-size: 12.5px;
}
.pdf-note {
  margin-top: 18px;
  font-size: 12px;
  color: #374151;
  border-top: 1px solid #e5e7eb;
  padding-top: 10px;
}
.pdf-progress {
  display: grid;
  gap: 12px;
}
.pdf-label {
  font-weight: 900;
  font-size: 12px;
  margin-bottom: 6px;
}
.pdf-months {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.pdf-month-title {
  font-weight: 900;
  font-size: 12px;
  margin-bottom: 4px;
}
.pdf-dow {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 3px;
  font-size: 9.5px;
  color: #6b7280;
  margin-bottom: 4px;
}
.pdf-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 3px;
}
.pdf-cell {
  aspect-ratio: 1 / 1;
  border-radius: 6px;
  border: 1px solid #d1d5db;
  background: transparent;
}
.pdf-cell--out {
  opacity: 0.35;
}
.pdf-cell--idle {
  background: transparent;
}
.pdf-cell--active {
  background: #d9e8f0;
  border-color: #9eb8c8;
}
.pdf-bars {
  display: grid;
  gap: 6px;
}
.pdf-bar {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 8px;
  align-items: center;
}
.pdf-bar-label {
  font-size: 11px;
  color: #374151;
  font-variant-numeric: tabular-nums;
}
.pdf-bar-track {
  height: 10px;
  border-radius: 999px;
  background: rgba(17, 24, 39, 0.08);
  overflow: hidden;
  display: flex;
}
.pdf-bar-seg {
  height: 100%;
}
.pdf-bar-seg--recipes {
  background: rgba(17, 24, 39, 0.22);
}
.pdf-bar-seg--dining {
  background: rgba(17, 24, 39, 0.14);
}
.pdf-section {
  margin-top: 10px;
}
.pdf-guidance {
  font-size: 12.5px;
  color: #374151;
  border: 1px solid #e5e7eb;
  padding: 10px;
}
.pdf-cards {
  display: grid;
  gap: 10px;
}
.pdf-card {
  break-inside: avoid;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 10px;
  background: rgba(17, 24, 39, 0.03);
}
.pdf-card-h {
  font-weight: 900;
  font-size: 12.5px;
}
.pdf-card-d {
  margin-top: 6px;
  font-size: 12px;
  color: #374151;
  line-height: 1.4;
}
.pdf-about p {
  margin: 8px 0 0;
  font-size: 12.5px;
  color: #374151;
  line-height: 1.5;
}
</style>

