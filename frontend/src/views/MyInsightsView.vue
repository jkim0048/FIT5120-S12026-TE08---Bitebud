<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { jsPDF } from 'jspdf'
import { useRouter } from 'vue-router'
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
const openWhy = ref<Record<string, boolean>>({})
const exporting = ref(false)
const pdfVisible = ref(false)
const pdfEl = ref<HTMLElement | null>(null)
const rangeMsg = ref('')
const rangeInvalid = computed(() => rangeMsg.value.trim().length > 0)

const customFromInput = ref('')
const customToInput = ref('')
let debounceTimer: number | null = null
const monthPage = ref(0)

function monthPageSize(): number {
  // Keep this calm and compact for 12m; show 4 months per page on wide screens, 3 on narrow.
  if (insightsRange.preset.value !== '12m') return 4
  return window.matchMedia?.('(max-width: 900px)')?.matches ? 3 : 4
}

const visibleMonthGrids = computed(() => {
  const all = monthGrids.value
  const size = monthPageSize()
  const start = monthPage.value * size
  return all.slice(start, start + size)
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

function storageKey(uid: string) {
  return `bb.dismissedInsights.${uid}`
}

function readDismissed(uid: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(uid))
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeDismissed(uid: string, ids: string[]) {
  localStorage.setItem(storageKey(uid), JSON.stringify(Array.from(new Set(ids))))
}

const dismissedIds = computed(() => {
  if (!isSignedIn.value || !userId.value) return []
  return readDismissed(userId.value)
})

function dismissCard(id: string) {
  const uid = userId.value
  if (!uid) return
  const next = [...dismissedIds.value, id]
  writeDismissed(uid, next)
  if (data.value) {
    data.value = {
      ...data.value,
      cooking: {
        works: data.value.cooking.works.filter((c) => c.id !== id),
        doesntWork: data.value.cooking.doesntWork.filter((c) => c.id !== id),
      },
      dining: { works: data.value.dining.works.filter((c) => c.id !== id) },
    }
  }
}

function toggleWhy(id: string) {
  openWhy.value = { ...openWhy.value, [id]: !openWhy.value[id] }
}

function recordLabel(section: 'cooking' | 'dining', n: number) {
  if (section === 'cooking') return n === 1 ? 'based on 1 recipe' : `based on ${n} recipes`
  return n === 1 ? 'based on 1 review' : `based on ${n} reviews`
}

function isoToPretty(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return iso
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
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
    insightsRange.setCustom(new Date(`${customFromInput.value}T00:00:00.000Z`), new Date(`${customToInput.value}T00:00:00.000Z`))
  }, 250)
}

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

const COOKING_GAUGE_MAX = 7
const DINING_GAUGE_MAX = 7
const GAUGE_ARC_LENGTH_PERCENT = 100

/** Returns the Monday (local) of the week containing the given JS Date. */
function startOfWeekMondayLocal(now: Date): Date {
  const out = new Date(now)
  out.setHours(0, 0, 0, 0)
  const day = out.getDay() // Sun=0
  const diff = (day + 6) % 7 // Mon=0
  out.setDate(out.getDate() - diff)
  return out
}

const thisWeekStats = computed(() => {
  const d = data.value
  // Prefer server-computed values (Melbourne Monday boundary).
  if (d?.thisWeek) {
    return {
      cookingDays: Math.max(0, Math.round(d.thisWeek.cookingDays ?? 0)),
      diningReviews: Math.max(0, Math.round(d.thisWeek.diningReviews ?? 0)),
      weekStart: d.thisWeek.weekStart ?? null,
    }
  }
  // Fallback: derive from the calendar in the current response (browser-local Monday).
  if (!d) return { cookingDays: 0, diningReviews: 0, weekStart: null as string | null }
  const mondayLocal = startOfWeekMondayLocal(new Date())
  const yyyy = mondayLocal.getFullYear()
  const mm = String(mondayLocal.getMonth() + 1).padStart(2, '0')
  const dd = String(mondayLocal.getDate()).padStart(2, '0')
  const mondayIso = `${yyyy}-${mm}-${dd}`
  let cookingDays = 0
  let diningReviews = 0
  for (const row of d.progress.calendar ?? []) {
    if (row.date < mondayIso) continue
    if ((row.recipes ?? 0) > 0) cookingDays += 1
    diningReviews += row.dining ?? 0
  }
  return { cookingDays, diningReviews, weekStart: mondayIso }
})

function clampGaugeValue(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.max(0, Math.round(value))
}

function gaugePercent(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0 || max <= 0) return 0
  return Math.min(GAUGE_ARC_LENGTH_PERCENT, (value / max) * GAUGE_ARC_LENGTH_PERCENT)
}

const cookingThisWeek = computed(() => clampGaugeValue(thisWeekStats.value.cookingDays))
const diningThisWeek = computed(() => clampGaugeValue(thisWeekStats.value.diningReviews))

const cookingGaugePercent = computed(() => gaugePercent(cookingThisWeek.value, COOKING_GAUGE_MAX))
const diningGaugePercent = computed(() => gaugePercent(diningThisWeek.value, DINING_GAUGE_MAX))

const cookingThisWeekDisplay = computed(() => String(cookingThisWeek.value))
const diningThisWeekDisplay = computed(() => String(diningThisWeek.value))

const cookingUnitLabel = computed(() => (cookingThisWeek.value === 1 ? 'day' : 'days'))
const diningUnitLabel = computed(() => (diningThisWeek.value === 1 ? 'review' : 'reviews'))

const weekStartPretty = computed(() => {
  const iso = thisWeekStats.value.weekStart
  if (!iso) return ''
  return isoToPretty(iso)
})

const dowFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' })
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
    const dismissed = dismissedIds.value
    const base = `/api/me/insights`
    const params = new URLSearchParams()
    params.set('from', toIso(insightsRange.from.value))
    params.set('to', toIso(insightsRange.to.value))
    if (dismissed.length) params.set('dismissed', dismissed.join(','))
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
    m.set(row.date, { recipes: row.recipes ?? 0, reviews: row.dining ?? 0 })
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
      const withinRange = iso >= data.value.range.from && iso <= data.value.range.to
      const counts = withinRange ? calendarMap.value.get(iso) : null
      const recipes = counts?.recipes ?? 0
      const reviews = counts?.reviews ?? 0
      days.push({
        date: iso,
        inMonth: inMonth && withinRange,
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
      const n = d.thresholds.progress.need - d.thresholds.progress.have
      const w = n === 1 ? 'more activity' : 'more activities'
      bodyParagraph(`After ${n} ${w}, your progress view will fill in.`)
      y += 1
    } else {
      for (const m of monthGrids.value) {
        subHeading(`Calendar: ${m.label}`)
        writeRawLines(['Mon Tue Wed Thu Fri Sat Sun'], mL, 9, 'bold', 3)
        for (let i = 0; i < m.days.length; i += 7) {
          const week = m.days.slice(i, i + 7)
          bodyLine(week.map(fmtCalCell).join('  '))
        }
        y += 2
      }

      subHeading('Weekly activity')
      const bars = d.progress.weeklyBars ?? []
      const maxTot = Math.max(1, ...bars.map((w) => w.recipes + w.dining))
      const labelW = 32
      const barH = 4
      const barMaxW = cw - labelW - 2
      for (const w of bars) {
        ensure(barH + 4)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        doc.setTextColor(0, 0, 0)
        doc.text(w.weekStart, mL, y, { baseline: 'top' })
        const tot = w.recipes + w.dining
        const bw = (tot / maxTot) * barMaxW
        doc.setFillColor(210, 210, 210)
        doc.rect(mL + labelW, y, bw, barH, 'F')
        y += barH + 2
      }

      y += 1
      subHeading('Type breakdown')
      bodyLine(`Recipes: ${d.progress.typeBreakdown.recipes}`)
      bodyLine(`Dining: ${d.progress.typeBreakdown.dining}`)
      y += 1
    }
    drawHR()

    // — Cooking
    sectionHeading('Cooking')
    subHeading('What works well for you')
    if (d.thresholds.cooking.have < d.thresholds.cooking.need) {
      const n = d.thresholds.cooking.need - d.thresholds.cooking.have
      const w = n === 1 ? 'more rated recipe' : 'more rated recipes'
      bodyParagraph(`After ${n} ${w}, I can show you what your favourites have in common.`)
    } else {
      for (const c of d.cooking.works) writeCookingBullet(c)
    }
    y += 1
    subHeading("What doesn't seem to work")
    if (d.thresholds.cooking.have < d.thresholds.cooking.need) {
      const n = d.thresholds.cooking.need - d.thresholds.cooking.have
      const w = n === 1 ? 'more rated recipe' : 'more rated recipes'
      bodyParagraph(`After ${n} ${w}, I can show you what your favourites have in common.`)
    } else if (d.cooking.doesntWork.length === 0) {
      bodyLine('None recorded.')
    } else {
      for (const c of d.cooking.doesntWork) writeCookingBullet(c)
    }
    y += 1
    drawHR()

    // — Dining
    sectionHeading('Dining')
    subHeading('What works well for you when you dine out')
    if (d.thresholds.dining.have < d.thresholds.dining.need) {
      const n = d.thresholds.dining.need - d.thresholds.dining.have
      const w = n === 1 ? 'more restaurant review' : 'more restaurant reviews'
      bodyParagraph(`After ${n} ${w}, I can show you which places tend to suit you best.`)
    } else {
      for (const c of d.dining.works) writeDiningBullet(c)
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
    <header class="header">
      <h1>My Insights</h1>
      <p class="subhead">A quiet mirror of your own patterns. Nothing here is shared.</p>
    </header>

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
        <h2>My Progress</h2>

        <div v-if="data.thresholds.progress.have < data.thresholds.progress.need" class="guidance">
          After {{ data.thresholds.progress.need - data.thresholds.progress.have }}
          {{ data.thresholds.progress.need - data.thresholds.progress.have === 1 ? 'more activity' : 'more activities' }},
          your progress view will fill in.
        </div>
        <div v-else class="progress-grid">
          <div class="calendar">
            <div class="calendar-title">{{ isoToPretty(data.range.from) }} to {{ isoToPretty(data.range.to) }}</div>
            <p class="calendar-hint">Hover over any day to see details.</p>
            <div class="months">
              <section v-for="m in visibleMonthGrids" :key="m.monthKey" class="month">
                <div class="month-title">{{ m.label }}</div>
                <div class="dow" aria-hidden="true">
                  <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
                </div>
                <div class="grid" :aria-label="`Calendar: ${m.label}`">
                  <button
                    v-for="d in m.days"
                    :key="`${m.monthKey}-${d.date}`"
                    type="button"
                    class="cell"
                    :class="[{ 'cell--out': !d.inMonth }, d.total === 0 ? 'cell--0' : d.total === 1 ? 'cell--1' : d.total === 2 ? 'cell--2' : d.total === 3 ? 'cell--3' : 'cell--4']"
                    :data-tip="calendarCellTooltip(d.date, d.recipes, d.reviews)"
                    :aria-label="calendarCellTooltip(d.date, d.recipes, d.reviews)"
                  >
                    <span v-if="d.inMonth" class="day">{{ Number(d.date.slice(8, 10)) }}</span>
                    <span class="sr">{{ d.date }}</span>
                  </button>
                </div>
              </section>
            </div>

            <div class="month-nav" aria-label="Calendar paging">
              <button class="bb-btn bb-btn--secondary" type="button" :disabled="!canPrevMonths" @click="prevMonths">Previous</button>
              <button class="bb-btn bb-btn--secondary" type="button" :disabled="!canNextMonths" @click="nextMonths">Next</button>
            </div>
          </div>

          <div class="weekly-gauges">
            <article class="gauge-card gauge-card--cooking">
              <h3 class="gauge-title">
                You cooked <strong>{{ cookingThisWeekDisplay }}</strong> {{ cookingUnitLabel }} this week
              </h3>
              <div
                class="gauge"
                role="img"
                :aria-label="`Cooking days this week: ${cookingThisWeekDisplay} ${cookingUnitLabel} out of ${COOKING_GAUGE_MAX}`"
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
                    :stroke-dasharray="`${cookingGaugePercent} 100`"
                  />
                </svg>
                <div class="gauge-readout">
                  <span class="gauge-value">{{ cookingThisWeekDisplay }}</span>
                  <span class="gauge-unit">{{ cookingUnitLabel }} / week</span>
                </div>
              </div>
              <p class="gauge-caption">
                Resets every Monday<span v-if="weekStartPretty"> — week of {{ weekStartPretty }}</span>
              </p>
            </article>

            <article class="gauge-card gauge-card--dining">
              <h3 class="gauge-title">
                You left <strong>{{ diningThisWeekDisplay }}</strong> dining {{ diningUnitLabel }} this week
              </h3>
              <div
                class="gauge"
                role="img"
                :aria-label="`Dining reviews this week: ${diningThisWeekDisplay} ${diningUnitLabel} out of ${DINING_GAUGE_MAX}`"
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
                    :stroke-dasharray="`${diningGaugePercent} 100`"
                  />
                </svg>
                <div class="gauge-readout">
                  <span class="gauge-value">{{ diningThisWeekDisplay }}</span>
                  <span class="gauge-unit">{{ diningUnitLabel }} / week</span>
                </div>
              </div>
              <p class="gauge-caption">
                Resets every Monday<span v-if="weekStartPretty"> — week of {{ weekStartPretty }}</span>
              </p>
            </article>
          </div>

          <div class="breakdown">
            <div class="calendar-title">Type breakdown</div>
            <div class="breakdown-row">
              <span>Recipes</span>
              <strong>{{ data.progress.typeBreakdown.recipes }}</strong>
            </div>
            <div class="breakdown-row">
              <span>Dining</span>
              <strong>{{ data.progress.typeBreakdown.dining }}</strong>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <h2>Cooking</h2>

        <h3>What works well for you</h3>
        <div v-if="data.thresholds.cooking.have < data.thresholds.cooking.need" class="guidance">
          After {{ data.thresholds.cooking.need - data.thresholds.cooking.have }}
          {{ data.thresholds.cooking.need - data.thresholds.cooking.have === 1 ? 'more rated recipe' : 'more rated recipes' }},
          I can show you what your favourites have in common.
        </div>
        <div v-else class="cards">
          <article v-for="c in data.cooking.works" :key="c.id" class="card">
            <div class="card-top">
              <div class="headline">{{ c.headline }}</div>
              <div class="badge">{{ recordLabel('cooking', c.recordCount) }}</div>
            </div>
            <button type="button" class="why" @click="toggleWhy(c.id)">
              Why this card?
            </button>
            <p v-if="openWhy[c.id]" class="detail">{{ c.detail }}</p>
            <button type="button" class="dismiss" @click="dismissCard(c.id)">Not useful</button>
          </article>
        </div>

        <h3>What doesn't seem to work</h3>
        <div v-if="data.thresholds.cooking.have < data.thresholds.cooking.need" class="guidance">
          After {{ data.thresholds.cooking.need - data.thresholds.cooking.have }}
          {{ data.thresholds.cooking.need - data.thresholds.cooking.have === 1 ? 'more rated recipe' : 'more rated recipes' }},
          I can show you what your favourites have in common.
        </div>
        <div v-else class="cards">
          <article v-for="c in data.cooking.doesntWork" :key="c.id" class="card">
            <div class="card-top">
              <div class="headline">{{ c.headline }}</div>
              <div class="badge">{{ recordLabel('cooking', c.recordCount) }}</div>
            </div>
            <button type="button" class="why" @click="toggleWhy(c.id)">
              Why this card?
            </button>
            <p v-if="openWhy[c.id]" class="detail">{{ c.detail }}</p>
            <button type="button" class="dismiss" @click="dismissCard(c.id)">Not useful</button>
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
        <div v-else class="cards">
          <article v-for="c in data.dining.works" :key="c.id" class="card">
            <div class="card-top">
              <div class="headline">{{ c.headline }}</div>
              <div class="badge">{{ recordLabel('dining', c.recordCount) }}</div>
            </div>
            <button type="button" class="why" @click="toggleWhy(c.id)">
              Why this card?
            </button>
            <p v-if="openWhy[c.id]" class="detail">{{ c.detail }}</p>
            <button type="button" class="dismiss" @click="dismissCard(c.id)">Not useful</button>
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
                      :class="[{ 'pdf-cell--out': !d.inMonth }, d.total === 0 ? 'pdf-cell--0' : d.total === 1 ? 'pdf-cell--1' : d.total === 2 ? 'pdf-cell--2' : d.total === 3 ? 'pdf-cell--3' : 'pdf-cell--4']"
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
                <div>Recipes: <strong>{{ data.progress.typeBreakdown.recipes }}</strong></div>
                <div>Dining: <strong>{{ data.progress.typeBreakdown.dining }}</strong></div>
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
                <div class="pdf-card-n">Based on {{ c.recordCount }} recipe{{ c.recordCount === 1 ? '' : 's' }}</div>
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
                <div class="pdf-card-n">Based on {{ c.recordCount }} recipe{{ c.recordCount === 1 ? '' : 's' }}</div>
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
                <div class="pdf-card-n">Based on {{ c.recordCount }} review{{ c.recordCount === 1 ? '' : 's' }}</div>
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
.page {
  max-width: 64rem;
  margin: 0 auto;
  padding: 1.25rem 1.25rem 3.5rem;
  display: grid;
  gap: 1.2rem;
  color: var(--bb-text);
}
.header h1 {
  margin: 0;
  font-family: var(--bb-font-headline);
  font-size: 2rem;
  letter-spacing: -0.02em;
}
.subhead {
  margin: 0.4rem 0 0;
  color: color-mix(in srgb, var(--bb-text) 70%, var(--bb-muted));
  max-width: 44rem;
  line-height: 1.5;
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
.band h2 {
  margin: 0 0 0.6rem;
  font-size: 1.05rem;
  font-family: var(--bb-font-headline);
}

.progress-grid {
  display: grid;
  grid-template-columns: 1.6fr 1.1fr 0.7fr;
  gap: 0.9rem;
  align-items: start;
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
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.9rem;
}
.month-title {
  font-weight: 900;
  font-size: 0.95rem;
  margin-bottom: 0.25rem;
}
.dow {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.25rem;
  margin-bottom: 0.25rem;
  color: color-mix(in srgb, var(--bb-text) 65%, var(--bb-muted));
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}
.grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.25rem;
}
.cell {
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 10px;
  border: 1px solid var(--bb-border);
  background: transparent;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cell:hover,
.cell:focus-visible {
  z-index: 5;
}
.day {
  font-size: 0.72rem;
  font-weight: 800;
  color: var(--bb-text);
  line-height: 1;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
.cell--out {
  opacity: 0.35;
}
.cell--0 {
  background: transparent;
}
.cell--1 {
  background: color-mix(in srgb, var(--bb-primary-container) 25%, transparent);
  border-color: color-mix(in srgb, var(--bb-primary) 28%, var(--bb-border));
}
.cell--2 {
  background: color-mix(in srgb, var(--bb-primary-container) 50%, transparent);
  border-color: color-mix(in srgb, var(--bb-primary) 38%, var(--bb-border));
}
.cell--3 {
  background: color-mix(in srgb, var(--bb-primary-container) 75%, transparent);
  border-color: color-mix(in srgb, var(--bb-primary) 50%, var(--bb-border));
}
.cell--4 {
  background: var(--bb-primary-container);
  border-color: color-mix(in srgb, var(--bb-primary) 60%, var(--bb-border));
}

.month-nav {
  margin-top: 0.75rem;
  display: flex;
  gap: 0.5rem;
  justify-content: flex-start;
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
  content: "";
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

.breakdown-row {
  display: flex;
  justify-content: space-between;
  padding: 0.35rem 0;
  border-bottom: 1px solid color-mix(in srgb, var(--bb-border) 65%, transparent);
}
.breakdown-row:last-child {
  border-bottom: none;
}

.section h2 {
  margin: 0 0 0.5rem;
  font-family: var(--bb-font-headline);
  font-size: 1.3rem;
}
.section h3 {
  margin: 0.85rem 0 0.45rem;
  font-size: 1.05rem;
  font-family: var(--bb-font-headline);
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
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}
.card {
  border: 1px solid var(--bb-border);
  background: var(--bb-surface-low);
  border-radius: 14px;
  padding: 0.85rem;
  display: grid;
  gap: 0.55rem;
}
.card-top {
  display: grid;
  gap: 0.35rem;
}
.headline {
  font-weight: 800;
  line-height: 1.25;
}
.badge {
  width: fit-content;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--bb-border) 80%, transparent);
  color: color-mix(in srgb, var(--bb-text) 65%, var(--bb-muted));
  font-size: 0.8rem;
}
.why {
  justify-self: start;
  border: none;
  background: transparent;
  color: var(--bb-accent);
  padding: 0;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.detail {
  margin: 0;
  color: color-mix(in srgb, var(--bb-text) 70%, var(--bb-muted));
  line-height: 1.5;
}
.dismiss {
  justify-self: start;
  border: none;
  background: transparent;
  color: color-mix(in srgb, var(--bb-text) 65%, var(--bb-muted));
  padding: 0;
  font: inherit;
  cursor: pointer;
}
.dismiss:hover {
  color: var(--bb-text);
}

.export {
  margin-top: 0.25rem;
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
.pdf-cell--0 {
  background: transparent;
}
.pdf-cell--1 {
  background: rgba(17, 24, 39, 0.08);
}
.pdf-cell--2 {
  background: rgba(17, 24, 39, 0.16);
}
.pdf-cell--3 {
  background: rgba(17, 24, 39, 0.24);
}
.pdf-cell--4 {
  background: rgba(17, 24, 39, 0.34);
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
.pdf-card-n {
  margin-top: 6px;
  font-size: 11.5px;
  color: #111;
}
.pdf-about p {
  margin: 8px 0 0;
  font-size: 12.5px;
  color: #374151;
  line-height: 1.5;
}

@media (max-width: 900px) {
  .progress-grid {
    grid-template-columns: 1fr;
  }
  .cards {
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

