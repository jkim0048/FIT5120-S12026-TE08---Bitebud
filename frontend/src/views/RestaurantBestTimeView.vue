<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { patchRestaurantBestTime } from '../lib/restaurantsApi'

const route = useRoute()
const router = useRouter()
const error = ref('')
const saving = ref(false)

const mealBlock = ref('Dinner')
const timeOfDay = ref('Evening')
const dayOfWeek = ref('Friday')

function backToRate() {
  const returnTo = String(route.query.returnTo || '')
  const returnToPath = String(route.query.returnToPath || '')
  void router.push({
    name: 'restaurantRate',
    params: { id: String(route.params.id) },
    query: { ...(returnTo ? { returnTo } : {}), ...(returnToPath ? { returnToPath } : {}) },
  })
}

async function saveTags() {
  const reviewId = String(route.query.reviewId || '')
  if (!reviewId) {
    error.value = 'Missing review id. Please rate the restaurant first.'
    return
  }
  saving.value = true
  error.value = ''
  try {
    await patchRestaurantBestTime(reviewId, {
      bestMealBlocks: [mealBlock.value],
      bestTimesOfDay: [timeOfDay.value],
      bestDaysOfWeek: [dayOfWeek.value],
    })
    const returnTo = String(route.query.returnTo || '')
    const returnToPath = String(route.query.returnToPath || '')
    void router.push({
      name: 'restaurantSavedConfirm',
      params: { id: String(route.params.id) },
      query: {
        mealBlock: mealBlock.value,
        timeOfDay: timeOfDay.value,
        dayOfWeek: dayOfWeek.value,
        ...(returnTo ? { returnTo } : {}),
        ...(returnToPath ? { returnToPath } : {}),
      },
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save best-time tags'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="page">
    <h1>Tag best time</h1>
    <p v-if="error" class="error">{{ error }}</p>
    <div class="card">
      <div class="chip-group">
        <p>Meal block</p>
        <div class="chips">
          <button v-for="v in ['Breakfast','Brunch','Lunch','Dinner']" :key="v" type="button" :class="['chip', { active: mealBlock === v }]" @click="mealBlock = v">{{ v }}</button>
        </div>
      </div>
      <div class="chip-group">
        <p>Time of day</p>
        <div class="chips">
          <button v-for="v in ['Morning','Midday','Afternoon','Evening']" :key="v" type="button" :class="['chip', { active: timeOfDay === v }]" @click="timeOfDay = v">{{ v }}</button>
        </div>
      </div>
      <div class="chip-group">
        <p>Day of week</p>
        <div class="chips">
          <button v-for="v in ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']" :key="v" type="button" :class="['chip', { active: dayOfWeek === v }]" @click="dayOfWeek = v">{{ v.slice(0, 3) }}</button>
        </div>
      </div>
      <div class="actions">
        <button class="bb-btn bb-btn--secondary" type="button" @click="backToRate">Back</button>
        <button class="bb-btn bb-btn--primary" type="button" :disabled="saving" @click="saveTags">
          {{ saving ? 'Saving...' : 'Save' }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.page { max-width: 26rem; margin: 0 auto; padding: 1rem; display: grid; gap: 0.7rem; }
h1 { margin: 0; color: var(--bb-primary); font-family: var(--bb-font-headline); }
.error { margin: 0; color: #b42318; }
.card { border: 1px solid var(--bb-border); background: var(--bb-surface-low); border-radius: 14px; padding: 0.9rem; display: grid; gap: 0.6rem; }
.chip-group p { margin: 0; font-weight: 700; font-size: 0.9rem; }
.chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.25rem; }
.chip {
  border: 1px solid var(--bb-border);
  border-radius: 999px;
  background: var(--bb-surface-lowest);
  padding: 0.34rem 0.65rem;
  font: inherit;
  font-size: 0.8rem;
  color: #101828;
}
.chip.active {
  border-color: var(--bb-accent);
  background: color-mix(in srgb, var(--bb-accent) 18%, white);
  color: #101828;
}
.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 0.55rem; margin-top: 0.25rem; }
</style>
