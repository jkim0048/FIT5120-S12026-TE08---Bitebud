<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import type {
  AboutActivityRow,
  AboutMealPrepAgeRow,
  AboutPopulationByAgeRow,
  AboutStatsPayload,
} from '../lib/aboutApi'
import { fetchAboutStats } from '../lib/aboutApi'

const stats = ref<AboutStatsPayload | null>(null)
const loadError = ref<string | null>(null)
const loading = ref(true)

/** Which slice is enlarged / table row highlighted (meal-prep pie). */
const mealPrepPieHover = ref<string | null>(null)

/** Muted neurodiverse palette — shared by meal-prep pie & population treemap (see style.css / DESIGN.md). */
const ND_SLICE_COLORS = [
  '#8FA9B8',
  '#9AB89A',
  '#C9B896',
  '#C4A4B8',
  '#A8A8C8',
  '#D4B896',
  '#8FB8C4',
  '#B8C4A8',
  '#D4C4A8',
  '#A8BCC4',
] as const

/** Age-band fills — same muted ND palette as meal-prep pie (DESIGN.md / BiteBud tokens). */
const POP_TREEMAP_AGE_COLORS: Record<string, string> = {
  '0-4': ND_SLICE_COLORS[0],
  '5-9': ND_SLICE_COLORS[1],
  '10-14': ND_SLICE_COLORS[2],
  '15-19': ND_SLICE_COLORS[3],
  '20-24': ND_SLICE_COLORS[4],
  '25-29': ND_SLICE_COLORS[5],
  '30-34': ND_SLICE_COLORS[6],
  '35-39': ND_SLICE_COLORS[7],
  '40 and over': ND_SLICE_COLORS[8],
}

type PopulationTreemapLeaf = {
  label: string
  valueThousands: number
  valuePersons: number
  color: string
  pct: number
  hoverTitle: string
  displayK: string
}

type PopulationTreemapModel = {
  cssVars: Record<string, string>
  leaves: PopulationTreemapLeaf[]
  totalPersons: number
  childrenPersons: number
  childrenPct: number
  youngPersons: number
  youngPct: number
  teensPersons: number
  teensPct: number
  adults30Persons: number
  adults30Pct: number
  ariaLabel: string
}

const POP_CHILD_HINTS: Record<string, string> = {
  '0-4': 'Earliest years',
  '5-9': 'Early primary school',
  '10-14': 'Peak group',
}

function popAgeBandLabel(label: string): string {
  if (label === '40 and over') return '40+'
  return label.replace('-', ' — ')
}

type PieSlice = {
  label: string
  valueThousands: number
  valuePersons: number
  color: string
  pct: number
  path: string
  hoverTitle: string
  labelX: number
  labelY: number
  labelCompact: boolean
}

function pieSlicePath(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const x0 = cx + r * Math.cos(startAngle)
  const y0 = cy + r * Math.sin(startAngle)
  const x1 = cx + r * Math.cos(endAngle)
  const y1 = cy + r * Math.sin(endAngle)
  const sweep = endAngle - startAngle
  const largeArc = sweep > Math.PI ? 1 : 0
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1} Z`
}

const MEAL_PREP_30_PLUS_AGES = new Set(['30-34', '35-39', '40 and over'])
const MEAL_PREP_30_PLUS_LABEL = '30 and above'

/** Meal-prep pie SVG layout — scaled for treemap/lollipop-sized display. */
const MEAL_PREP_PIE_LAYOUT = {
  size: 400,
  cx: 200,
  cy: 200,
  r: 176,
} as const

function mealPrepPieEntriesFromRows(
  rows: AboutMealPrepAgeRow[],
): Array<{ label: string; valueThousands: number }> {
  const entries: Array<{ label: string; valueThousands: number }> = []
  let adult30PlusThousands = 0

  for (const row of rows) {
    const raw = row.estimate2022
    const valueThousands = raw == null || Number.isNaN(Number(raw)) ? 0 : Number(raw)
    if (MEAL_PREP_30_PLUS_AGES.has(row.ageGroup)) {
      adult30PlusThousands += valueThousands
    } else if (valueThousands > 0) {
      entries.push({ label: row.ageGroup, valueThousands })
    }
  }

  if (adult30PlusThousands > 0) {
    entries.push({ label: MEAL_PREP_30_PLUS_LABEL, valueThousands: adult30PlusThousands })
  }

  return entries
}

function buildMealPrepPie2022(rows: AboutMealPrepAgeRow[]): PieSlice[] {
  const entries = mealPrepPieEntriesFromRows(rows).map((e, i) => ({
    ...e,
    valuePersons: Math.round(e.valueThousands * 1000),
    color: ND_SLICE_COLORS[i % ND_SLICE_COLORS.length],
  }))
  const sum = entries.reduce((s, e) => s + e.valueThousands, 0)
  if (sum <= 0) return []

  const { cx, cy, r } = MEAL_PREP_PIE_LAYOUT
  const labelR = r * 0.58
  let angle = -Math.PI / 2

  return entries.map((e) => {
    const sweep = (e.valueThousands / sum) * Math.PI * 2
    const start = angle
    const end = angle + sweep
    angle = end
    const midAngle = (start + end) / 2
    const pct = (e.valueThousands / sum) * 100
    const hoverTitle = `${e.label}: ${e.valuePersons.toLocaleString('en-AU')} people (${pct.toFixed(1)}% of 2022 meal-prep assistance total)`
    return {
      label: e.label,
      valueThousands: e.valueThousands,
      valuePersons: e.valuePersons,
      color: e.color,
      pct,
      path: pieSlicePath(cx, cy, r, start, end),
      hoverTitle,
      labelX: cx + labelR * Math.cos(midAngle),
      labelY: cy + labelR * Math.sin(midAngle),
      labelCompact: pct < 14,
    }
  })
}

/** Rows that contribute to the activity lollipop (excludes survey summary lines). */
function isActivityChartDataRow(row: AboutActivityRow): boolean {
  const a = row.activity
  if (a.startsWith('Total')) return false
  if (a.startsWith('Need assistance')) return false
  if (a.startsWith('Does not need')) return false
  return true
}

type ActivityLollipopBar = {
  label: string
  valueThousands: number
  valuePersons: number
  displayK: string
  pct: number
  cy: number
  dotCx: number
  hoverTitle: string
}

type ActivityLollipopModel = {
  bars: ActivityLollipopBar[]
  width: number
  height: number
  marginLeft: number
  marginRight: number
  marginTop: number
  marginBottom: number
  plotWidth: number
  axisY: number
  maxThousands: number
  gridTicks: number[]
  tickLabelY: number
  xLabelY: number
  ariaLabel: string
}

const ACTIVITY_LOLLY_LAYOUT = {
  width: 920,
  height: 540,
  marginLeft: 248,
  marginRight: 108,
  marginTop: 44,
  marginBottom: 72,
  maxThousands: 250,
  dotR: 9,
} as const

function buildActivityLollipop(rows: AboutActivityRow[]): ActivityLollipopModel | null {
  const entries = rows
    .filter(isActivityChartDataRow)
    .map((row) => {
      const raw = row.totalEstimateThousands
      const valueThousands = raw == null || Number.isNaN(Number(raw)) ? 0 : Number(raw)
      return {
        label: row.activity,
        valueThousands,
        valuePersons: Math.round(valueThousands * 1000),
      }
    })
    .filter((e) => e.valueThousands > 0)
    .sort((a, b) => b.valueThousands - a.valueThousands)

  if (!entries.length) return null

  const sum = entries.reduce((s, e) => s + e.valueThousands, 0)
  const plotWidth = ACTIVITY_LOLLY_LAYOUT.width - ACTIVITY_LOLLY_LAYOUT.marginLeft - ACTIVITY_LOLLY_LAYOUT.marginRight
  const chartBodyHeight = ACTIVITY_LOLLY_LAYOUT.height - ACTIVITY_LOLLY_LAYOUT.marginTop - ACTIVITY_LOLLY_LAYOUT.marginBottom
  const rowHeight = chartBodyHeight / entries.length
  const height = ACTIVITY_LOLLY_LAYOUT.height

  const bars: ActivityLollipopBar[] = entries.map((e, i) => {
    const cy = ACTIVITY_LOLLY_LAYOUT.marginTop + i * rowHeight + rowHeight / 2
    const dotCx =
      ACTIVITY_LOLLY_LAYOUT.marginLeft + (e.valueThousands / ACTIVITY_LOLLY_LAYOUT.maxThousands) * plotWidth
    const pct = sum > 0 ? (e.valueThousands / sum) * 100 : 0
    return {
      label: e.label,
      valueThousands: e.valueThousands,
      valuePersons: e.valuePersons,
      displayK: ageK(e.valueThousands),
      pct,
      cy,
      dotCx,
      hoverTitle: `${e.label}: ${e.valuePersons.toLocaleString('en-AU')} people (${pct.toFixed(1)}% of combined activity-type estimates)`,
    }
  })

  const ariaLabel =
    bars.length === 0
      ? 'Assistance by activity: no data'
      : `Autistic persons needing assistance by activity, 2022: ${bars
          .map((b) => `${b.label} ${b.displayK}`)
          .join('; ')}`

  return {
    bars,
    width: ACTIVITY_LOLLY_LAYOUT.width,
    height,
    marginLeft: ACTIVITY_LOLLY_LAYOUT.marginLeft,
    marginRight: ACTIVITY_LOLLY_LAYOUT.marginRight,
    marginTop: ACTIVITY_LOLLY_LAYOUT.marginTop,
    marginBottom: ACTIVITY_LOLLY_LAYOUT.marginBottom,
    plotWidth,
    axisY: height - ACTIVITY_LOLLY_LAYOUT.marginBottom + 12,
    maxThousands: ACTIVITY_LOLLY_LAYOUT.maxThousands,
    gridTicks: [0, 50, 100, 150, 200, 250],
    tickLabelY: height - ACTIVITY_LOLLY_LAYOUT.marginBottom + 34,
    xLabelY: height - 14,
    ariaLabel,
  }
}

function activityLollipopTickX(model: ActivityLollipopModel, tick: number): number {
  return model.marginLeft + (tick / model.maxThousands) * model.plotWidth
}

/** X-axis tick text — 50K, 100K, … (0 omitted). */
function activityLollipopTickLabel(tick: number): string {
  if (tick <= 0) return ''
  return `${tick}K`
}

function populationAgeThousands(rows: AboutPopulationByAgeRow[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const row of rows.filter((r) => !r.isTotalRow)) {
    const raw = row.estimate2022
    const v = raw == null || Number.isNaN(Number(raw)) ? 0 : Number(raw)
    m.set(row.ageGroup, v)
  }
  return m
}

function ageK(thousands: number): string {
  if (thousands >= 100) return `${Math.round(thousands)}k`
  return `${thousands.toLocaleString('en-AU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k`
}

function buildPopulationTreemapLeaf(
  label: string,
  valueThousands: number,
  totalThousands: number,
): PopulationTreemapLeaf {
  const valuePersons = valueThousands * 1000
  const pct = totalThousands > 0 ? (valueThousands / totalThousands) * 100 : 0
  return {
    label,
    valueThousands,
    valuePersons,
    color: POP_TREEMAP_AGE_COLORS[label] ?? ND_SLICE_COLORS[1],
    pct,
    displayK: ageK(valueThousands),
    hoverTitle: `${label}: ${valuePersons.toLocaleString('en-AU')} people (${pct.toFixed(1)}% of 2022 autistic population by age)`,
  }
}

function buildPopulationTreemap2022(rows: AboutPopulationByAgeRow[]): PopulationTreemapModel | null {
  const ages = populationAgeThousands(rows)
  const v = (key: string) => ages.get(key) ?? 0

  const total =
    v('0-4') +
    v('5-9') +
    v('10-14') +
    v('15-19') +
    v('20-24') +
    v('25-29') +
    v('30-34') +
    v('35-39') +
    v('40 and over')
  if (total <= 0) return null

  const children = v('0-4') + v('5-9') + v('10-14')
  const teens = v('15-19')
  const young = v('20-24') + v('25-29')
  const adults30 = v('30-34') + v('35-39') + v('40 and over')
  const rightCol = teens + young + adults30

  const leaves = [
    buildPopulationTreemapLeaf('0-4', v('0-4'), total),
    buildPopulationTreemapLeaf('5-9', v('5-9'), total),
    buildPopulationTreemapLeaf('10-14', v('10-14'), total),
    buildPopulationTreemapLeaf('15-19', v('15-19'), total),
    buildPopulationTreemapLeaf('20-24', v('20-24'), total),
    buildPopulationTreemapLeaf('25-29', v('25-29'), total),
    buildPopulationTreemapLeaf('30-34', v('30-34'), total),
    buildPopulationTreemapLeaf('35-39', v('35-39'), total),
    buildPopulationTreemapLeaf('40 and over', v('40 and over'), total),
  ].filter((l) => l.valueThousands > 0)

  const cssVars: Record<string, string> = {
    '--pop-children-fr': String(children),
    '--pop-right-fr': String(rightCol),
    '--pop-fr-04': String(v('0-4')),
    '--pop-fr-59': String(v('5-9')),
    '--pop-fr-1014': String(v('10-14')),
    '--pop-young-fr': String(young),
    '--pop-teen-fr': String(teens),
    '--pop-adults-fr': String(adults30),
    '--pop-fr-2024': String(v('20-24')),
    '--pop-fr-2529': String(v('25-29')),
    '--pop-fr-3034': String(v('30-34')),
    '--pop-fr-3539': String(v('35-39')),
    '--pop-fr-40': String(v('40 and over')),
  }

  const totalPersons = Math.round(total * 1000)
  const childrenPersons = Math.round(children * 1000)
  const youngPersons = Math.round(young * 1000)
  const teensPersons = Math.round(teens * 1000)
  const adults30Persons = Math.round(adults30 * 1000)
  const childrenPct = (children / total) * 100
  const youngPct = (young / total) * 100
  const teensPct = (teens / total) * 100
  const adults30Pct = (adults30 / total) * 100

  const ariaLabel =
    leaves.length === 0
      ? '2022 population by age: no data'
      : `2022 autistic population by age group treemap: ${leaves
          .map((s) => `${s.label} ${s.valuePersons.toLocaleString('en-AU')} people, ${s.pct.toFixed(1)} per cent`)
          .join('; ')}`

  return {
    cssVars,
    leaves,
    totalPersons,
    childrenPersons,
    childrenPct,
    youngPersons,
    youngPct,
    teensPersons,
    teensPct,
    adults30Persons,
    adults30Pct,
    ariaLabel,
  }
}

function popChildHint(label: string): string {
  return POP_CHILD_HINTS[label] ?? ''
}

const population2022Treemap = computed(() => {
  const rows = stats.value?.populationByAge
  if (!rows?.length) return null
  return buildPopulationTreemap2022(rows)
})

function populationTreemapLeaf(label: string): PopulationTreemapLeaf | undefined {
  return population2022Treemap.value?.leaves.find((l) => l.label === label)
}

const mealPrep2022Pie = computed(() => {
  const rows = stats.value?.mealPrepAssistanceByAge
  if (!rows?.length) return null
  const slices = buildMealPrepPie2022(rows)
  const totalThousands = slices.reduce((s, sl) => s + sl.valueThousands, 0)
  const totalPersons = totalThousands * 1000
  const ariaLabel =
    slices.length === 0
      ? '2022: no data'
      : `2022 meal preparation assistance by age group: ${slices
          .map((s) => `${s.label} ${s.valuePersons.toLocaleString('en-AU')} people, ${s.pct.toFixed(1)} per cent`)
          .join('; ')}`
  return { slices, totalPersons, ariaLabel }
})

const activityAssistanceLollipop = computed(() => {
  const rows = stats.value?.activityAssistance
  if (!rows?.length) return null
  return buildActivityLollipop(rows)
})

const mealPrepSlicesDisplay = computed(() => {
  const pie = mealPrep2022Pie.value
  if (!pie?.slices.length) return []
  const h = mealPrepPieHover.value
  if (!h) return pie.slices
  const hi = pie.slices.find((s) => s.label === h)
  const rest = pie.slices.filter((s) => s.label !== h)
  return hi ? [...rest, hi] : pie.slices
})

function mealPrepSliceGroupStyle(slLabel: string): Record<string, string> {
  const hovered = mealPrepPieHover.value === slLabel
  const o = MEAL_PREP_PIE_LAYOUT.cx
  return {
    transformOrigin: `${o}px ${o}px`,
    transform: hovered ? `translate(${o}px, ${o}px) scale(1.06) translate(-${o}px, -${o}px)` : 'none',
    cursor: 'pointer',
  }
}

onMounted(() => {
  void (async () => {
    loading.value = true
    loadError.value = null
    try {
      stats.value = await fetchAboutStats()
    } catch {
      loadError.value = 'We could not load the latest figures. Please try again later.'
    } finally {
      loading.value = false
    }
  })()
})

function fmtCell(n: number | null): string {
  if (n == null) return '—'
  return n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPersons(n: number): string {
  return n.toLocaleString('en-AU', { maximumFractionDigits: 0 })
}
</script>

<template>
  <article class="about">
    <p class="about-nav">
      <RouterLink class="about-back-link" :to="{ name: 'home' }">← Back to home</RouterLink>
    </p>
    <header class="about-hero">
      <h1 class="h1">Learn more</h1>
      <p class="lead">
        BiteBud exists to make cooking feel more predictable — with visual steps, checklists, and timing supports that match how many
        autistic Australians already succeed in the kitchen when the environment is right.
      </p>
    </header>

    <p v-if="loading" class="status">Loading figures…</p>
    <p v-else-if="loadError" class="status status--err" role="alert">{{ loadError }}</p>

    <template v-else-if="stats">
      <section class="band" aria-labelledby="about-context-heading">
        <div class="split">
          <figure class="figure">
            <img
              src="/about/neurodiversity.jpg"
              width="1024"
              height="583"
              alt="Illustration of four young people labelled Autism, ADHD, Dyslexia, and Dyspraxia, each shown with a distinct experience."
              class="figure-img"
            />
          </figure>
          <div class="copy">
            <h2 id="about-context-heading" class="h2">Why this matters</h2>
            <p class="prose">
              Across just seven years the picture of autism in Australia has changed dramatically. In 2015 the Survey of Disability,
              Ageing and Carers counted roughly 164,000 autistic Australians population. By 2018 that figure had climbed to 205,200 and
              by 2022 it had reached 290,900 — Australians
            </p>
          </div>
        </div>

        <div class="table-block">
          <h3 class="h3">Total autistic persons (&apos;000)</h3>
          <div class="table-scroll">
            <table class="data-table zebra">
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  <th scope="col" class="num">Total autistic persons (&apos;000)</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, i) in stats.populationTotals" :key="row.year" :class="{ stripe: i % 2 === 1 }">
                  <th scope="row">{{ row.year }}</th>
                  <td class="num">{{ fmtCell(row.totalThousands) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="band" aria-labelledby="supported-heading">
        <div class="split split--text-first">
          <div class="copy">
            <h2 id="supported-heading" class="h2">Supported cooking — helper guiding cooking</h2>
            <p class="prose">
              A common support method for autistic Australians learning meal preparation is a short co-cooking session, where a support
              worker or family member provides simple prompts and guidance while the person completes the cooking themselves to build
              independence and routine.
            </p>
          </div>
          <figure class="figure">
            <img
              src="/about/supported-cooking.jpg"
              width="1024"
              height="583"
              alt="Illustration of a support person guiding someone at the stove with a visual recipe card on the counter."
              class="figure-img"
            />
          </figure>
        </div>
      </section>

      <section class="band band--last" aria-labelledby="independent-heading">
        <div class="split">
          <figure class="figure">
            <img
              src="/about/independent-cooking.jpg"
              width="1024"
              height="585"
              alt="Illustration of someone cooking independently with headphones, a tablet checklist, and a digital timer."
              class="figure-img"
            />
          </figure>
          <div class="copy">
            <h2 id="independent-heading" class="h2">Independent cooking — sensory &amp; visual supports with BiteBud</h2>
            <p class="prose">
              In 2022, around 45,600 autistic Australians needed help with meal preparation, with the highest numbers in the 15–19 (7.2k)
              and 20–24 (5.9k) age groups, while the 35–39 group had the lowest number (0.5k).
            </p>
            <p class="prose">
              Now neurodivergent adults can cook independently using the BiteBud website, which provides visual recipe checklists and
              countdown timers to simplify meal preparation into manageable steps. These supports reduce executive-function demands and
              focus on scaffolding rather than constant supervision.
            </p>
          </div>
        </div>

        <div v-if="population2022Treemap" class="table-block table-block--pop-infographic">
          <div class="pop-infographic meal-prep-visual meal-prep-visual--calm">
            <header class="pop-infographic__head">
              <p class="pop-infographic__eyebrow">Autistic Australians, 2022</p>
              <h3 id="pop-age-heading" class="pop-infographic__title">Autistic population distribution over different age group, 2022.</h3>
              <p class="pop-infographic__lede">
                Each block&rsquo;s size is its share of the population. Children fill half the canvas. Teens, young adults, and adults fit
                into the other half — together.
              </p>
            </header>

            <figure class="pop-treemap-figure" role="img" :aria-label="population2022Treemap.ariaLabel">
              <div class="pop-treemap__summary" aria-hidden="true">
                <div class="pop-treemap__stat">
                  <span class="pop-treemap__stat-label">In total</span>
                  <span class="pop-treemap__stat-value">{{ fmtPersons(population2022Treemap.totalPersons) }}</span>
                  <span class="pop-treemap__stat-unit">people</span>
                </div>
                <div class="pop-treemap__stat">
                  <span class="pop-treemap__stat-label">Children 0 — 14</span>
                  <span class="pop-treemap__stat-value">{{ Math.round(population2022Treemap.childrenPct) }}%</span>
                  <span class="pop-treemap__stat-unit">{{ fmtPersons(population2022Treemap.childrenPersons) }} people</span>
                </div>
                <div class="pop-treemap__stat">
                  <span class="pop-treemap__stat-label">Adults 30+</span>
                  <span class="pop-treemap__stat-value">{{ Math.round(population2022Treemap.adults30Pct) }}%</span>
                  <span class="pop-treemap__stat-unit">{{ fmtPersons(population2022Treemap.adults30Persons) }} people</span>
                </div>
              </div>

              <div class="pop-treemap__map-shell">
                <div class="pop-treemap__map" :style="population2022Treemap.cssVars">
                <section class="pop-treemap__region pop-treemap__region--children" aria-hidden="true">
                  <header class="pop-treemap__region-head">
                    <span class="pop-treemap__region-kicker">Children</span>
                    <span class="pop-treemap__region-count">{{ fmtPersons(population2022Treemap.childrenPersons) }}</span>
                    <span class="pop-treemap__region-meta"
                      >Age 0 — 14 · {{ Math.round(population2022Treemap.childrenPct) }}% of all autistic Australians</span
                    >
                  </header>
                  <div class="pop-treemap__children-stack">
                    <div
                      v-for="childLabel in ['0-4', '5-9', '10-14']"
                      :key="childLabel"
                      v-show="populationTreemapLeaf(childLabel)"
                      class="pop-treemap__tile pop-treemap__tile--rich pop-treemap__tile--child"
                      :style="{ background: populationTreemapLeaf(childLabel)!.color }"
                    >
                      <span class="pop-treemap__tile-age">Age {{ popAgeBandLabel(childLabel) }}</span>
                      <span class="pop-treemap__tile-hint">{{ popChildHint(childLabel) }}</span>
                      <span class="pop-treemap__tile-count">{{ fmtPersons(populationTreemapLeaf(childLabel)!.valuePersons) }}</span>
                    </div>
                  </div>
                </section>

                <div class="pop-treemap__right">
                  <section class="pop-treemap__region pop-treemap__region--young" aria-hidden="true">
                    <header class="pop-treemap__region-head">
                      <span class="pop-treemap__region-kicker">Young adults</span>
                      <span class="pop-treemap__region-count">{{ fmtPersons(population2022Treemap.youngPersons) }}</span>
                      <span class="pop-treemap__region-meta"
                        >Age 20 — 29 · {{ Math.round(population2022Treemap.youngPct) }}%</span
                      >
                    </header>
                    <div class="pop-treemap__region-body">
                    <div class="pop-treemap__young-row">
                      <div
                        v-if="populationTreemapLeaf('20-24')"
                        class="pop-treemap__tile"
                        :style="{ background: populationTreemapLeaf('20-24')!.color }"
                      >
                        <span class="pop-treemap__tile-label">20 — 24</span>
                        <span class="pop-treemap__tile-value">{{ fmtPersons(populationTreemapLeaf('20-24')!.valuePersons) }}</span>
                      </div>
                      <div
                        v-if="populationTreemapLeaf('25-29')"
                        class="pop-treemap__tile"
                        :style="{ background: populationTreemapLeaf('25-29')!.color }"
                      >
                        <span class="pop-treemap__tile-label">25 — 29</span>
                        <span class="pop-treemap__tile-value">{{ fmtPersons(populationTreemapLeaf('25-29')!.valuePersons) }}</span>
                      </div>
                    </div>
                    </div>
                  </section>

                  <section
                    v-if="populationTreemapLeaf('15-19')"
                    class="pop-treemap__region pop-treemap__region--teens"
                    aria-hidden="true"
                  >
                    <header class="pop-treemap__region-head pop-treemap__region-head--solo">
                      <span class="pop-treemap__region-kicker">Teenagers</span>
                      <span class="pop-treemap__region-count">{{ fmtPersons(population2022Treemap.teensPersons) }}</span>
                      <span class="pop-treemap__region-meta"
                        >Age 15 — 19 · {{ Math.round(population2022Treemap.teensPct) }}%</span
                      >
                    </header>
                  </section>

                  <section class="pop-treemap__region pop-treemap__region--adults" aria-hidden="true">
                    <header class="pop-treemap__region-head">
                      <span class="pop-treemap__region-kicker">Adults</span>
                      <span class="pop-treemap__region-count">{{ fmtPersons(population2022Treemap.adults30Persons) }}</span>
                      <span class="pop-treemap__region-meta"
                        >Age 30+ · {{ Math.round(population2022Treemap.adults30Pct) }}%</span
                      >
                    </header>
                    <div class="pop-treemap__region-body">
                    <div class="pop-treemap__adults-row">
                      <div
                        v-if="populationTreemapLeaf('30-34')"
                        class="pop-treemap__tile"
                        :style="{ background: populationTreemapLeaf('30-34')!.color }"
                      >
                        <span class="pop-treemap__tile-label">30 — 34</span>
                        <span class="pop-treemap__tile-value">{{ populationTreemapLeaf('30-34')!.displayK }}</span>
                      </div>
                      <div
                        v-if="populationTreemapLeaf('35-39')"
                        class="pop-treemap__tile"
                        :style="{ background: populationTreemapLeaf('35-39')!.color }"
                      >
                        <span class="pop-treemap__tile-label">35 — 39</span>
                        <span class="pop-treemap__tile-value">{{ populationTreemapLeaf('35-39')!.displayK }}</span>
                      </div>
                      <div
                        v-if="populationTreemapLeaf('40 and over')"
                        class="pop-treemap__tile"
                        :style="{ background: populationTreemapLeaf('40 and over')!.color }"
                      >
                        <span class="pop-treemap__tile-label">40+</span>
                        <span class="pop-treemap__tile-value">{{ populationTreemapLeaf('40 and over')!.displayK }}</span>
                      </div>
                    </div>
                    </div>
                  </section>
                </div>
                </div>
              </div>

              <p class="pop-treemap__guide">
                Read it like a room. The biggest block is where most people are. The smaller blocks show how the rest of the population
                fits in around them. Sub-blocks inside each life stage give the detail without needing a second chart.
              </p>
            </figure>

          </div>
        </div>

        <div class="table-block" aria-labelledby="activity-wise-heading">
          <header class="pop-infographic__head">
            <h3 id="activity-wise-heading" class="pop-infographic__title">
              Activity wise assistance needed by neurodivergent person
            </h3>
            <p class="pop-infographic__lede">
              Estimated autistic Australians needing help with daily activities (values in thousands), sorted highest to lowest.
            </p>
          </header>

          <div
            v-if="activityAssistanceLollipop && stats.activityAssistance.length"
            class="activity-infographic meal-prep-visual meal-prep-visual--calm"
          >
            <figure class="activity-lollipop-figure">
              <div
                class="activity-lollipop__scroll"
                tabindex="0"
                aria-label="Activity assistance chart — scroll horizontally on small screens"
              >
              <svg
                class="activity-lollipop__svg"
                :viewBox="`0 0 ${activityAssistanceLollipop.width} ${activityAssistanceLollipop.height}`"
                :width="activityAssistanceLollipop.width"
                :height="activityAssistanceLollipop.height"
                role="img"
                :aria-label="activityAssistanceLollipop.ariaLabel"
              >
                <g class="activity-lollipop__grid" aria-hidden="true">
                  <line
                    v-for="tick in activityAssistanceLollipop.gridTicks"
                    :key="`grid-${tick}`"
                    class="activity-lollipop__grid-line"
                    :x1="activityLollipopTickX(activityAssistanceLollipop, tick)"
                    :y1="activityAssistanceLollipop.marginTop - 4"
                    :x2="activityLollipopTickX(activityAssistanceLollipop, tick)"
                    :y2="activityAssistanceLollipop.axisY"
                  />
                </g>
                <line
                  class="activity-lollipop__axis"
                  aria-hidden="true"
                  :x1="activityAssistanceLollipop.marginLeft"
                  :y1="activityAssistanceLollipop.axisY"
                  :x2="activityAssistanceLollipop.marginLeft + activityAssistanceLollipop.plotWidth"
                  :y2="activityAssistanceLollipop.axisY"
                />
                <text
                  v-for="tick in activityAssistanceLollipop.gridTicks"
                  v-show="tick > 0"
                  :key="`tick-${tick}`"
                  class="activity-lollipop__tick-label"
                  :x="activityLollipopTickX(activityAssistanceLollipop, tick)"
                  :y="activityAssistanceLollipop.tickLabelY"
                  text-anchor="middle"
                  aria-hidden="true"
                >
                  {{ activityLollipopTickLabel(tick) }}
                </text>
                <text
                  class="activity-lollipop__x-label"
                  :x="activityAssistanceLollipop.marginLeft + activityAssistanceLollipop.plotWidth / 2"
                  :y="activityAssistanceLollipop.xLabelY"
                  text-anchor="middle"
                  aria-hidden="true"
                >
                  Persons
                </text>
                <g v-for="bar in activityAssistanceLollipop.bars" :key="bar.label" class="activity-lollipop__bar">
                  <text
                    class="activity-lollipop__y-label"
                    :x="activityAssistanceLollipop.marginLeft - 10"
                    :y="bar.cy + 4"
                    text-anchor="end"
                  >
                    {{ bar.label }}
                  </text>
                  <line
                    class="activity-lollipop__stick"
                    :x1="activityAssistanceLollipop.marginLeft"
                    :y1="bar.cy"
                    :x2="bar.dotCx"
                    :y2="bar.cy"
                  />
                  <circle class="activity-lollipop__dot" :cx="bar.dotCx" :cy="bar.cy" :r="ACTIVITY_LOLLY_LAYOUT.dotR" />
                  <text class="activity-lollipop__value" :x="bar.dotCx + 14" :y="bar.cy + 5">{{ bar.displayK }}</text>
                </g>
              </svg>
              </div>
            </figure>

          </div>
        </div>

        <div class="table-block">
          <header class="pop-infographic__head">
            <h3 class="pop-infographic__title">
              Assistance required for Meal preparation distribution over different age group, 2022
            </h3>
            <p class="pop-infographic__lede">
              Estimated people needing meal-prep assistance (survey values scaled from published thousands). Hover a slice or table row to
              enlarge that segment; tooltips show counts and shares.
            </p>
          </header>
          <div v-if="mealPrep2022Pie" class="meal-prep-visual meal-prep-visual--calm pie-card-layout pie-card-layout--uniform">
            <div class="pie-card-layout__sidebar">
              <div class="pie-mini-table-scroll pie-mini-table-scroll--corner" @mouseleave="mealPrepPieHover = null">
                <table class="pie-mini-table pie-mini-table--compact" @mouseleave="mealPrepPieHover = null">
                  <thead>
                    <tr>
                      <th class="pie-mini-table__swatch-head" scope="col"><span class="visually-hidden">Colour</span></th>
                      <th scope="col">Age group</th>
                      <th scope="col" class="num">People (2022)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="sl in mealPrep2022Pie.slices"
                      :key="`mp-row-${sl.label}`"
                      class="pie-mini-table__row"
                      :class="{ 'pie-mini-table__row--active': mealPrepPieHover === sl.label }"
                      @mouseenter="mealPrepPieHover = sl.label"
                    >
                      <td class="pie-mini-table__swatch-cell">
                        <span class="pie-mini-table__dot" :style="{ background: sl.color }" aria-hidden="true" />
                      </td>
                      <th scope="row">{{ sl.label }}</th>
                      <td class="num">{{ fmtPersons(sl.valuePersons) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div class="pie-card-layout__main pie-card-layout__main--center">
              <div class="pie-charts pie-charts--single">
                <figure class="pie-chart-card">
                  <svg
                    class="pie-chart-card__svg"
                    :viewBox="`0 0 ${MEAL_PREP_PIE_LAYOUT.size} ${MEAL_PREP_PIE_LAYOUT.size}`"
                    :width="MEAL_PREP_PIE_LAYOUT.size"
                    :height="MEAL_PREP_PIE_LAYOUT.size"
                    role="img"
                    :aria-label="mealPrep2022Pie.ariaLabel"
                    @mouseleave="mealPrepPieHover = null"
                  >
                    <template v-if="mealPrepSlicesDisplay.length">
                      <g
                        v-for="sl in mealPrepSlicesDisplay"
                        :key="sl.label"
                        class="pie-slice-group"
                        :style="mealPrepSliceGroupStyle(sl.label)"
                        @mouseenter="mealPrepPieHover = sl.label"
                      >
                        <path class="pie-slice-path" :d="sl.path" :fill="sl.color" stroke-width="1.15">
                          <title>{{ sl.hoverTitle }}</title>
                        </path>
                        <text
                          class="pie-slice-label"
                          :class="{ 'pie-slice-label--compact': sl.labelCompact }"
                          :x="sl.labelX"
                          :y="sl.labelY"
                          text-anchor="middle"
                          dominant-baseline="middle"
                          pointer-events="none"
                          aria-hidden="true"
                        >
                          <tspan :x="sl.labelX" dy="-0.55em">{{ fmtPersons(sl.valuePersons) }}</tspan>
                          <tspan :x="sl.labelX" dy="1.15em">{{ sl.pct.toFixed(1) }}%</tspan>
                        </text>
                      </g>
                    </template>
                    <text
                      v-else
                      :x="MEAL_PREP_PIE_LAYOUT.cx"
                      :y="MEAL_PREP_PIE_LAYOUT.cy + 8"
                      text-anchor="middle"
                      class="pie-chart-card__empty"
                    >
                      No data
                    </text>
                  </svg>
                  <p class="pie-chart-card__total">Total: {{ fmtPersons(mealPrep2022Pie.totalPersons) }} people</p>
                </figure>
              </div>
            </div>
          </div>
        </div>
      </section>
    </template>
  </article>
</template>

<style scoped>
.about {
  max-width: var(--bb-content-max, 72rem);
  margin: 0 auto;
  padding: 1.5rem 0 3rem;
  font-family: var(--bb-font-body), system-ui, sans-serif;
}
.about-nav {
  margin: 0 0 1rem;
}
.about-back-link {
  color: var(--bb-accent);
  font-weight: 700;
  text-decoration: none;
  font-size: 0.95rem;
}
.about-back-link:hover {
  text-decoration: underline;
}
.about-hero {
  margin-bottom: 2rem;
}
.h1 {
  font-family: var(--bb-font-headline), system-ui, sans-serif;
  font-size: clamp(1.75rem, 4vw, 2.35rem);
  font-weight: 900;
  letter-spacing: -0.02em;
  color: var(--bb-primary);
  margin: 0 0 0.5rem;
}
.lead {
  font-size: 1.05rem;
  line-height: 1.55;
  color: var(--bb-muted);
  margin: 0;
  max-width: 52rem;
}
.status {
  margin: 1rem 0;
  color: var(--bb-muted);
}
.status--err {
  color: var(--bb-error);
}
.band {
  margin-bottom: 2.75rem;
}
.band--last {
  margin-bottom: 0;
}
.split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
  gap: clamp(1rem, 3vw, 2.25rem);
  align-items: start;
  margin-bottom: 1.75rem;
}
.split--text-first {
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
}
@media (max-width: 820px) {
  .split {
    grid-template-columns: 1fr;
  }
}
.figure {
  margin: 0;
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid var(--bb-border);
  background: var(--bb-surface-lowest);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.06);
}
.figure-img {
  display: block;
  width: 100%;
  height: auto;
}
.copy {
  min-width: 0;
}
.h2 {
  font-family: var(--bb-font-headline), system-ui, sans-serif;
  font-size: 1.25rem;
  font-weight: 800;
  color: var(--bb-text);
  margin: 0 0 0.65rem;
  line-height: 1.25;
}
.h3 {
  font-family: var(--bb-font-headline), system-ui, sans-serif;
  font-size: 1.05rem;
  font-weight: 700;
  margin: 0 0 0.5rem;
}
.prose {
  margin: 0 0 0.85rem;
  line-height: 1.6;
  color: var(--bb-text);
  font-size: 0.98rem;
}
.prose:last-child {
  margin-bottom: 0;
}
.table-block {
  margin-top: 0.25rem;
}
.table-block + .table-block {
  margin-top: 1.75rem;
}
.table-caption {
  font-size: 0.88rem;
  color: var(--bb-muted);
  margin: 0 0 0.65rem;
  max-width: 48rem;
}
.table-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  border-radius: 12px;
  border: 1px solid var(--bb-border);
}
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.92rem;
  background: var(--bb-surface-lowest);
}
.data-table thead {
  background: var(--bb-surface-high);
}
.data-table th,
.data-table td {
  padding: 0.55rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--bb-border);
}
.data-table thead th {
  font-family: var(--bb-font-headline), system-ui, sans-serif;
  font-weight: 700;
  font-size: 0.88rem;
}
.data-table tbody th {
  font-weight: 600;
}
.data-table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.data-table tbody tr:last-child th,
.data-table tbody tr:last-child td {
  border-bottom: none;
}
.data-table.zebra tbody tr.stripe {
  background: var(--bb-surface-low);
}
.data-table tbody tr.total th,
.data-table tbody tr.total td {
  font-weight: 800;
  background: color-mix(in srgb, var(--bb-secondary-container) 55%, transparent);
}
.data-table--navy {
  background: #0f172a;
  color: #f8fafc;
}
.data-table--navy thead {
  background: #0c1222;
  color: #fde68a;
}
.data-table--navy thead th {
  color: #fde68a;
  border-color: rgba(255, 255, 255, 0.12);
}
.data-table--navy tbody th {
  color: #fde68a;
  font-weight: 600;
}
.data-table--navy tbody td {
  color: #f1f5f9;
  border-color: rgba(255, 255, 255, 0.1);
}
.data-table--navy tbody tr:nth-child(even) {
  background: rgba(255, 255, 255, 0.04);
}
.band-title-only {
  margin-bottom: 0.35rem;
}
.band-intro {
  margin-top: 0;
  margin-bottom: 1rem;
  max-width: 48rem;
}

.meal-prep-visual {
  border-radius: 12px;
  border: 1px solid var(--bb-border);
  overflow: hidden;
  background: transparent;
}
.meal-prep-visual--calm {
  background: transparent;
  color: var(--bb-text);
  border-color: var(--bb-border);
  box-shadow: none;
}

.pie-card-layout {
  display: grid;
  grid-template-columns: minmax(0, auto) minmax(0, 1fr);
  gap: 0.75rem 1rem;
  padding: 0.75rem 0.65rem 0.9rem;
  align-items: start;
}
.pie-card-layout__sidebar {
  max-width: 12.5rem;
  min-width: 0;
}
.pie-card-layout__main {
  min-width: 0;
}
.pie-card-layout__main--center {
  display: flex;
  justify-content: center;
  align-items: flex-start;
}
.pie-card-layout--uniform {
  grid-template-columns: minmax(0, min(22rem, 34%)) minmax(0, 1fr);
  gap: 1rem 1.5rem;
  padding: 1rem 1.1rem 1.15rem;
  align-items: center;
}
.pie-card-layout--uniform .pie-card-layout__sidebar {
  max-width: min(22rem, 100%);
}
@media (max-width: 720px) {
  .pie-card-layout,
  .pie-card-layout--uniform {
    grid-template-columns: 1fr;
    align-items: start;
  }
  .pie-card-layout__sidebar {
    max-width: 100%;
  }
}

.pie-slice-group {
  transition: transform 0.32s ease-out;
}
@media (prefers-reduced-motion: reduce) {
  .pie-slice-group {
    transition: none;
  }
}
.pie-slice-path {
  stroke: rgba(15, 23, 42, 0.12);
  paint-order: stroke fill;
}
.pie-slice-label {
  fill: var(--bb-text);
  font-family: var(--bb-font-headline), system-ui, sans-serif;
  font-size: 14px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.pie-slice-label--compact {
  font-size: 12px;
}

.pie-charts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem 1.25rem;
  padding: 1.1rem 1rem 0.5rem;
}
.pie-charts--single {
  grid-template-columns: 1fr;
  justify-items: stretch;
  width: 100%;
  max-width: 100%;
  margin: 0;
  padding: 0.35rem 0.25rem 0.25rem;
}
.pie-chart-card {
  margin: 0;
  width: 100%;
  text-align: center;
}
.pie-chart-card__title {
  font-family: var(--bb-font-headline), system-ui, sans-serif;
  font-weight: 800;
  font-size: 0.95rem;
  color: var(--bb-text);
  margin: 0 0 0.5rem;
}
.pie-chart-card__svg {
  display: block;
  width: min(520px, 100%);
  max-width: 100%;
  min-height: 26rem;
  height: auto;
  margin: 0 auto;
  aspect-ratio: 1;
  overflow: visible;
}
.pie-chart-card__total {
  margin: 0.65rem 0 0;
  font-size: clamp(0.95rem, 1.8vw, 1.05rem);
  color: var(--bb-muted);
  font-variant-numeric: tabular-nums;
}
.pie-chart-card__empty {
  fill: var(--bb-muted);
  font-size: 18px;
}
.visually-hidden {
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
.pie-mini-table-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.pie-mini-table-scroll--corner {
  border-top: none;
  padding: 0.15rem 0.2rem 0.15rem 0;
}
.pie-mini-table-scroll--activity-tall {
  max-height: min(70vh, 22rem);
  overflow-y: auto;
}
.pie-mini-table--activity {
  max-width: none;
}
.pie-mini-table--activity tbody th {
  word-break: break-word;
  hyphens: auto;
}
.pie-mini-table__row--muted {
  opacity: 0.82;
  cursor: default;
}
.pie-mini-table {
  width: 100%;
  min-width: 0;
  border-collapse: collapse;
  font-size: 0.8rem;
  color: var(--bb-text);
}
.pie-mini-table thead th {
  font-family: var(--bb-font-headline), system-ui, sans-serif;
  font-weight: 700;
  color: var(--bb-muted);
  text-align: left;
  padding: 0.35rem 0.45rem;
  border-bottom: 1px solid var(--bb-border);
}
.pie-mini-table--compact {
  width: auto;
  max-width: 12.5rem;
  font-size: 0.68rem;
}
.pie-mini-table--compact thead th {
  padding: 0.2rem 0.28rem;
  font-size: 0.62rem;
  letter-spacing: 0.02em;
  font-weight: 600;
  color: var(--bb-muted);
  border-bottom-color: var(--bb-border);
}
.pie-mini-table--compact tbody th,
.pie-mini-table--compact tbody td {
  padding: 0.18rem 0.28rem;
}
.pie-mini-table--compact .pie-mini-table__swatch-head {
  width: 1.1rem;
}
.pie-mini-table--compact .pie-mini-table__swatch-cell {
  width: 1.1rem;
  padding-left: 0.2rem;
}
.pie-mini-table--compact .pie-mini-table__dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 3px;
}
.pie-mini-table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.pie-mini-table tbody th {
  font-weight: 600;
  color: var(--bb-text);
  padding: 0.3rem 0.45rem;
  border-bottom: 1px solid var(--bb-border);
}
.pie-mini-table tbody td {
  padding: 0.3rem 0.45rem;
  border-bottom: 1px solid var(--bb-border);
  color: var(--bb-text);
}
.pie-mini-table tbody tr:last-child th,
.pie-mini-table tbody tr:last-child td {
  border-bottom: none;
}
.pie-mini-table__swatch-head {
  width: 1.5rem;
  padding-left: 0.25rem;
}
.pie-mini-table__swatch-cell {
  width: 1.5rem;
  vertical-align: middle;
  padding-left: 0.35rem;
}
.pie-mini-table__dot {
  display: block;
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 2px;
}
.pie-mini-table__row {
  cursor: pointer;
  transition: background 0.22s ease;
}
.pie-mini-table__row:hover,
.pie-mini-table__row--active {
  background: color-mix(in srgb, var(--bb-primary) 8%, transparent);
}

/* Population infographic treemap — monochromatic BiteBud greens */
.table-block--pop-infographic {
  margin-top: 1.75rem;
}
.pop-infographic {
  padding: 1.15rem 1.15rem 1.25rem;
  border-radius: 16px;
  background: var(--bb-surface-lowest);
  border: 1px solid var(--bb-border);
}
.pop-infographic__head {
  margin-bottom: 1.1rem;
  max-width: 44rem;
}
.pop-infographic__eyebrow {
  margin: 0 0 0.35rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--bb-muted);
}
.pop-infographic__title {
  margin: 0 0 0.5rem;
  font-family: var(--bb-font-headline), system-ui, sans-serif;
  font-size: clamp(1.35rem, 3.2vw, 1.85rem);
  font-weight: 800;
  line-height: 1.15;
  color: var(--bb-text);
}
.pop-infographic__lede {
  margin: 0;
  font-size: 0.92rem;
  line-height: 1.55;
  color: var(--bb-muted);
}
.pop-treemap-figure {
  margin: 0;
  width: 100%;
  max-width: 56rem;
}
.pop-treemap__summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.65rem;
  margin-bottom: 0.85rem;
}
.pop-treemap__stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.15rem;
  margin: 0;
  padding: 0.75rem 0.55rem;
  border-radius: 12px;
  background: var(--bb-secondary-container);
  border: 1px solid var(--bb-outline);
  color: var(--bb-text);
  text-align: center;
}
.pop-treemap__stat-label {
  font-size: 0.68rem;
  font-weight: 600;
  line-height: 1.25;
}
.pop-treemap__stat-value {
  font-family: var(--bb-font-headline), system-ui, sans-serif;
  font-size: clamp(1rem, 2.4vw, 1.35rem);
  font-weight: 800;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.pop-treemap__stat-unit {
  font-size: 0.68rem;
  font-weight: 600;
  line-height: 1.25;
}
.pop-treemap__map-shell {
  padding: 10px;
  border-radius: 14px;
  background: var(--bb-bg);
  border: 1px solid var(--bb-border);
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.pop-treemap__map {
  display: grid;
  /* Equal halves — children left, all other ages right (reference layout) */
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
  min-height: 26rem;
  min-width: min(100%, 36rem);
}
.pop-treemap__region {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  min-width: 0;
  padding: 0.65rem;
  border-radius: 12px;
}
.pop-treemap__region--children {
  background: color-mix(in srgb, #9ab89a 32%, var(--bb-surface-lowest));
  border: 1px solid color-mix(in srgb, #9ab89a 45%, var(--bb-outline));
}
.pop-treemap__region--young {
  background: color-mix(in srgb, #8fa9b8 32%, var(--bb-surface-lowest));
  border: 1px solid color-mix(in srgb, #8fa9b8 45%, var(--bb-outline));
}
.pop-treemap__region--teens {
  background: color-mix(in srgb, #c4a4b8 34%, var(--bb-surface-lowest));
  border: 1px solid color-mix(in srgb, #c4a4b8 48%, var(--bb-outline));
  justify-content: center;
}
.pop-treemap__region-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.pop-treemap__region--adults {
  background: color-mix(in srgb, #d4b896 36%, var(--bb-secondary-container));
  border: 1px solid color-mix(in srgb, #d4b896 50%, var(--bb-outline));
}
.pop-treemap__region-head {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  color: var(--bb-text);
}
.pop-treemap__region-head--solo {
  justify-content: center;
  min-height: 3.5rem;
}
.pop-treemap__region-kicker {
  font-family: var(--bb-font-headline), system-ui, sans-serif;
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.pop-treemap__region-count {
  font-family: var(--bb-font-headline), system-ui, sans-serif;
  font-size: clamp(1.05rem, 2.2vw, 1.45rem);
  font-weight: 800;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.pop-treemap__region-meta {
  font-size: 0.68rem;
  font-weight: 500;
  line-height: 1.35;
  opacity: 0.92;
}
.pop-treemap__children-stack {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-rows: var(--pop-fr-04, 1fr) var(--pop-fr-59, 1fr) var(--pop-fr-1014, 1fr);
  gap: 5px;
}
.pop-treemap__right {
  display: grid;
  grid-template-rows: var(--pop-young-fr, 1fr) var(--pop-teen-fr, 1fr) var(--pop-adults-fr, 1fr);
  gap: 8px;
  min-height: 0;
}
.pop-treemap__young-row,
.pop-treemap__adults-row {
  min-height: 3.5rem;
  display: grid;
  gap: 6px;
}
.pop-treemap__tile--child {
  border-color: color-mix(in srgb, var(--bb-text) 18%, transparent);
}
.pop-treemap__young-row {
  grid-template-columns: var(--pop-fr-2024, 1fr) var(--pop-fr-2529, 1fr);
}
.pop-treemap__adults-row {
  grid-template-columns: var(--pop-fr-3034, 1fr) var(--pop-fr-3539, 1fr) var(--pop-fr-40, 1fr);
}
.pop-treemap__tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-end;
  gap: 0.08rem;
  min-height: 2.75rem;
  padding: 0.45rem 0.55rem;
  margin: 0;
  border: 1px solid color-mix(in srgb, var(--bb-text) 14%, transparent);
  border-radius: 10px;
  font: inherit;
  text-align: left;
  color: var(--bb-text);
}
.pop-treemap__tile--rich {
  justify-content: center;
  padding: 0.5rem 0.55rem;
}
.pop-treemap__tile-age {
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1.2;
}
.pop-treemap__tile-hint {
  font-size: 0.62rem;
  font-weight: 500;
  line-height: 1.25;
  opacity: 0.88;
}
.pop-treemap__tile-count {
  margin-top: 0.15rem;
  font-family: var(--bb-font-headline), system-ui, sans-serif;
  font-size: 0.95rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.pop-treemap__tile-label {
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1.2;
}
.pop-treemap__tile-value {
  font-size: 0.82rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
}
.pop-treemap__guide {
  margin: 0.85rem 0 0;
  max-width: 42rem;
  font-size: 0.84rem;
  line-height: 1.55;
  color: var(--bb-muted);
}
.pop-infographic__data {
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--bb-border);
}
.pop-infographic__data-summary {
  font-family: var(--bb-font-headline), system-ui, sans-serif;
  font-weight: 700;
  font-size: 0.88rem;
  color: var(--bb-primary);
  cursor: pointer;
}
.pop-infographic__data-summary:hover {
  text-decoration: underline;
}
.pop-infographic__table {
  margin-top: 0.55rem;
  max-width: 100%;
}
.pop-infographic__table-caption {
  margin: 0.45rem 0 0;
}
@media (max-width: 520px) {
  .pop-treemap__summary {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 400px) {
  .pop-treemap__map {
    min-width: 34rem;
  }
}
/* Activity assistance — static lollipop chart */
.activity-infographic {
  padding: 1rem 1.1rem 1.15rem;
  border-radius: 14px;
  background: var(--bb-surface-lowest);
  border: 1px solid var(--bb-border);
}
.activity-infographic__data {
  margin-top: 1rem;
}
.activity-lollipop-figure {
  margin: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}
.activity-lollipop__scroll {
  width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
}
.activity-lollipop__scroll:focus-visible {
  outline: 2px solid var(--bb-focus-ring);
  outline-offset: 2px;
  border-radius: 8px;
}
.activity-lollipop__svg {
  display: block;
  width: min(920px, 100%);
  min-height: 26rem;
  max-width: 100%;
  height: auto;
  aspect-ratio: 920 / 540;
  overflow: visible;
}
@media (max-width: 820px) {
  .activity-infographic {
    padding: 0.75rem 0.45rem 1rem;
  }
  .activity-lollipop__scroll {
    margin: 0 -0.2rem;
    padding-bottom: 0.35rem;
  }
  .activity-lollipop__svg {
    width: max(42rem, calc(100vw - var(--bb-gutter) * 2 - 1.5rem));
    min-width: 42rem;
    min-height: 34rem;
    max-width: none;
    aspect-ratio: 920 / 540;
  }
}
@media (max-width: 480px) {
  .activity-lollipop__svg {
    min-width: 44rem;
    min-height: 38rem;
  }
}
.activity-infographic__table-wrap {
  margin-top: 0.55rem;
  border-radius: 12px;
  border: 1px solid var(--bb-border);
  background: var(--bb-bg);
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.activity-infographic__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.92rem;
  color: var(--bb-text);
  background: var(--bb-surface-lowest);
}
.activity-infographic__table thead th {
  padding: 0.55rem 0.75rem;
  font-family: var(--bb-font-headline), system-ui, sans-serif;
  font-weight: 600;
  font-size: 0.82rem;
  color: var(--bb-muted);
  text-align: left;
  border-bottom: 1px solid var(--bb-border);
}
.activity-infographic__table thead th.num {
  text-align: right;
}
.activity-infographic__table tbody th,
.activity-infographic__table tbody td {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--bb-border);
}
.activity-infographic__table tbody th {
  font-weight: 700;
}
.activity-infographic__table tbody tr:last-child th,
.activity-infographic__table tbody tr:last-child td {
  border-bottom: none;
}
.activity-infographic__table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.activity-infographic__swatch-head {
  width: 2rem;
}
.activity-infographic__swatch-cell {
  width: 2rem;
  vertical-align: middle;
}
.activity-infographic__row {
  cursor: pointer;
  transition: background 0.22s ease;
}
.activity-infographic__row:hover,
.activity-infographic__row--active {
  background: color-mix(in srgb, var(--bb-primary) 8%, transparent);
}
.activity-infographic__row--muted {
  opacity: 0.82;
  cursor: default;
}
.activity-lollipop__grid-line {
  stroke: rgba(26, 28, 25, 0.1);
  stroke-width: 1;
}
.activity-lollipop__axis {
  stroke: rgba(26, 28, 25, 0.22);
  stroke-width: 1.25;
}
.activity-lollipop__tick-label,
.activity-lollipop__x-label {
  fill: var(--bb-muted);
  font-size: 13px;
  font-family: var(--bb-font-body), system-ui, sans-serif;
}
.activity-lollipop__x-label {
  font-size: 14px;
  font-weight: 600;
}
.activity-lollipop__y-label {
  fill: var(--bb-text);
  font-size: 13px;
  font-family: var(--bb-font-body), system-ui, sans-serif;
  font-weight: 600;
}
.activity-lollipop__stick {
  stroke: #6b8a9a;
  stroke-width: 2.5;
  stroke-linecap: round;
}
.activity-lollipop__dot {
  fill: #e8914a;
  stroke: #b86f2e;
  stroke-width: 2;
}
.activity-lollipop__value {
  fill: var(--bb-text);
  font-size: 14px;
  font-family: var(--bb-font-headline), system-ui, sans-serif;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.pie-mini-table__dot--lollipop {
  background: #e8914a;
  border: 1px solid #b86f2e;
  border-radius: 50%;
  width: 0.5rem;
  height: 0.5rem;
}
</style>
