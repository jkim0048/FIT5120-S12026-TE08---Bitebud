<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { getBiteBudUserId } from '../composables/useUserId'
import { apiFetch } from '../lib/api'
import { localCalendarYmd, recordMotivationActivity } from '../lib/motivationApi'
import { motivationToastText } from '../lib/motivationCopy'
import MotivationToast from '../components/MotivationToast.vue'
import { postRecipeCompletion } from '../lib/recipeCompletionsApi'
import { useActivityChip } from '../composables/useActivityChip'
import { useGentleToast } from '../composables/useGentleToast'

const route = useRoute()
const router = useRouter()

const title = computed(() => String(route.query.title ?? 'Your recipe'))
const steps = computed(() => Number(route.query.steps ?? 0) || 0)
const minutes = computed(() => Number(route.query.minutes ?? 0) || 0)
const rating = ref(4)
const toastMessage = ref('')

const WORKED_OPTIONS = [
  'low-prep',
  'few-ingredients',
  'one-pan',
  'sweet-savoury',
  'comforting-texture',
  'matched-sensory-profile',
  'easy-cleanup',
  'clear-steps',
] as const

const DIDNT_WORK_OPTIONS = [
  'too-many-steps',
  'too-many-ingredients',
  'too-long',
  'thick-sauce',
  'unfamiliar-method',
  'texture-issue',
  'flavour-too-strong',
  'ingredient-issue',
] as const

const worked = ref<string[]>([])
const didntWork = ref<string[]>([])
const saving = ref(false)
const error = ref('')

function toggleWorked(v: string) {
  const cur = worked.value
  if (cur.includes(v)) {
    worked.value = cur.filter((x) => x !== v)
  } else {
    worked.value = [...cur, v]
  }
}

function toggleDidntWork(v: string) {
  const cur = didntWork.value
  if (cur.includes(v)) {
    didntWork.value = cur.filter((x) => x !== v)
  } else {
    didntWork.value = [...cur, v]
  }
}

const activityChip = useActivityChip()
const gentleToast = useGentleToast()

async function save() {
  const recipeId = String(route.params.id || '')
  if (!recipeId) return
  saving.value = true
  error.value = ''
  try {
    await postRecipeCompletion(recipeId, {
      rating: rating.value,
      worked: worked.value,
      didntWork: didntWork.value,
    })
    await activityChip.refresh()
    gentleToast.show('recipe-rated', {})
    void router.push(`/recipe/${recipeId}`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save'
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  const uid = getBiteBudUserId()
  const recipeId = String(route.params.id ?? '')
  if (!uid || !recipeId) return
  void (async () => {
    try {
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
      <div class="badge" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M7 14c5-1 8-5 9-10 2 6-1 14-7 16-3 1-6 0-8-2 2 0 4-1 6-4Z"
            fill="currentColor"
          />
        </svg>
      </div>
      <h1>Recipe complete</h1>
      <p class="copy">
        {{ title }} marked as complete. {{ steps || 'Your' }} step<span v-if="steps !== 1">s</span> logged. {{ minutes ? `${minutes} minute${minutes === 1 ? '' : 's'}` : 'Time logged' }}.
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

      <div class="chip-group">
        <p>What worked? <span class="chip-hint">(tap any)</span></p>
        <div class="chips">
          <button
            v-for="v in WORKED_OPTIONS"
            :key="v"
            type="button"
            :class="['chip', { active: worked.includes(v) }]"
            @click="toggleWorked(v)"
          >
            {{ v }}
          </button>
        </div>
      </div>

      <div class="chip-group">
        <p>What didn't? <span class="chip-hint">(tap any)</span></p>
        <div class="chips">
          <button
            v-for="v in DIDNT_WORK_OPTIONS"
            :key="v"
            type="button"
            :class="['chip', { active: didntWork.includes(v) }]"
            @click="toggleDidntWork(v)"
          >
            {{ v }}
          </button>
        </div>
      </div>
    </section>

    <p v-if="error" class="error" role="status">{{ error }}</p>

    <nav class="actions">
      <button class="bb-btn bb-btn--primary" type="button" :disabled="saving" @click="save">
        {{ saving ? 'Saving...' : 'Save' }}
      </button>
      <RouterLink class="bb-btn bb-btn--secondary" :to="`/recipe/${route.params.id}`">Back</RouterLink>
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
  color: #1f7a4a;
  background: color-mix(in srgb, #22c55e 18%, var(--bb-surface-lowest));
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
.error {
  margin: 0.75rem 0 0;
  color: #b42318;
}

.chip-group {
  margin-top: 0.85rem;
}
.chip-group p {
  margin: 0;
  font-weight: 700;
  font-size: 0.92rem;
}
.chip-hint {
  font-weight: 500;
  color: var(--bb-muted);
  font-size: 0.85rem;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.3rem;
}
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
@media (max-width: 680px) {
  .stats {
    grid-template-columns: 1fr;
  }
}
</style>

