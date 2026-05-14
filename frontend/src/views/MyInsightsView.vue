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
  return "Let's keep cooking — BiteBud is still learning what tends not to work for you."
})

const diningWorksEmptyMessage = computed(() => {
  if (!data.value || !diningWorksUnlocked.value || data.value.dining.works.length > 0) return ''
  return "Let's keep dining out — BiteBud is still learning what tends to suit you."
})

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
    <header class="head">
      <h1 class="h1">My Insights</h1>
      <p class="lede">A quiet mirror of your own patterns. Nothing here is shared.</p>
    </header>

    <p v-if="loading" class="hint">Loading…</p>
    <p v-else-if="error" class="error" role="status">{{ error }}</p>

    <template v-else-if="data">
      <section class="section">
        <h2>Cooking</h2>

        <h3>What works well for you</h3>
        <div v-if="data.thresholds.cooking.have < data.thresholds.cooking.need" class="guidance">
          After {{ data.thresholds.cooking.need - data.thresholds.cooking.have }}
          {{ data.thresholds.cooking.need - data.thresholds.cooking.have === 1 ? 'more rated recipe' : 'more rated recipes' }},
          I can show you what your favourites have in common.
        </div>
        <p v-else-if="cookingWorksEmptyMessage" class="guidance" role="status">{{ cookingWorksEmptyMessage }}</p>
        <div v-else class="cards">
          <article v-for="c in data.cooking.works" :key="c.id" class="card">
            <div class="headline">{{ c.headline }}</div>
            <p class="detail">{{ c.detail }}</p>
          </article>
        </div>

        <h3>What doesn't seem to work</h3>
        <div v-if="data.thresholds.cooking.have < data.thresholds.cooking.need" class="guidance">
          After {{ data.thresholds.cooking.need - data.thresholds.cooking.have }}
          {{ data.thresholds.cooking.need - data.thresholds.cooking.have === 1 ? 'more rated recipe' : 'more rated recipes' }},
          I can show you what your favourites have in common.
        </div>
        <p v-else-if="cookingDoesntWorkEmptyMessage" class="guidance" role="status">{{ cookingDoesntWorkEmptyMessage }}</p>
        <div v-else class="cards">
          <article v-for="c in data.cooking.doesntWork" :key="c.id" class="card">
            <div class="headline">{{ c.headline }}</div>
            <p class="detail">{{ c.detail }}</p>
          </article>
        </div>
      </section>

      <section class="section">
        <h2>Dining</h2>
        <h3>What works well for you</h3>

        <div v-if="data.thresholds.dining.have < data.thresholds.dining.need" class="guidance">
          After {{ data.thresholds.dining.need - data.thresholds.dining.have }}
          {{ data.thresholds.dining.need - data.thresholds.dining.have === 1 ? 'more restaurant review' : 'more restaurant reviews' }},
          I can show you which places tend to suit you best.
        </div>
        <p v-else-if="diningWorksEmptyMessage" class="guidance" role="status">{{ diningWorksEmptyMessage }}</p>
        <div v-else class="cards">
          <article v-for="c in data.dining.works" :key="c.id" class="card">
            <div class="headline">{{ c.headline }}</div>
            <p class="detail">{{ c.detail }}</p>
          </article>
        </div>
      </section>

      <div class="export">
        <button v-if="canExport" type="button" class="bb-btn bb-btn--secondary" :disabled="exporting" @click="exportPdf">
          {{ exporting ? 'Preparing PDF…' : 'Export as PDF' }}
        </button>
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
  max-width: 28rem;
  margin: 0 auto;
  padding: 2rem 1.25rem 3rem;
  min-height: 60vh;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 1.25rem;
  color: var(--bb-text);
}
.head {
  text-align: center;
  margin-bottom: 0.5rem;
}
.h1 {
  margin: 0 0 0.65rem;
  font-family: var(--bb-font-headline);
  font-weight: 800;
  font-size: clamp(1.55rem, 4vw, 2rem);
  letter-spacing: -0.03em;
  color: var(--bb-primary);
}
.lede {
  margin: 0;
  color: var(--bb-muted);
  font-size: 1rem;
  line-height: 1.55;
}
.hint {
  margin: 0;
  color: var(--bb-muted);
  text-align: center;
  font-size: 0.95rem;
}
.error {
  margin: 0;
  color: #b42318;
  text-align: center;
}

.section h2 {
  margin: 0 0 0.5rem;
  font-family: var(--bb-font-headline);
  font-size: 1.3rem;
  color: var(--bb-primary);
}
.section h3 {
  margin: 0.85rem 0 0.45rem;
  font-size: 1.05rem;
  font-family: var(--bb-font-headline);
  color: var(--bb-text);
}

.guidance {
  border: 1px solid var(--bb-border);
  background: var(--bb-surface-low);
  border-radius: 14px;
  padding: 0.8rem 0.9rem;
  color: color-mix(in srgb, var(--bb-text) 82%, var(--bb-muted));
  line-height: 1.5;
}

.cards {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.card {
  border: 1px solid var(--bb-border);
  background: var(--bb-surface-low);
  border-radius: 16px;
  padding: 1rem 1.15rem;
  display: grid;
  gap: 0.5rem;
}
.headline {
  font-family: var(--bb-font-headline);
  font-weight: 800;
  line-height: 1.3;
  color: var(--bb-text);
}
.detail {
  margin: 0;
  color: var(--bb-muted);
  line-height: 1.55;
  font-size: 0.95rem;
}

.export {
  margin-top: 0.5rem;
  display: flex;
  justify-content: center;
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

