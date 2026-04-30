<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { submitRestaurantRating } from '../lib/restaurantsApi'

const route = useRoute()
const router = useRouter()
const saving = ref(false)
const error = ref('')
const form = reactive({
  noiseRating: 3,
  musicRating: 3,
  lightRating: 3,
  crowdsRating: 3,
  smellsRating: 3,
})

function overall() {
  const total = form.noiseRating + form.musicRating + form.lightRating + form.crowdsRating + form.smellsRating
  return Number((total / 5).toFixed(1))
}

function nudge(key: keyof typeof form, delta: number) {
  const next = Math.max(1, Math.min(5, form[key] + delta))
  form[key] = next
}

function backToDetails() {
  const returnTo = String(route.query.returnTo || '')
  const returnToPath = String(route.query.returnToPath || '')
  if (returnTo === 'restaurantSearch') {
    if (returnToPath) {
      void router.push(returnToPath)
      return
    }
    void router.push({ name: 'restaurantSearch' })
    return
  }
  if (returnTo === 'restaurantMyReviews') {
    void router.push({ name: 'restaurantMyReviews' })
    return
  }
  void router.push({ name: 'restaurantReviewDetail', params: { id: String(route.params.id) } })
}

async function submit() {
  saving.value = true
  error.value = ''
  try {
    const placeId = String(route.params.id)
    const created = await submitRestaurantRating(placeId, { ...form, overallRating: overall() })
    const returnTo = String(route.query.returnTo || '')
    const returnToPath = String(route.query.returnToPath || '')
    void router.push({
      name: 'restaurantBestTime',
      params: { id: placeId },
      query: { reviewId: created.reviewId, ...(returnTo ? { returnTo } : {}), ...(returnToPath ? { returnToPath } : {}) },
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save rating'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="page">
    <h1>Rate restaurant environment</h1>
    <p class="hint">Use quick 1-5 ratings so future decisions are easier.</p>
    <p v-if="error" class="error">{{ error }}</p>
    <form class="card" @submit.prevent="submit">
      <label v-for="key in ['noiseRating','musicRating','lightRating','crowdsRating','smellsRating']" :key="key" class="row">
        <span>{{ key.replace('Rating', '') }}</span>
        <div class="stepper">
          <button type="button" @click="nudge(key as keyof typeof form, -1)">-</button>
          <strong>{{ form[key as keyof typeof form] }}</strong>
          <button type="button" @click="nudge(key as keyof typeof form, 1)">+</button>
        </div>
      </label>
      <p class="overall">Overall: {{ overall().toFixed(1) }}/5</p>
      <div class="actions">
        <button class="bb-btn bb-btn--secondary" type="button" @click="backToDetails">Back</button>
        <button class="bb-btn bb-btn--primary" type="submit" :disabled="saving">{{ saving ? 'Saving...' : 'Next' }}</button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.page { max-width: 26rem; margin: 0 auto; padding: 1rem; display: grid; gap: 0.75rem; }
h1 { margin: 0; color: var(--bb-primary); font-family: var(--bb-font-headline); }
.hint { margin: 0; color: var(--bb-muted); }
.error { margin: 0; color: #b42318; }
.card { border: 1px solid var(--bb-border); background: var(--bb-surface-low); border-radius: 14px; padding: 0.9rem; display: grid; gap: 0.6rem; }
.row { display: grid; grid-template-columns: 80px 1fr; gap: 0.6rem; align-items: center; text-transform: capitalize; }
.stepper { display: inline-flex; align-items: center; gap: 0.5rem; justify-self: end; }
.stepper button {
  width: 1.9rem;
  height: 1.9rem;
  border: 1px solid color-mix(in srgb, var(--bb-primary) 35%, var(--bb-border));
  border-radius: 999px;
  background: color-mix(in srgb, var(--bb-primary) 8%, var(--bb-surface-lowest));
  color: var(--bb-primary);
  font-weight: 800;
  line-height: 1;
}
.stepper button:hover { background: color-mix(in srgb, var(--bb-primary) 14%, var(--bb-surface-lowest)); }
.stepper button:focus-visible { outline: 2px solid color-mix(in srgb, var(--bb-primary) 45%, transparent); outline-offset: 2px; }
.overall { margin: 0.2rem 0 0; font-weight: 700; }
.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 0.55rem; }
</style>
