<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { getBiteBudUserId } from '../composables/useUserId'
import { apiFetch } from '../lib/api'

type MyRestaurantReviewRow = {
  place: {
    id: string
    name: string
    displayName: string
    address: string | null
    cuisine: string | null
    suburb: string | null
  }
  review: {
    id: string
    overallRating: number
    noiseRating: number
    musicRating: number
    lightRating: number
    crowdsRating: number
    smellsRating: number
    bestMealBlocks: string[]
    bestTimesOfDay: string[]
    bestDaysOfWeek: string[]
    createdAt: string
    updatedAt: string
  }
}

const router = useRouter()
const uid = computed(() => getBiteBudUserId() ?? '')
const loading = ref(false)
const error = ref('')
const rows = ref<MyRestaurantReviewRow[]>([])

async function load() {
  if (!uid.value) {
    rows.value = []
    error.value = ''
    loading.value = false
    return
  }
  loading.value = true
  error.value = ''
  try {
    const data = await apiFetch<{ reviews: MyRestaurantReviewRow[] }>('/api/restaurants/my-reviews', {
      headers: uid.value ? { 'X-User-Id': uid.value } : {},
    })
    rows.value = data.reviews ?? []
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load reviews'
  } finally {
    loading.value = false
  }
}

function openDetails(placeId: string) {
  const returnToPath = router.currentRoute.value.fullPath
  void router.push({ name: 'restaurantReviewDetail', params: { id: placeId }, query: { view: 'mine', returnToPath } })
}

function edit(placeId: string) {
  void router.push({ name: 'restaurantRate', params: { id: placeId }, query: { returnTo: 'restaurantMyReviews' } })
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="page">
    <p class="page-back">
      <RouterLink class="page-back-link" :to="{ name: 'restaurantSearch' }">Back to restaurant search</RouterLink>
    </p>
    <header class="hero">
      <h1>My restaurant reviews</h1>
      <p class="hint">Your saved ratings and best-time tags.</p>
    </header>

    <p v-if="!uid" class="warning">
      No user id found. Set your BiteBud user id first to see your reviews.
    </p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="hint">Loading…</p>

    <ul class="cards">
      <li v-for="row in rows" :key="row.review.id" class="card">
        <div class="card-body">
          <h2>{{ row.place.name }}</h2>
          <p class="addr">{{ row.place.address ?? row.place.displayName }}</p>
          <p class="meta">Overall {{ row.review.overallRating.toFixed(1) }}/5 · updated {{ new Date(row.review.updatedAt).toLocaleDateString() }}</p>
          <div class="tags">
            <span class="pill">{{ row.review.bestMealBlocks[0] ?? 'Meal: —' }}</span>
            <span class="pill">{{ row.review.bestTimesOfDay[0] ?? 'Time: —' }}</span>
            <span class="pill">{{ row.review.bestDaysOfWeek[0] ?? 'Day: —' }}</span>
          </div>
        </div>
        <div class="actions">
          <button type="button" class="bb-btn bb-btn--secondary" @click="openDetails(row.place.id)">See details</button>
          <button type="button" class="bb-btn bb-btn--primary" @click="edit(row.place.id)">Edit review</button>
        </div>
      </li>
    </ul>

    <p v-if="!loading && rows.length === 0" class="hint">No reviews yet.</p>
  </section>
</template>

<style scoped>
.page-back {
  margin: 0;
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
.page { max-width: 60rem; margin: 0 auto; padding: 1rem; display: grid; gap: 0.75rem; }
.hero h1 { margin: 0; color: var(--bb-primary); font-family: var(--bb-font-headline); }
.hint { margin: 0; color: var(--bb-muted); }
.error { margin: 0; color: #b42318; font-weight: 600; }
.warning { margin: 0; color: #b54708; font-weight: 600; }
.cards { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.6rem; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); }
.card { border: 1px solid var(--bb-border); background: var(--bb-surface-low); border-radius: 14px; padding: 0.8rem; display: grid; gap: 0.6rem; }
.card-body h2 { margin: 0; font-size: 1.05rem; }
.addr { margin: 0.25rem 0 0; color: var(--bb-muted); font-size: 0.88rem; }
.meta { margin: 0.25rem 0 0; color: var(--bb-muted); font-size: 0.82rem; }
.tags { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.45rem; }
.pill { border: 1px solid var(--bb-border); background: var(--bb-surface-lowest); border-radius: 999px; padding: 0.2rem 0.5rem; font-size: 0.8rem; }
.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 0.55rem; }
</style>

