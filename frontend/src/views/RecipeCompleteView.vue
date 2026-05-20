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

const route = useRoute()
const router = useRouter()

const title = computed(() => String(route.query.title ?? 'Your recipe'))
const steps = computed(() => Number(route.query.steps ?? 0) || 0)
const minutes = computed(() => Number(route.query.minutes ?? 0) || 0)
const rating = ref<number | null>(null)
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
const validationModal = ref<string | null>(null)
const saveErrorModal = ref<string | null>(null)
const successModalOpen = ref(false)

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

function setRating(n: number) {
  rating.value = n
}

function dismissValidationModal() {
  validationModal.value = null
}

function dismissSaveErrorModal() {
  saveErrorModal.value = null
}

function dismissSuccessModal() {
  successModalOpen.value = false
  void router.push({ name: 'cookingStart' })
}

const missingRating = computed(() => rating.value === null)
const missingWorked = computed(() => worked.value.length === 0)
const missingDidntWork = computed(() => didntWork.value.length === 0)

function validateFeedback(): string | null {
  const missing: string[] = []
  if (missingRating.value) missing.push('a star rating')
  if (missingWorked.value) missing.push('one “what worked” choice')
  if (missingDidntWork.value) missing.push('one “what didn’t” choice')
  if (missing.length === 0) return null

  const needList =
    missing.length === 1
      ? missing[0]
      : missing.length === 2
        ? `${missing[0]} and ${missing[1]}`
        : `${missing[0]}, ${missing[1]}, and ${missing[2]}`

  return `Almost there — please add ${needList}. These few details help Bitebud learn what suits you and suggest better recipes next time.`
}

const activityChip = useActivityChip()

async function save() {
  const recipeId = String(route.params.id || '')
  if (!recipeId) return
  const validationMessage = validateFeedback()
  if (validationMessage) {
    validationModal.value = validationMessage
    return
  }
  saving.value = true
  saveErrorModal.value = null
  try {
    await postRecipeCompletion(recipeId, {
      rating: rating.value!,
      worked: worked.value,
      didntWork: didntWork.value,
    })
    await activityChip.refresh()
    successModalOpen.value = true
  } catch (e) {
    saveErrorModal.value = e instanceof Error ? e.message : 'Could not save your feedback. Try again.'
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

    <section class="rating" aria-labelledby="rating-heading">
      <h2 id="rating-heading">How did this recipe feel?</h2>
      <p class="rating-required-note">
        A star rating plus one thing that worked and one that didn’t — then you can save. It helps us tailor future suggestions.
      </p>
      <div
        class="stars"
        role="radiogroup"
        aria-label="Recipe comfort rating"
        :class="{ 'stars--invalid': missingRating && validationModal }"
        :aria-invalid="missingRating && !!validationModal"
      >
        <button
          v-for="n in 5"
          :key="n"
          type="button"
          class="star"
          :class="{ on: rating !== null && n <= rating }"
          :aria-checked="rating === n"
          role="radio"
          @click="setRating(n)"
        >
          &#9733;
        </button>
      </div>
      <div class="chip-group" :class="{ 'chip-group--invalid': missingWorked && validationModal }">
        <p>What worked? <span class="chip-hint">(choose at least one)</span></p>
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

      <div class="chip-group" :class="{ 'chip-group--invalid': missingDidntWork && validationModal }">
        <p>What didn't? <span class="chip-hint">(choose at least one)</span></p>
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

    <nav class="actions">
      <button class="bb-btn bb-btn--primary" type="button" :disabled="saving" @click="save">
        {{ saving ? 'Saving...' : 'Save' }}
      </button>
      <RouterLink class="bb-btn bb-btn--secondary" :to="`/recipe/${route.params.id}`">Back</RouterLink>
    </nav>
    <MotivationToast :message="toastMessage" @dismiss="toastMessage = ''" />

    <div v-if="validationModal" class="feedback-modal-host" role="presentation">
      <aside
        class="feedback-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="validation-modal-title"
        aria-describedby="validation-modal-message"
        @click.stop
      >
        <h3 id="validation-modal-title" class="feedback-modal__title">Almost there</h3>
        <p id="validation-modal-message" class="feedback-modal__message">{{ validationModal }}</p>
        <div class="feedback-modal__actions">
          <button type="button" class="bb-btn bb-btn--primary" @click="dismissValidationModal">OK</button>
        </div>
      </aside>
    </div>

    <div v-if="saveErrorModal" class="feedback-modal-host" role="presentation">
      <aside
        class="feedback-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="save-error-title"
        aria-describedby="save-error-message"
        @click.stop
      >
        <h3 id="save-error-title" class="feedback-modal__title">Could not save</h3>
        <p id="save-error-message" class="feedback-modal__message">{{ saveErrorModal }}</p>
        <div class="feedback-modal__actions">
          <button type="button" class="bb-btn bb-btn--primary" @click="dismissSaveErrorModal">OK</button>
        </div>
      </aside>
    </div>

    <div v-if="successModalOpen" class="feedback-modal-host" role="presentation">
      <aside
        class="feedback-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="success-modal-title"
        aria-describedby="success-modal-message"
        @click.stop
      >
        <h3 id="success-modal-title" class="feedback-modal__title">Saved</h3>
        <p id="success-modal-message" class="feedback-modal__message">
          Your rating has been saved. Bitebud will use it to suggest recipes that suit you better next time.
        </p>
        <div class="feedback-modal__actions">
          <button type="button" class="bb-btn bb-btn--primary" @click="dismissSuccessModal">OK</button>
        </div>
      </aside>
    </div>
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
.rating-required-note {
  margin: 0.35rem 0 0;
  font-size: 0.85rem;
  color: var(--bb-muted);
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
.stars--invalid .star {
  outline: 2px solid color-mix(in srgb, var(--bb-accent) 50%, transparent);
  outline-offset: 2px;
  border-radius: 4px;
}
.chip-group--invalid .chips {
  padding: 0.15rem;
  border-radius: 12px;
  outline: 2px solid color-mix(in srgb, var(--bb-accent) 40%, transparent);
}
.actions {
  margin-top: 1rem;
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.feedback-modal-host {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(28, 25, 23, 0.38);
}
.feedback-modal {
  width: min(28rem, 100%);
  border-radius: 16px;
  background: var(--bb-surface-lowest);
  border: 1px solid var(--bb-border);
  padding: 1rem 1rem 0.95rem;
  box-shadow: 0 18px 60px rgba(26, 28, 25, 0.18);
}
.feedback-modal__title {
  margin: 0;
  font-family: var(--bb-font-headline);
  font-weight: 900;
  color: var(--bb-text);
}
.feedback-modal__message {
  margin: 0.5rem 0 0;
  color: var(--bb-muted);
  line-height: 1.55;
  font-size: 0.95rem;
}
.feedback-modal__actions {
  margin-top: 0.9rem;
  display: flex;
  justify-content: flex-end;
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

