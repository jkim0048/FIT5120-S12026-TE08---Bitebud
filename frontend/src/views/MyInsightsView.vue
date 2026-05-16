<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { apiFetch } from '../lib/api'
import { useSession } from '../composables/useSession'
import { useSettings } from '../composables/useSettings'

type InsightCard = {
  id: string
  category: string
  headline: string
  detail: string
  recordCount: number
  takeaway?: string
}

type InsightsResponse = {
  range: { from: string; to: string }
  progress: {
    calendar: Array<{ date: string; recipes: number; dining: number }>
    weeklyBars: Array<{ weekStart: string; recipes: number; dining: number }>
    typeBreakdown: { recipes: number; dining: number }
  }
  cooking: { works: InsightCard[]; doesntWork: InsightCard[] }
  dining: { works: InsightCard[]; doesntWork: InsightCard[] }
  thresholds: {
    cooking: { have: number; need: 3 },
    dining: { have: number; need: 2 },
    progress: { have: number; need: 3 },
    cookingLowRated: { have: number; need: 3 },
    diningLowRated: { have: number; need: 3 },
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

/** Older APIs may omit `doesntWork`; missing fields would crash the template. */
function normalizeInsightsResponse(raw: InsightsResponse): InsightsResponse {
  const cooking = raw.cooking ?? { works: [], doesntWork: [] }
  const dining = raw.dining ?? { works: [], doesntWork: [] }
  const th = raw.thresholds
  const thresholds: InsightsResponse['thresholds'] = {
    cooking: th?.cooking ?? { have: 0, need: 3 },
    dining: th?.dining ?? { have: 0, need: 2 },
    progress: th?.progress ?? { have: 0, need: 3 },
    cookingLowRated: th?.cookingLowRated ?? { have: 0, need: 3 },
    diningLowRated: th?.diningLowRated ?? { have: 0, need: 3 },
  }
  return {
    ...raw,
    thresholds,
    cooking: {
      works: Array.isArray(cooking.works) ? cooking.works : [],
      doesntWork: Array.isArray(cooking.doesntWork) ? cooking.doesntWork : [],
    },
    dining: {
      works: Array.isArray(dining.works) ? dining.works : [],
      doesntWork: Array.isArray(dining.doesntWork) ? dining.doesntWork : [],
    },
  }
}

const router = useRouter()
const { userId, isSignedIn } = useSession()
const { settings } = useSettings()
const loading = ref(false)
const error = ref('')
const data = ref<InsightsResponse | null>(null)

function isoToPretty(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return iso
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

const cookingWorksUnlocked = computed(
  () => (data.value?.thresholds.cooking.have ?? 0) >= (data.value?.thresholds.cooking.need ?? 3),
)
const cookingDoesntWorkUnlocked = computed(() => cookingWorksUnlocked.value)
const diningWorksUnlocked = computed(
  () => (data.value?.thresholds.dining.have ?? 0) >= (data.value?.thresholds.dining.need ?? 2),
)

/** Unlocked cooking insights but no “works” cards yet — show friendly still-learning block. */
const cookingWorksStillLearning = computed(() => {
  if (!data.value || !cookingWorksUnlocked.value || data.value.cooking.works.length > 0) return false
  return true
})

/** Enough rated recipes, but fewer than 3 with stars ≤3 — friendly still-learning for watch-outs. */
const cookingDoesntWorkInsufficientLowRated = computed(() => {
  const d = data.value
  if (!d) return false
  if (d.thresholds.cooking.have < d.thresholds.cooking.need) return false
  if (d.cooking.doesntWork.length > 0) return false
  return d.thresholds.cookingLowRated.have < d.thresholds.cookingLowRated.need
})

const cookingDoesntWorkEmptyMessage = computed(() => {
  if (!data.value || !cookingDoesntWorkUnlocked.value || data.value.cooking.doesntWork.length > 0) return ''
  const { have, need } = data.value.thresholds.cookingLowRated
  if (have < need) return ''
  return `You already have ${have} lower-rated meals here, but none of the repeat patterns (for example very long recipes, very large ingredient lists, or repeated “didn’t work” tags) crossed the bar for a card yet.`
})

const diningWorksEmptyMessage = computed(() => {
  if (!data.value || !diningWorksUnlocked.value || data.value.dining.works.length > 0) return ''
  return "Let's keep dining out — BiteBud is still learning what tends to suit you."
})

/** Enough dining reviews in range, but fewer than 3 with overall ≤3 — show friendly “still learning” block. */
const diningDoesntWorkInsufficientLowRated = computed(() => {
  const d = data.value
  if (!d) return false
  if (d.thresholds.dining.have < d.thresholds.dining.need) return false
  return d.thresholds.diningLowRated.have < d.thresholds.diningLowRated.need
})

const diningDoesntWorkEmptyMessage = computed(() => {
  if (!data.value || !diningWorksUnlocked.value || data.value.dining.doesntWork.length > 0) return ''
  const { have, need } = data.value.thresholds.diningLowRated
  if (have < need) return ''
  return `You already have ${have} lower-rated reviews here, but none of the repeat patterns (for example sensory mismatch or the same cuisine on low scores) crossed the bar for a card yet.`
})

const insightsNoActivityYet = computed(
  () => (data.value?.thresholds.progress.have ?? 0) === 0,
)

/** Enough low-rated data to analyse watch-outs, but API returned zero negative cards */
const cookingDoesntWorkNothingToAvoid = computed(() => {
  const d = data.value
  if (!d || !cookingWorksUnlocked.value) return false
  if (d.cooking.doesntWork.length > 0) return false
  return d.thresholds.cookingLowRated.have >= d.thresholds.cookingLowRated.need
})

const diningDoesntWorkNothingToAvoid = computed(() => {
  const d = data.value
  if (!d || !diningWorksUnlocked.value) return false
  if (d.dining.doesntWork.length > 0) return false
  return d.thresholds.diningLowRated.have >= d.thresholds.diningLowRated.need
})

function pctPart(have: number, need: number): number {
  if (need <= 0) return 0
  return Math.min(100, Math.round((have / need) * 100))
}

/** Total insight cards returned for this range (real API counts). */
const patternsFoundCount = computed(() => {
  const d = data.value
  if (!d) return 0
  return (
    d.cooking.works.length +
    d.cooking.doesntWork.length +
    d.dining.works.length +
    d.dining.doesntWork.length
  )
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
  return d.dining.works.length + d.dining.doesntWork.length
})

/** Extra line under the headline; omit when empty or identical to headline. */
function insightCardDetail(card: InsightCard): string {
  const detail = card.detail?.trim() ?? ''
  if (!detail) return ''
  if (detail === card.headline.trim()) return ''
  return detail
}

const INSIGHT_CATEGORY_LABELS: Record<string, string> = {
  'ingredient-count': 'Recipe size',
  'prep-time': 'Cook time',
  'worked-tag': 'Your tags',
  'didnt-work-tag': 'Your tags',
  'ingredient-affinity': 'Ingredients',
  'time-of-week': 'When you cook',
  flavour: 'Flavours',
  'cooking-method': 'Cooking style',
  'sensory-match': 'Noise & vibe',
  'sensory-mismatch': 'Noise & vibe',
  cuisine: 'Cuisine',
  'cuisine-mismatch': 'Cuisine',
  'best-windows': 'Best times',
}

function insightCategoryLabel(category: string): string {
  return INSIGHT_CATEGORY_LABELS[category] ?? 'Pattern'
}

/** Matches how `recordCount` is produced in insightsService — see category when reading API. */
function insightRecordCountLabel(category: string, n: number): string {
  if (category === 'worked-tag' || category === 'didnt-work-tag') {
    return n === 1 ? 'time' : 'times'
  }
  if (
    category === 'sensory-match' ||
    category === 'sensory-mismatch' ||
    category === 'cuisine' ||
    category === 'cuisine-mismatch'
  ) {
    return n === 1 ? 'review' : 'reviews'
  }
  if (category === 'best-windows') {
    return n === 1 ? 'pick' : 'picks'
  }
  return n === 1 ? 'rated completion' : 'rated completions'
}

/** Top meta line, e.g. INGREDIENTS · 4 rated completions */
function insightCardMetaLine(card: InsightCard): string {
  const label = insightCategoryLabel(card.category).toUpperCase()
  const n = card.recordCount
  const suffix = insightRecordCountLabel(card.category, n)
  return `${label} · ${n} ${suffix}`
}

const MELBOURNE_ISO_CALENDAR = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Australia/Melbourne',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Melbourne “today” for display (aligned with insight range ending on this calendar day). */
const insightsMelbourneTodayPretty = computed(() => {
  const iso = MELBOURNE_ISO_CALENDAR.format(new Date())
  return isoToPretty(iso)
})

function insightCardTakeaway(card: InsightCard): string {
  return card.takeaway?.trim() ?? ''
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
    const url = `/api/me/insights`
    const payload = await apiFetch<InsightsResponse>(url, {
      headers: { 'X-User-Id': userId.value },
    })
    data.value = normalizeInsightsResponse(payload)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load'
  } finally {
    loading.value = false
  }
}

watch(
  () => [userId.value, isSignedIn.value],
  () => {
    if (!isSignedIn.value || !userId.value) return
    void load()
  },
  { immediate: true },
)

</script>

<template>
  <section class="page">
    <p class="page-back">
      <RouterLink class="page-back-link" :to="{ name: 'home' }">Back to home</RouterLink>
    </p>
    <header class="assign-head">
      <div class="assign-head__brand">
        <h1 class="assign-head__h1">See my patterns</h1>
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

    <p v-if="loading" class="sr-only">Loading patterns</p>
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
            <span class="assign-summary__lbl">{{ insightsNoActivityYet ? 'Available' : 'Categories' }}</span>
          </div>
          <div class="assign-summary__item">
            <span class="assign-summary__num">{{ completionsInRange }}</span>
            <span class="assign-summary__lbl">Completions</span>
          </div>
        </section>

        <p class="assign-period-caption">{{ insightsMelbourneTodayPretty }}</p>

        <div v-if="insightsNoActivityYet" class="insights-onboarding">
          <p class="insights-onboarding__lead">
            Complete and rate at least {{ data.thresholds.cooking.need }} recipes and leave
            {{ data.thresholds.dining.need }} restaurant reviews to unlock patterns.
          </p>
          <div class="insights-onboarding__track" aria-hidden="true">
            <div class="insights-onboarding__fill" style="width: 0%" />
          </div>
          <article class="onboard-panel onboard-panel--cook">
            <h3 class="onboard-panel__h">Cooking</h3>
            <p class="onboard-panel__text">
              Your cooking patterns will appear after you finish and rate
              {{ data.thresholds.cooking.need }} recipes—we look at ingredients, tags, timing, and more.
            </p>
            <div class="onboard-panel__actions">
              <RouterLink class="onboard-panel__btn primary" :to="{ name: 'home' }">Cook a recipe</RouterLink>
            </div>
          </article>
          <article class="onboard-panel onboard-panel--dine">
            <h3 class="onboard-panel__h">Dining</h3>
            <p class="onboard-panel__text">
              Add {{ data.thresholds.dining.need }} restaurant reviews to unlock dining patterns (noise,
              cuisine, and best times).
            </p>
            <div class="onboard-panel__actions">
              <RouterLink class="onboard-panel__btn primary" :to="{ name: 'restaurantSearch' }">
                Find restaurants
              </RouterLink>
            </div>
          </article>
        </div>

        <template v-else>
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
          <div v-else-if="cookingWorksStillLearning" class="assign-empty" role="status">
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
              Keep cooking — patterns will appear here as you complete more recipes.
            </p>
          </div>
          <div v-else class="assign-card-list">
            <article v-for="c in data.cooking.works" :key="c.id" class="assign-card">
              <div class="assign-card__main">
                <p class="assign-card__meta">{{ insightCardMetaLine(c) }}</p>
                <h4 class="assign-card__slug">{{ c.headline }}</h4>
                <p v-if="insightCardDetail(c)" class="assign-card__detail">{{ insightCardDetail(c) }}</p>
                <p v-if="insightCardTakeaway(c)" class="assign-card__takeaway">{{ insightCardTakeaway(c) }}</p>
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
              <div class="assign-card__main">
                <p class="assign-card__meta">{{ insightCardMetaLine(c) }}</p>
                <h4 class="assign-card__slug">{{ c.headline }}</h4>
                <p v-if="insightCardDetail(c)" class="assign-card__detail">{{ insightCardDetail(c) }}</p>
                <p v-if="insightCardTakeaway(c)" class="assign-card__takeaway">{{ insightCardTakeaway(c) }}</p>
                <span class="assign-chip assign-chip--cook-warn">Watch-out</span>
              </div>
            </article>
          </div>
          <article
            v-else-if="cookingDoesntWorkInsufficientLowRated"
            class="assign-watch-pending"
            role="status"
          >
            <p class="assign-watch-pending__title">Still building your picture…</p>
            <p class="assign-watch-pending__text">
              Watch-outs need at least {{ data.thresholds.cookingLowRated.need }} recipe completions rated 3 stars or
              below in this period.
            </p>
            <div class="assign-watch-pending__bar" role="progressbar" :aria-valuenow="data.thresholds.cookingLowRated.have" :aria-valuemax="data.thresholds.cookingLowRated.need" aria-label="Lower-rated completions progress">
              <div
                class="assign-watch-pending__fill"
                :style="{ width: `${pctPart(data.thresholds.cookingLowRated.have, data.thresholds.cookingLowRated.need)}%` }"
              />
            </div>
            <p class="assign-watch-pending__foot">
              {{ data.thresholds.cookingLowRated.have }} of {{ data.thresholds.cookingLowRated.need }} lower‑rated
              completions
            </p>
          </article>
          <article v-else-if="cookingDoesntWorkNothingToAvoid" class="assign-watch-positive">
            <p class="assign-watch-positive__title">Nothing to avoid — you&apos;re doing well</p>
            <p class="assign-watch-positive__text">
              We checked your lower-rated meals in this range and didn&apos;t find a strong repeat signal. Keep
              cooking and rating to keep this fresh.
            </p>
          </article>
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
            <p class="assign-empty__title">No watch-outs in this range.</p>
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
              <div class="assign-card__main">
                <p class="assign-card__meta">{{ insightCardMetaLine(c) }}</p>
                <h4 class="assign-card__slug">{{ c.headline }}</h4>
                <p v-if="insightCardDetail(c)" class="assign-card__detail">{{ insightCardDetail(c) }}</p>
                <p v-if="insightCardTakeaway(c)" class="assign-card__takeaway">{{ insightCardTakeaway(c) }}</p>
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
          <div v-if="data.thresholds.dining.have < data.thresholds.dining.need" class="assign-guidance">
            After {{ data.thresholds.dining.need - data.thresholds.dining.have }}
            {{ data.thresholds.dining.need - data.thresholds.dining.have === 1 ? 'more restaurant review' : 'more restaurant reviews' }},
            I can show you which places tend to suit you best.
          </div>
          <div v-else-if="data.dining.doesntWork.length" class="assign-card-list">
            <article v-for="c in data.dining.doesntWork" :key="c.id" class="assign-card">
              <div class="assign-card__main">
                <p class="assign-card__meta">{{ insightCardMetaLine(c) }}</p>
                <h4 class="assign-card__slug">{{ c.headline }}</h4>
                <p v-if="insightCardDetail(c)" class="assign-card__detail">{{ insightCardDetail(c) }}</p>
                <p v-if="insightCardTakeaway(c)" class="assign-card__takeaway">{{ insightCardTakeaway(c) }}</p>
                <span class="assign-chip assign-chip--cook-warn">Watch-out</span>
              </div>
            </article>
          </div>
          <article
            v-else-if="diningDoesntWorkInsufficientLowRated"
            class="assign-watch-pending assign-watch-pending--dine"
            role="status"
          >
            <p class="assign-watch-pending__title">Still building your picture…</p>
            <p class="assign-watch-pending__text">
              Watch-outs need at least {{ data.thresholds.diningLowRated.need }} restaurant reviews with overall rating
              3 stars or below in this period.
            </p>
            <div class="assign-watch-pending__bar" role="progressbar" :aria-valuenow="data.thresholds.diningLowRated.have" :aria-valuemax="data.thresholds.diningLowRated.need" aria-label="Lower-rated reviews progress">
              <div
                class="assign-watch-pending__fill"
                :style="{ width: `${pctPart(data.thresholds.diningLowRated.have, data.thresholds.diningLowRated.need)}%` }"
              />
            </div>
            <p class="assign-watch-pending__foot">
              {{ data.thresholds.diningLowRated.have }} of {{ data.thresholds.diningLowRated.need }} lower‑rated reviews
            </p>
          </article>
          <article v-else-if="diningDoesntWorkNothingToAvoid" class="assign-watch-positive">
            <p class="assign-watch-positive__title">Nothing to avoid — you&apos;re doing well</p>
            <p class="assign-watch-positive__text">
              We checked your lower-rated dining reviews here and didn&apos;t find a strong repeat signal yet.
            </p>
          </article>
          <div v-else class="assign-empty assign-empty--dine">
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
            <p class="assign-empty__title">No watch-outs in this range.</p>
            <p class="assign-empty__text">{{ diningDoesntWorkEmptyMessage }}</p>
          </div>
        </section>
        </template>
      </div>
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
.assign-period-caption {
  margin: -0.15rem 0 0.65rem;
  text-align: center;
  font-size: 0.84rem;
  font-weight: 700;
  color: var(--assign-navy);
}

.insights-onboarding__lead {
  margin: 0 0 0.85rem;
  padding: 0.75rem 0.85rem;
  border-radius: 14px;
  font-size: 0.82rem;
  line-height: 1.45;
  color: var(--bb-text);
  background: color-mix(in srgb, var(--assign-navy) 8%, white);
}
.insights-onboarding__track {
  height: 5px;
  border-radius: 999px;
  background: rgba(26, 45, 66, 0.1);
  margin-bottom: 1rem;
  overflow: hidden;
}
.insights-onboarding__fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--assign-dine-icon), var(--assign-navy));
  opacity: 0.85;
}

.onboard-panel {
  border-radius: 16px;
  padding: 1rem 0.85rem;
  margin-bottom: 0.85rem;
  border: 1px solid #e8e2d8;
  background: #fffefb;
  box-shadow: 0 2px 12px rgba(30, 25, 20, 0.05);
}
.onboard-panel--cook {
  border-top: 3px solid var(--assign-cook-icon);
}
.onboard-panel--dine {
  border-top: 3px solid var(--assign-dine-icon);
}
.onboard-panel__h {
  margin: 0 0 0.45rem;
  font-size: 1.08rem;
  font-weight: 800;
  color: var(--assign-navy);
}
.onboard-panel__text {
  margin: 0 0 0.85rem;
  font-size: 0.82rem;
  line-height: 1.45;
  color: var(--bb-text);
}
.onboard-panel__actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.onboard-panel__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.55rem 0.95rem;
  border-radius: 999px;
  font-size: 0.82rem;
  font-weight: 700;
  text-decoration: none;
  border: 1.5px solid var(--assign-navy);
}
.onboard-panel__btn.primary {
  background: var(--assign-navy);
  color: #fff;
}

.assign-watch-pending {
  padding: 0.92rem 0.88rem;
  border-radius: 14px;
  border: 2px dashed rgba(74, 85, 104, 0.35);
  background: color-mix(in srgb, #f1f5f9 70%, white);
}
.assign-watch-pending__title {
  margin: 0 0 0.38rem;
  font-size: 0.93rem;
  font-weight: 800;
  color: var(--assign-navy);
}
.assign-watch-pending__text {
  margin: 0 0 0.65rem;
  font-size: 0.79rem;
  line-height: 1.42;
  color: var(--bb-muted);
}
.assign-watch-pending__bar {
  height: 6px;
  border-radius: 999px;
  background: rgba(26, 45, 66, 0.1);
  overflow: hidden;
  margin-bottom: 0.4rem;
}
.assign-watch-pending__fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--assign-cook-icon), var(--assign-navy));
}
.assign-watch-pending__foot {
  margin: 0;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--bb-text);
  font-variant-numeric: tabular-nums;
}
.assign-watch-positive {
  padding: 0.92rem 0.88rem;
  border-radius: 14px;
  border: 2px solid color-mix(in srgb, var(--assign-green) 45%, #c8ebd4);
  background: color-mix(in srgb, var(--assign-green) 9%, white);
}
.assign-watch-positive__title {
  margin: 0 0 0.38rem;
  font-size: 0.95rem;
  font-weight: 800;
  color: #166534;
}
.assign-watch-positive__text {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.42;
  color: var(--bb-text);
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
}
.assign-card__meta {
  margin: 0 0 0.35rem;
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--bb-muted);
}
.assign-card__type {
  display: inline-block;
  margin: 0 0 0.35rem;
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--bb-muted);
}
.assign-card__slug {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 800;
  letter-spacing: 0.01em;
  color: var(--assign-navy);
  line-height: 1.3;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  overflow: hidden;
}
.assign-card__detail {
  margin: 0.28rem 0 0.42rem;
  font-size: 0.78rem;
  line-height: 1.45;
  color: var(--bb-muted);
}
.assign-card__takeaway {
  margin: 0 0 0.5rem;
  font-size: 0.78rem;
  line-height: 1.45;
  color: color-mix(in srgb, var(--bb-text) 78%, var(--bb-muted));
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
</style>

