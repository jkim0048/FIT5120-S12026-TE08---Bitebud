<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchRestaurantDetails } from '../lib/restaurantsApi'
import { getBiteBudUserId } from '../composables/useUserId'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const error = ref('')
const details = ref<Awaited<ReturnType<typeof fetchRestaurantDetails>> | null>(null)
const placeId = computed(() => String(route.params.id || ''))
const userId = computed(() => getBiteBudUserId() ?? '')

const myReview = computed(() => {
  const uid = userId.value
  const all = details.value?.reviews
  if (!uid || !Array.isArray(all) || all.length === 0) return null
  const mine = all.filter((review) => review.userId === uid)
  if (!mine.length) return null
  // Pick the most recent.
  return [...mine].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null
})

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => String(x)).map((s) => s.trim()).filter(Boolean)
}

const myBestMealBlocks = computed(() => asStringArray(myReview.value?.bestMealBlocks))
const myBestTimesOfDay = computed(() => asStringArray(myReview.value?.bestTimesOfDay))
const myBestDaysOfWeek = computed(() => asStringArray(myReview.value?.bestDaysOfWeek))

const myBars = computed(() =>
  myReview.value
    ? [
        ['Noise', myReview.value.noiseRating],
        ['Music', myReview.value.musicRating],
        ['Light', myReview.value.lightRating],
        ['Crowds', myReview.value.crowdsRating],
        ['Smells', myReview.value.smellsRating],
      ]
    : [],
)

const mineOnlyView = computed(() => String(route.query.view || '') === 'mine')

const bars = computed(() =>
  details.value
    ? [
        ['Noise', details.value.summary.noiseRating],
        ['Music', details.value.summary.musicRating],
        ['Light', details.value.summary.lightRating],
        ['Crowds', details.value.summary.crowdsRating],
        ['Smells', details.value.summary.smellsRating],
      ]
    : [],
)

async function load() {
  loading.value = true
  error.value = ''
  try {
    details.value = await fetchRestaurantDetails(placeId.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load review rating'
  } finally {
    loading.value = false
  }
}

function toRate() {
  const returnToPath = String(route.query.returnToPath || '')
  void router.push({
    name: 'restaurantRate',
    params: { id: placeId.value },
    query: { returnTo: 'restaurantReviewDetail', ...(returnToPath ? { returnToPath } : {}) },
  })
}

function toBack() {
  const returnToPath = String(route.query.returnToPath || '')
  if (returnToPath) {
    void router.push(returnToPath)
    return
  }
  void router.push({ name: 'restaurantSearch' })
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="page">
    <h1>Review rating</h1>
    <p v-if="loading">Loading sensory summary...</p>
    <p v-if="error" class="error">{{ error }}</p>
    <article v-if="details" class="card">
      <h2>{{ details.place.name }}</h2>
      <p>{{ details.place.address ?? details.place.displayName }}</p>
      <template v-if="!mineOnlyView">
        <p class="meta">
          Overall {{ details.summary.overallRating.toFixed(1) }}/5 · {{ details.summary.reviewCount }} reviews ·
          {{ details.summary.comfortBadge }}
        </p>
        <div class="bars">
          <div v-for="[label, value] in bars" :key="label" class="bar-row">
            <span>{{ label }}</span>
            <div class="bar"><div class="fill" :style="{ width: `${(Number(value) / 5) * 100}%` }" /></div>
            <strong>{{ Number(value).toFixed(1) }}</strong>
          </div>
        </div>
        <p class="meta">
          Best time tags: {{ details.summary.recentBestTimesOfDay.join(', ') || 'No tags yet' }}
        </p>
      </template>

      <section v-if="myReview" class="your-review">
        <h3>Your review</h3>
        <p class="meta">Overall {{ myReview.overallRating.toFixed(1) }}/5 · saved {{ new Date(myReview.createdAt).toLocaleDateString() }}</p>
        <div class="bars">
          <div v-for="[label, value] in myBars" :key="`mine-${label}`" class="bar-row">
            <span>{{ label }}</span>
            <div class="bar"><div class="fill fill--mine" :style="{ width: `${(Number(value) / 5) * 100}%` }" /></div>
            <strong>{{ Number(value).toFixed(1) }}</strong>
          </div>
        </div>
        <div class="tag-grid">
          <div class="tag-row">
            <span class="tag-label">Meal</span>
            <div class="tag-pills">
              <span v-for="t in myBestMealBlocks" :key="`meal-${t}`" class="pill">{{ t }}</span>
              <span v-if="myBestMealBlocks.length === 0" class="pill pill--muted">None</span>
            </div>
          </div>
          <div class="tag-row">
            <span class="tag-label">Time</span>
            <div class="tag-pills">
              <span v-for="t in myBestTimesOfDay" :key="`tod-${t}`" class="pill">{{ t }}</span>
              <span v-if="myBestTimesOfDay.length === 0" class="pill pill--muted">None</span>
            </div>
          </div>
          <div class="tag-row">
            <span class="tag-label">Days</span>
            <div class="tag-pills">
              <span v-for="t in myBestDaysOfWeek" :key="`dow-${t}`" class="pill">{{ t }}</span>
              <span v-if="myBestDaysOfWeek.length === 0" class="pill pill--muted">None</span>
            </div>
          </div>
        </div>
      </section>

      <div class="actions">
        <button class="bb-btn bb-btn--secondary" type="button" @click="toBack">Back</button>
        <button class="bb-btn bb-btn--primary" type="button" @click="toRate">
          {{ (myReview || details.summary.userHasReview) ? 'Edit rating' : 'Rate this place' }}
        </button>
      </div>
    </article>
  </section>
</template>

<style scoped>
.page { max-width: 26rem; margin: 0 auto; padding: 1rem; display: grid; gap: 0.8rem; }
h1 { margin: 0; color: var(--bb-primary); font-family: var(--bb-font-headline); }
.error { margin: 0; color: #b42318; }
.card { border: 1px solid var(--bb-border); background: var(--bb-surface-low); border-radius: 14px; padding: 0.95rem; display: grid; gap: 0.5rem; }
h2 { margin: 0; }
p { margin: 0; }
.meta { color: var(--bb-muted); }
.bars { display: grid; gap: 0.45rem; margin-top: 0.4rem; }
.bar-row { display: grid; grid-template-columns: 75px 1fr 34px; gap: 0.55rem; align-items: center; }
.bar { height: 10px; background: var(--bb-surface-high); border-radius: 999px; overflow: hidden; }
.fill { height: 100%; background: var(--bb-accent); }
.fill--mine { background: var(--bb-primary); }
.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 0.55rem; margin-top: 0.35rem; }
.your-review { border-top: 1px solid var(--bb-border); padding-top: 0.7rem; display: grid; gap: 0.45rem; }
.your-review h3 { margin: 0; font-size: 0.95rem; color: var(--bb-primary); font-family: var(--bb-font-headline); }
.tag-grid { display: grid; gap: 0.35rem; }
.tag-row { display: grid; grid-template-columns: 60px 1fr; gap: 0.5rem; align-items: start; }
.tag-label { font-weight: 700; font-size: 0.85rem; color: var(--bb-muted); }
.tag-pills { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.pill { border: 1px solid var(--bb-border); background: var(--bb-surface-lowest); border-radius: 999px; padding: 0.2rem 0.5rem; font-size: 0.8rem; }
.pill--muted { color: var(--bb-muted); }
</style>
