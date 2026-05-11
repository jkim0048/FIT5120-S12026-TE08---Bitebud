<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { getBiteBudUserId } from '../composables/useUserId'
import { apiFetch } from '../lib/api'
import { localCalendarYmd, recordMotivationActivity } from '../lib/motivationApi'
import { motivationToastText } from '../lib/motivationCopy'
import MotivationToast from '../components/MotivationToast.vue'

const route = useRoute()

const title = computed(() => String(route.query.title ?? 'Your recipe'))
const steps = computed(() => Number(route.query.steps ?? 0) || 0)
const minutes = computed(() => Number(route.query.minutes ?? 0) || 0)
const rating = ref(4)
const toastMessage = ref('')

onMounted(() => {
  const uid = getBiteBudUserId()
  const recipeId = String(route.params.id ?? '')
  if (!uid || !recipeId) return
  void (async () => {
    try {
      // Ensure “My recipes” can show this completion even if the last-step hook failed or the user completed on an older build.
      try {
        await apiFetch(`/api/recipes/${recipeId}/complete`, {
          method: 'POST',
          headers: { 'X-User-Id': uid },
        })
      } catch {
        /* ignore */
      }

      const res = await recordMotivationActivity({
        type: 'recipe_completed',
        localDate: localCalendarYmd(new Date()),
        recipeId,
      })
      const text = motivationToastText(res.toastKey)
      if (text) toastMessage.value = text
    } catch {
      /* offline / API error — do not block completion screen */
    }
  })()
})
</script>

<template>
  <div class="page">
    <div class="hero">
      <div class="badge" role="img" aria-label="You earned a trophy">🏆</div>
      <h1>You Did It!</h1>
      <p class="copy">
        You completed {{ title }} — all {{ steps || 'your' }} steps done. That took {{ minutes || 'a focused' }} minute<span v-if="minutes !== 1">s</span>.
      </p>
    </div>

    <section class="stats">
      <article class="stat">
        <div class="num">{{ steps || '—' }}</div>
        <div class="k">Steps completed</div>
      </article>
      <article class="stat">
        <div class="num">{{ minutes ? `${minutes}m` : '—' }}</div>
        <div class="k">Time taken</div>
      </article>
    </section>

    <section class="rating">
      <h2>How did this recipe feel?</h2>
      <div class="stars" role="radiogroup" aria-label="Recipe comfort rating">
        <button
          v-for="n in 5"
          :key="n"
          type="button"
          class="star"
          :class="{ on: n <= rating }"
          @click="rating = n"
        >
          &#9733;
        </button>
      </div>
    </section>

    <nav class="actions">
      <RouterLink class="bb-btn bb-btn--primary" to="/search">Find another recipe</RouterLink>
      <RouterLink class="bb-btn bb-btn--primary" :to="`/recipe/${route.params.id}`">Back to recipe</RouterLink>
    </nav>
    <MotivationToast :message="toastMessage" @dismiss="toastMessage = ''" />
  </div>
</template>

<style scoped>
.page {
  max-width: 46rem;
  margin: 0 auto;
  padding: 1.5rem 1.25rem 2.5rem;
}
.hero {
  text-align: center;
}
.badge {
  width: 94px;
  height: 94px;
  margin: 0.8rem auto 0.6rem;
  border-radius: 999px;
  display: grid;
  place-items: center;
  font-size: 2.75rem;
  line-height: 1;
  background: color-mix(in srgb, #f59e0b 24%, var(--bb-surface-lowest));
}
h1 {
  margin: 0;
  font-family: var(--bb-font-headline);
  font-size: clamp(2rem, 5vw, 3rem);
  letter-spacing: -0.03em;
}
.copy {
  margin: 0.65rem auto 0;
  max-width: 35rem;
  color: var(--bb-muted);
  line-height: 1.55;
}
.stats {
  margin-top: 1.2rem;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}
.stat {
  background: var(--bb-surface-low);
  border: 1px solid var(--bb-border);
  border-radius: 14px;
  padding: 1rem;
  text-align: center;
}
.num {
  font-family: var(--bb-font-headline);
  font-size: 2rem;
  font-weight: 900;
}
.k {
  margin-top: 0.2rem;
  color: var(--bb-muted);
  font-size: 0.85rem;
}
.rating {
  margin-top: 1rem;
  padding: 1rem;
  border-radius: 14px;
  background: var(--bb-surface-low);
  border: 1px solid var(--bb-border);
}
.rating h2 {
  margin: 0;
  font-size: 1.02rem;
}
.stars {
  margin-top: 0.55rem;
  display: flex;
  gap: 0.4rem;
}
.star {
  border: none;
  background: transparent;
  font-size: 1.8rem;
  color: color-mix(in srgb, var(--bb-muted) 45%, var(--bb-border));
  cursor: pointer;
  line-height: 1;
}
.star.on {
  color: #f59e0b;
}
.actions {
  margin-top: 1rem;
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}
@media (max-width: 680px) {
  .stats {
    grid-template-columns: 1fr;
  }
}
</style>

