<script setup lang="ts">
import { onMounted, ref, watch, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchRestaurantReviewRating, patchRestaurantBestTime } from '../lib/restaurantsApi'

const route = useRoute()
const router = useRouter()
const error = ref('')
const saving = ref(false)

const MEAL_OPTIONS = ['Breakfast', 'Brunch', 'Lunch', 'Dinner'] as const
const TIME_OPTIONS = ['Morning', 'Midday', 'Afternoon', 'Evening'] as const
const DAY_OPTIONS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

const reviewId = String(route.query.reviewId || '')
const placeId = String(route.params.id)

function bestTimeStorageKey(id: string) {
  return `bitebud-besttime-draft-${id}`
}

function readTagDraft(): { meals: string[]; times: string[]; days: string[] } | null {
  if (!reviewId) return null
  try {
    const raw = sessionStorage.getItem(bestTimeStorageKey(reviewId))
    if (!raw) return null
    const o = JSON.parse(raw) as { meals?: unknown; times?: unknown; days?: unknown }
    if (!Array.isArray(o.meals) || !Array.isArray(o.times) || !Array.isArray(o.days)) return null
    return {
      meals: o.meals.filter((x): x is string => typeof x === 'string'),
      times: o.times.filter((x): x is string => typeof x === 'string'),
      days: o.days.filter((x): x is string => typeof x === 'string'),
    }
  } catch {
    return null
  }
}

function writeTagDraft() {
  if (!reviewId) return
  sessionStorage.setItem(
    bestTimeStorageKey(reviewId),
    JSON.stringify({
      meals: selectedMealBlocks.value,
      times: selectedTimesOfDay.value,
      days: selectedDaysOfWeek.value,
    }),
  )
}

const draft = readTagDraft()
const selectedMealBlocks = ref<string[]>(draft?.meals ?? [])
const selectedTimesOfDay = ref<string[]>(draft?.times ?? [])
const selectedDaysOfWeek = ref<string[]>(draft?.days ?? [])

watch([selectedMealBlocks, selectedTimesOfDay, selectedDaysOfWeek], writeTagDraft, { deep: true })

onMounted(async () => {
  if (!reviewId) return
  const hasDraft =
    (draft?.meals?.length ?? 0) + (draft?.times?.length ?? 0) + (draft?.days?.length ?? 0) > 0
  if (hasDraft) return
  try {
    const r = await fetchRestaurantReviewRating(reviewId)
    if (String(r.placeId) !== placeId) return
    const meals = Array.isArray(r.bestMealBlocks) ? r.bestMealBlocks : []
    const times = Array.isArray(r.bestTimesOfDay) ? r.bestTimesOfDay : []
    const days = Array.isArray(r.bestDaysOfWeek) ? r.bestDaysOfWeek : []
    if (meals.length || times.length || days.length) {
      selectedMealBlocks.value = [...meals]
      selectedTimesOfDay.value = [...times]
      selectedDaysOfWeek.value = [...days]
      writeTagDraft()
    }
  } catch {
    /* keep empty selection */
  }
})

function toggleChip(list: Ref<string[]>, value: string, max: number) {
  const cur = list.value
  const i = cur.indexOf(value)
  if (i >= 0) {
    list.value = cur.filter((x) => x !== value)
    return
  }
  if (cur.length >= max) return
  list.value = [...cur, value]
}

function toggleMealBlock(v: string) {
  toggleChip(selectedMealBlocks, v, 6)
}
function toggleTimeOfDayChip(v: string) {
  toggleChip(selectedTimesOfDay, v, 6)
}
function toggleDayOfWeekChip(v: string) {
  toggleChip(selectedDaysOfWeek, v, 7)
}

function backToRate() {
  const returnTo = String(route.query.returnTo || '')
  const returnToPath = String(route.query.returnToPath || '')
  void router.push({
    name: 'restaurantRate',
    params: { id: placeId },
    query: {
      ...(reviewId ? { reviewId } : {}),
      ...(returnTo ? { returnTo } : {}),
      ...(returnToPath ? { returnToPath } : {}),
    },
  })
}

async function saveTags() {
  if (!reviewId) {
    error.value = 'Missing review id. Please rate the restaurant first.'
    return
  }
  if (
    selectedMealBlocks.value.length === 0 ||
    selectedTimesOfDay.value.length === 0 ||
    selectedDaysOfWeek.value.length === 0
  ) {
    error.value = 'Choose at least one option in each group.'
    return
  }
  saving.value = true
  error.value = ''
  try {
    await patchRestaurantBestTime(reviewId, {
      bestMealBlocks: selectedMealBlocks.value,
      bestTimesOfDay: selectedTimesOfDay.value,
      bestDaysOfWeek: selectedDaysOfWeek.value,
    })
    sessionStorage.removeItem(bestTimeStorageKey(reviewId))
    const returnTo = String(route.query.returnTo || '')
    const returnToPath = String(route.query.returnToPath || '')
    void router.push({
      name: 'restaurantSavedConfirm',
      params: { id: placeId },
      query: {
        mealBlock: selectedMealBlocks.value.join(','),
        timeOfDay: selectedTimesOfDay.value.join(','),
        dayOfWeek: selectedDaysOfWeek.value.join(','),
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
        <p>Meal block <span class="chip-hint">(pick any)</span></p>
        <div class="chips">
          <button
            v-for="v in MEAL_OPTIONS"
            :key="v"
            type="button"
            :class="['chip', { active: selectedMealBlocks.includes(v) }]"
            @click="toggleMealBlock(v)"
          >
            {{ v }}
          </button>
        </div>
      </div>
      <div class="chip-group">
        <p>Time of day <span class="chip-hint">(pick any)</span></p>
        <div class="chips">
          <button
            v-for="v in TIME_OPTIONS"
            :key="v"
            type="button"
            :class="['chip', { active: selectedTimesOfDay.includes(v) }]"
            @click="toggleTimeOfDayChip(v)"
          >
            {{ v }}
          </button>
        </div>
      </div>
      <div class="chip-group">
        <p>Day of week <span class="chip-hint">(pick any)</span></p>
        <div class="chips">
          <button
            v-for="v in DAY_OPTIONS"
            :key="v"
            type="button"
            :class="['chip', { active: selectedDaysOfWeek.includes(v) }]"
            @click="toggleDayOfWeekChip(v)"
          >
            {{ v.slice(0, 3) }}
          </button>
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
.chip-hint { font-weight: 500; color: var(--bb-muted); font-size: 0.8rem; }
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
