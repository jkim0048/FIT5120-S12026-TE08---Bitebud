<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { favoriteRestaurant } from '../lib/restaurantsApi'

const route = useRoute()
const router = useRouter()
const favSaved = ref(false)
const saveError = ref('')

function navToReview() {
  void router.push({ name: 'restaurantReviewDetail', params: { id: String(route.params.id) } })
}

function navToSearch() {
  const returnToPath = String(route.query.returnToPath || '')
  if (returnToPath) {
    void router.push(returnToPath)
    return
  }
  void router.push({ name: 'restaurantSearch' })
}

function navHome() {
  void router.push({ name: 'restaurantEntry' })
}

async function saveFavorite() {
  saveError.value = ''
  try {
    await favoriteRestaurant(String(route.params.id))
    favSaved.value = true
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : 'Could not save favorite'
  }
}

onMounted(() => {
  void saveFavorite()
})
</script>

<template>
  <section class="page">
    <h1>Thanks - your review was saved.</h1>
    <p class="hint">We'll help you and others choose calmer restaurants in less time.</p>
    <div class="card">
      <p class="ok">✅ Saved place and tags</p>
      <p><strong>Meal block:</strong> {{ route.query.mealBlock || 'N/A' }}</p>
      <p><strong>Time of day:</strong> {{ route.query.timeOfDay || 'N/A' }}</p>
      <p><strong>Day of week:</strong> {{ route.query.dayOfWeek || 'N/A' }}</p>
      <p :class="favSaved ? 'ok' : 'hint'">
        {{ favSaved ? 'Saved to favourite restaurants.' : 'Saving to favourites...' }}
      </p>
      <p v-if="saveError" class="error">{{ saveError }}</p>
      <div class="actions">
        <button class="bb-btn bb-btn--secondary" type="button" @click="navToReview">View restaurant sensory reviews</button>
        <button class="bb-btn bb-btn--secondary" type="button" @click="navToSearch">Rate another restaurant</button>
        <button class="bb-btn bb-btn--primary" type="button" @click="navHome">Home</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.page { max-width: 26rem; margin: 0 auto; padding: 1rem; display: grid; gap: 0.75rem; }
h1 { margin: 0; color: var(--bb-primary); font-family: var(--bb-font-headline); }
.hint { margin: 0; color: var(--bb-muted); }
.ok { margin: 0; color: #027a48; font-weight: 700; }
.error { margin: 0; color: #b42318; }
.card { border: 1px solid var(--bb-border); background: var(--bb-surface-low); border-radius: 14px; padding: 0.95rem; display: grid; gap: 0.45rem; }
.card p { margin: 0; }
.actions { display: grid; gap: 0.55rem; margin-top: 0.3rem; }
</style>
