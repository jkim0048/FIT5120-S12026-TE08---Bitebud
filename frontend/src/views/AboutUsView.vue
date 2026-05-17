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

/** Which slice is enlarged / table row highlighted (population pie). */
const populationPieHover = ref<string | null>(null)
/** Which slice is enlarged / table row highlighted (meal-prep pie). */
const mealPrepPieHover = ref<string | null>(null)
/** Which slice is enlarged / table row highlighted (activity assistance pie). */
const activityPieHover = ref<string | null>(null)

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

type PieSlice = {
  label: string
  valueThousands: number
  valuePersons: number
  color: string
  pct: number
  path: string
  hoverTitle: string
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

function buildMealPrepPie2022(rows: AboutMealPrepAgeRow[]): PieSlice[] {
  const entries = rows.map((row, i) => {
    const raw = row.estimate2022
    const v = raw == null || Number.isNaN(Number(raw)) ? 0 : Number(raw)
    return {
      label: row.ageGroup,
      valueThousands: v,
      valuePersons: v * 1000,
      color: ND_SLICE_COLORS[i % ND_SLICE_COLORS.length],
    }
  })
  const sum = entries.reduce((s, e) => s + e.valueThousands, 0)
  if (sum <= 0) return []

  const cx = 100
  const cy = 100
  const r = 88
  let angle = -Math.PI / 2

  return entries
    .filter((e) => e.valueThousands > 0)
    .map((e) => {
      const sweep = (e.valueThousands / sum) * Math.PI * 2
      const start = angle
      const end = angle + sweep
      angle = end
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
      }
    })
}

/** Rows that contribute to the activity pie (excludes survey summary lines). */
function isActivityPieDataRow(row: AboutActivityRow): boolean {
  const a = row.activity
  if (a.startsWith('Total')) return false
  if (a.startsWith('Need assistance')) return false
  if (a.startsWith('Does not need')) return false
  return true
}

function buildActivityAssistancePie(rows: AboutActivityRow[]): PieSlice[] {
  const pieRows = rows.filter(isActivityPieDataRow)
  const entries = pieRows.map((row, i) => {
    const raw = row.totalEstimateThousands
    const v = raw == null || Number.isNaN(Number(raw)) ? 0 : Number(raw)
    return {
      label: row.activity,
      valueThousands: v,
      valuePersons: v * 1000,
      color: ND_SLICE_COLORS[i % ND_SLICE_COLORS.length],
    }
  })
  const sum = entries.reduce((s, e) => s + e.valueThousands, 0)
  if (sum <= 0) return []

  const cx = 100
  const cy = 100
  const r = 88
  let angle = -Math.PI / 2

  return entries
    .filter((e) => e.valueThousands > 0)
    .map((e) => {
      const sweep = (e.valueThousands / sum) * Math.PI * 2
      const start = angle
      const end = angle + sweep
      angle = end
      const pct = (e.valueThousands / sum) * 100
      const hoverTitle = `${e.label}: ${e.valuePersons.toLocaleString('en-AU')} people (${pct.toFixed(1)}% of combined activity-type estimates)`
      return {
        label: e.label,
        valueThousands: e.valueThousands,
        valuePersons: e.valuePersons,
        color: e.color,
        pct,
        path: pieSlicePath(cx, cy, r, start, end),
        hoverTitle,
      }
    })
}

function buildPopulationPie2022(rows: AboutPopulationByAgeRow[]): PieSlice[] {
  const ageRows = rows.filter((r) => !r.isTotalRow)
  const entries = ageRows.map((row, i) => {
    const raw = row.estimate2022
    const v = raw == null || Number.isNaN(Number(raw)) ? 0 : Number(raw)
    return {
      label: row.ageGroup,
      valueThousands: v,
      valuePersons: v * 1000,
      color: ND_SLICE_COLORS[i % ND_SLICE_COLORS.length],
    }
  })
  const sum = entries.reduce((s, e) => s + e.valueThousands, 0)
  if (sum <= 0) return []

  const cx = 100
  const cy = 100
  const r = 88
  let angle = -Math.PI / 2

  return entries
    .filter((e) => e.valueThousands > 0)
    .map((e) => {
      const sweep = (e.valueThousands / sum) * Math.PI * 2
      const start = angle
      const end = angle + sweep
      angle = end
      const pct = (e.valueThousands / sum) * 100
      const hoverTitle = `${e.label}: ${e.valuePersons.toLocaleString('en-AU')} people (${pct.toFixed(1)}% of 2022 autistic population by age)`
      return {
        label: e.label,
        valueThousands: e.valueThousands,
        valuePersons: e.valuePersons,
        color: e.color,
        pct,
        path: pieSlicePath(cx, cy, r, start, end),
        hoverTitle,
      }
    })
}

const population2022Pie = computed(() => {
  const rows = stats.value?.populationByAge
  if (!rows?.length) return null
  const slices = buildPopulationPie2022(rows)
  const totalThousands = slices.reduce((s, sl) => s + sl.valueThousands, 0)
  const totalPersons = totalThousands * 1000
  const ariaLabel =
    slices.length === 0
      ? '2022 population by age: no data'
      : `2022 autistic population by age group: ${slices
          .map((s) => `${s.label} ${s.valuePersons.toLocaleString('en-AU')} people, ${s.pct.toFixed(1)} per cent`)
          .join('; ')}`
  return { slices, totalPersons, ariaLabel }
})

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

const activityAssistancePie = computed(() => {
  const rows = stats.value?.activityAssistance
  if (!rows?.length) return null
  const slices = buildActivityAssistancePie(rows)
  const ariaLabel =
    slices.length === 0
      ? 'Assistance by activity: no data'
      : `Share of combined activity-type assistance estimates: ${slices
          .map((s) => `${s.label} ${s.pct.toFixed(1)} per cent`)
          .join('; ')}`
  return { slices, ariaLabel }
})

/** Draw hovered slice last so it paints on top when scaled. */
const populationSlicesDisplay = computed(() => {
  const pie = population2022Pie.value
  if (!pie?.slices.length) return []
  const h = populationPieHover.value
  if (!h) return pie.slices
  const hi = pie.slices.find((s) => s.label === h)
  const rest = pie.slices.filter((s) => s.label !== h)
  return hi ? [...rest, hi] : pie.slices
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

const activitySlicesDisplay = computed(() => {
  const pie = activityAssistancePie.value
  if (!pie?.slices.length) return []
  const h = activityPieHover.value
  if (!h) return pie.slices
  const hi = pie.slices.find((s) => s.label === h)
  const rest = pie.slices.filter((s) => s.label !== h)
  return hi ? [...rest, hi] : pie.slices
})

function populationSliceGroupStyle(slLabel: string): Record<string, string> {
  const hovered = populationPieHover.value === slLabel
  return {
    transformOrigin: '100px 100px',
    transform: hovered ? 'translate(100px, 100px) scale(1.06) translate(-100px, -100px)' : 'none',
    cursor: 'pointer',
  }
}

function mealPrepSliceGroupStyle(slLabel: string): Record<string, string> {
  const hovered = mealPrepPieHover.value === slLabel
  return {
    transformOrigin: '100px 100px',
    transform: hovered ? 'translate(100px, 100px) scale(1.06) translate(-100px, -100px)' : 'none',
    cursor: 'pointer',
  }
}

function activitySliceGroupStyle(slLabel: string): Record<string, string> {
  const hovered = activityPieHover.value === slLabel
  return {
    transformOrigin: '100px 100px',
    transform: hovered ? 'translate(100px, 100px) scale(1.06) translate(-100px, -100px)' : 'none',
    cursor: 'pointer',
  }
}

function onActivityTableRowEnter(activity: string): void {
  const pie = activityAssistancePie.value
  if (pie?.slices.some((s) => s.label === activity)) activityPieHover.value = activity
}

function activitySliceForLabel(label: string): PieSlice | undefined {
  return activityAssistancePie.value?.slices.find((s) => s.label === label)
}

function activityRowPersons(row: AboutActivityRow): number {
  const v = Number(row.totalEstimateThousands)
  if (!Number.isFinite(v)) return 0
  return Math.round(v * 1000)
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
        <div class="split">
          <figure class="figure">
            <img
              src="/about/supported-cooking.jpg"
              width="1024"
              height="583"
              alt="Illustration of a support person guiding someone at the stove with a visual recipe card on the counter."
              class="figure-img"
            />
          </figure>
          <div class="copy">
            <h2 id="supported-heading" class="h2">Supported cooking — helper guiding cooking</h2>
            <p class="prose">
              A common support method for autistic Australians learning meal preparation is a short co-cooking session, where a support
              worker or family member provides simple prompts and guidance while the person completes the cooking themselves to build
              independence and routine.
            </p>
          </div>
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

        <div class="table-block">
          <h3 id="pop-age-heading" class="h3">Autistic population distribution over different age group, 2022</h3>
          <p class="table-caption">
            Estimated autistic Australians by age band (survey values scaled from published thousands). Hover a slice or table row to
            enlarge that segment; tooltips show counts and shares.
          </p>
          <div v-if="population2022Pie" class="meal-prep-visual meal-prep-visual--calm pie-card-layout pie-card-layout--uniform">
            <div class="pie-card-layout__sidebar">
              <div class="pie-mini-table-scroll pie-mini-table-scroll--corner" @mouseleave="populationPieHover = null">
                <table class="pie-mini-table pie-mini-table--compact" @mouseleave="populationPieHover = null">
                  <thead>
                    <tr>
                      <th class="pie-mini-table__swatch-head" scope="col"><span class="visually-hidden">Colour</span></th>
                      <th scope="col">Age group</th>
                      <th scope="col" class="num">People (2022)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="sl in population2022Pie.slices"
                      :key="`pop-row-${sl.label}`"
                      class="pie-mini-table__row"
                      :class="{ 'pie-mini-table__row--active': populationPieHover === sl.label }"
                      @mouseenter="populationPieHover = sl.label"
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
                    viewBox="0 0 200 200"
                    role="img"
                    :aria-label="population2022Pie.ariaLabel"
                    @mouseleave="populationPieHover = null"
                  >
                    <template v-if="populationSlicesDisplay.length">
                      <g
                        v-for="sl in populationSlicesDisplay"
                        :key="sl.label"
                        class="pie-slice-group"
                        :style="populationSliceGroupStyle(sl.label)"
                        @mouseenter="populationPieHover = sl.label"
                      >
                        <path class="pie-slice-path" :d="sl.path" :fill="sl.color" stroke-width="1.15">
                          <title>{{ sl.hoverTitle }}</title>
                        </path>
                      </g>
                    </template>
                    <text v-else x="100" y="104" text-anchor="middle" class="pie-chart-card__empty">No data</text>
                  </svg>
                  <p class="pie-chart-card__total">Total: {{ fmtPersons(population2022Pie.totalPersons) }} people</p>
                </figure>
              </div>
            </div>
          </div>
        </div>

        <div class="table-block" aria-labelledby="activity-wise-heading">
          <h3 id="activity-wise-heading" class="h3">Activity wise assistance need by neurodivergent person</h3>
          <div
            v-if="activityAssistancePie && stats.activityAssistance.length"
            class="meal-prep-visual meal-prep-visual--calm pie-card-layout pie-card-layout--uniform pie-card-layout--activity"
          >
            <div class="pie-card-layout__sidebar">
              <div
                class="pie-mini-table-scroll pie-mini-table-scroll--corner pie-mini-table-scroll--activity-tall"
                @mouseleave="activityPieHover = null"
              >
                <table class="pie-mini-table pie-mini-table--compact pie-mini-table--activity" @mouseleave="activityPieHover = null">
                  <thead>
                    <tr>
                      <th class="pie-mini-table__swatch-head" scope="col"><span class="visually-hidden">Colour</span></th>
                      <th scope="col">Activity</th>
                      <th scope="col" class="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="row in stats.activityAssistance"
                      :key="row.activity"
                      class="pie-mini-table__row"
                      :class="{
                        'pie-mini-table__row--muted': !isActivityPieDataRow(row),
                        'pie-mini-table__row--active': activityPieHover === row.activity && isActivityPieDataRow(row),
                      }"
                      @mouseenter="onActivityTableRowEnter(row.activity)"
                    >
                      <td class="pie-mini-table__swatch-cell">
                        <span
                          v-if="activitySliceForLabel(row.activity)"
                          class="pie-mini-table__dot"
                          :style="{ background: activitySliceForLabel(row.activity)?.color }"
                          aria-hidden="true"
                        />
                      </td>
                      <th scope="row">{{ row.activity }}</th>
                      <td class="num">{{ fmtPersons(activityRowPersons(row)) }}</td>
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
                    viewBox="0 0 200 200"
                    role="img"
                    :aria-label="activityAssistancePie.ariaLabel"
                    @mouseleave="activityPieHover = null"
                  >
                    <template v-if="activitySlicesDisplay.length">
                      <g
                        v-for="sl in activitySlicesDisplay"
                        :key="sl.label"
                        class="pie-slice-group"
                        :style="activitySliceGroupStyle(sl.label)"
                        @mouseenter="activityPieHover = sl.label"
                      >
                        <path class="pie-slice-path" :d="sl.path" :fill="sl.color" stroke-width="1.15">
                          <title>{{ sl.hoverTitle }}</title>
                        </path>
                      </g>
                    </template>
                    <text v-else x="100" y="104" text-anchor="middle" class="pie-chart-card__empty">No data</text>
                  </svg>
                </figure>
              </div>
            </div>
          </div>
        </div>

        <div class="table-block">
          <h3 class="h3">Assistance required for Meal preparation distribution over different age group, 2022</h3>
          <p class="table-caption">
            Estimated people needing meal-prep assistance (survey values scaled from published thousands). Hover a slice or table row to
            enlarge that segment; tooltips show counts and shares.
          </p>
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
                    viewBox="0 0 200 200"
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
                      </g>
                    </template>
                    <text v-else x="100" y="104" text-anchor="middle" class="pie-chart-card__empty">No data</text>
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
.pie-card-layout--uniform .pie-card-layout__sidebar {
  max-width: min(22rem, 100%);
}
@media (max-width: 520px) {
  .pie-card-layout {
    grid-template-columns: 1fr;
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

.pie-charts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem 1.25rem;
  padding: 1.1rem 1rem 0.5rem;
}
.pie-charts--single {
  grid-template-columns: 1fr;
  justify-items: center;
  max-width: min(680px, 100%);
  margin: 0 auto;
  padding: 0.35rem 0.5rem 0.25rem;
}
.pie-chart-card {
  margin: 0;
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
  width: min(100%, 560px);
  max-width: min(100%, 560px);
  height: auto;
  margin: 0 auto;
  display: block;
  overflow: visible;
}
.pie-chart-card__total {
  margin: 0.55rem 0 0;
  font-size: 0.88rem;
  color: var(--bb-muted);
  font-variant-numeric: tabular-nums;
}
.pie-chart-card__empty {
  fill: var(--bb-muted);
  font-size: 14px;
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
</style>
