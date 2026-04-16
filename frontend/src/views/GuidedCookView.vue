<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { biteBudUserIdHeader, getBiteBudUserId } from '../composables/useUserId'
import { useSettings } from '../composables/useSettings'
import { apiFetch } from '../lib/api'
import { getOrderedRecipeSteps } from '../lib/recipeSteps'
import { findTtsVoiceByName } from '../lib/ttsVoices'
import type { RecipeGraph } from '../types/recipe'
import type { SensoryConflictResponse } from '../types/sensory'

const route = useRoute()
const router = useRouter()
const { settings } = useSettings()

const graph = ref<RecipeGraph | null>(null)
const err = ref<string | null>(null)
const pageLoading = ref(true)
const index = ref(0)
const remaining = ref<number | null>(null)
const timer = ref<number | null>(null)
const conflicts = ref<SensoryConflictResponse | null>(null)
const completed = ref<string[]>([])
const loadingDone = ref(false)
const sessionStartMs = ref<number>(Date.now())

const recipeId = computed(() => route.params.id as string)
const steps = computed(() => (graph.value ? getOrderedRecipeSteps(graph.value) : []))
const current = computed(() => steps.value[index.value] ?? null)
const instructionText = computed(() => {
  const c = current.value
  if (!c) return ''
  const d = (c.detail ?? '').trim()
  if (d) return d
  return (c.label ?? '').trim()
})
const progressPct = computed(() => {
  const total = Math.max(1, steps.value.length)
  return Math.round(((index.value + 1) / total) * 100)
})

const checklist = computed(() =>
  instructionText.value
    .split(/[.;]\s+/)
    .map((s) => s.trim())
    .filter(Boolean),
)
const checks = ref<Record<string, boolean>>({})
const autoSpeech = ref(true)
const speechSupported = typeof window !== 'undefined' && typeof speechSynthesis !== 'undefined'

const hasConflictWarnings = computed(() => {
  const c = conflicts.value
  if (!c?.hasProfile) return false
  return c.sensory.length + c.dietary.length > 0
})

function stepHeat(stepText: string): string {
  const t = stepText.toLowerCase()
  if (t.includes('boil') || t.includes('fry') || t.includes('medium')) return 'Low-medium heat'
  if (t.includes('low') || t.includes('simmer')) return 'Low heat'
  return 'No heat for this step'
}

function speak(text: string) {
  if (!speechSupported) return
  if (typeof speechSynthesis === 'undefined') return
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.volume = settings.value.volume
  u.rate = settings.value.rate
  const match = findTtsVoiceByName(settings.value.voice)
  if (match) u.voice = match
  speechSynthesis.speak(u)
}

async function loadProgress() {
  const uid = getBiteBudUserId()
  if (!uid) {
    completed.value = []
    return
  }
  try {
    const data = await apiFetch<{ completedNodeIds: string[] }>(`/api/recipes/${recipeId.value}/progress`, {
      headers: { 'X-User-Id': uid },
    })
    completed.value = data.completedNodeIds ?? []
  } catch {
    completed.value = []
  }
}

async function saveProgress(next: string[]) {
  const uid = getBiteBudUserId()
  if (!uid) return
  await apiFetch(`/api/recipes/${recipeId.value}/progress`, {
    method: 'POST',
    body: JSON.stringify({ completedNodeIds: next }),
    headers: { 'X-User-Id': uid },
  })
}

async function loadRecipe() {
  pageLoading.value = true
  err.value = null
  try {
    const data = await apiFetch<{ graph: RecipeGraph }>(`/api/recipes/${recipeId.value}`, {
      headers: biteBudUserIdHeader(),
    })
    graph.value = data.graph
    await loadProgress()

    const uid = getBiteBudUserId()
    if (uid) {
      try {
        conflicts.value = await apiFetch<SensoryConflictResponse>(`/api/recipes/${recipeId.value}/sensory-conflicts`, {
          headers: { 'X-User-Id': uid },
        })
      } catch {
        conflicts.value = null
      }
    } else {
      conflicts.value = null
    }
  } catch (e) {
    err.value = e instanceof Error ? e.message : 'Load failed'
    graph.value = null
  } finally {
    pageLoading.value = false
  }
}

watch(
  recipeId,
  async () => {
    graph.value = null
    index.value = 0
    conflicts.value = null
    completed.value = []
    await loadRecipe()
  },
  { immediate: true },
)

onUnmounted(() => {
  stopTimer()
})

watch(
  () => current.value?.id,
  () => {
    if (!current.value) return
    if (!autoSpeech.value) return
    const text = instructionText.value
    if (text) speak(text)
    checks.value = {}
  },
)

function next() {
  if (index.value < steps.value.length - 1) index.value += 1
  stopTimer()
}

function prev() {
  if (index.value > 0) index.value -= 1
  stopTimer()
}

function startTimer() {
  stopTimer()
  remaining.value = Math.max(1, Number(current.value?.timeMinutes ?? 1)) * 60
  timer.value = window.setInterval(() => {
    if (remaining.value == null) return
    remaining.value -= 1
    if (remaining.value <= 0) stopTimer()
  }, 1000)
}

function stopTimer() {
  if (timer.value) {
    clearInterval(timer.value)
    timer.value = null
  }
}

function formatClock(sec: number | null): string {
  if (sec == null) return '--:--'
  const mm = Math.floor(sec / 60)
  const ss = sec % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

function isDone(stepId: string): boolean {
  return completed.value.includes(stepId)
}

async function markStepDoneAndNext() {
  if (!current.value || loadingDone.value) return
  loadingDone.value = true
  try {
    const set = new Set(completed.value)
    set.add(current.value.id)
    const nextCompleted = [...set]
    await saveProgress(nextCompleted)
    completed.value = nextCompleted

    const atLastStep = index.value >= steps.value.length - 1
    if (atLastStep) {
      const elapsedMin = Math.max(1, Math.round((Date.now() - sessionStartMs.value) / 60000))
      await router.push({
        name: 'recipeComplete',
        params: { id: recipeId.value },
        query: {
          title: graph.value?.title ?? 'Recipe',
          steps: String(steps.value.length),
          minutes: String(elapsedMin),
        },
      })
      return
    }

    index.value += 1
    stopTimer()
  } finally {
    loadingDone.value = false
  }
}
</script>

<template>
  <div class="page">
    <p v-if="err" class="err">{{ err }}</p>
    <div
      v-else-if="pageLoading && !graph"
      class="load-screen"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div class="load-screen__inner">
        <div class="spinner" aria-hidden="true" />
        <h1 class="load-screen__title">Loading guided cooking</h1>
        <p class="load-screen__text">Preparing your steps and kitchen-friendly view. This usually takes a moment.</p>
      </div>
    </div>
    <template v-else-if="graph && current">
      <div class="layout">
        <aside class="rail">
          <div class="rail-head">
            <h2>Recipe Steps</h2>
            <p>{{ graph.title }}</p>
          </div>

          <div class="bar-wrap">
            <div class="bar" :style="{ width: `${progressPct}%` }" />
          </div>
          <p class="rail-progress">Step {{ index + 1 }} of {{ steps.length }} — {{ progressPct }}% complete</p>

          <ol class="rail-steps">
            <li
              v-for="(step, idx) in steps"
              :key="step.id"
              :class="{
                active: idx === index,
                done: isDone(step.id),
              }"
            >
              <button
                type="button"
                :aria-label="`Step ${idx + 1} of ${steps.length}`"
                :title="step.label"
                @click="index = idx"
              >
                <span class="dot" :class="{ 'dot--done': isDone(step.id) }">
                  <span v-if="isDone(step.id)" class="dot__check" aria-hidden="true">✓</span>
                  <template v-else>{{ idx + 1 }}</template>
                </span>
              </button>
            </li>
          </ol>
        </aside>

        <section class="main">
          <header class="head">
            <RouterLink class="back" :to="{ name: 'recipe', params: { id: recipeId } }">Back to recipe</RouterLink>
          </header>

          <article class="step-card">
            <div class="step-top">
              <div class="step-icon">{{ current.emoji ?? '•' }}</div>
              <div class="step-top__text">
                <h1 class="step-heading">Step {{ index + 1 }} of {{ steps.length }}</h1>
                <p class="heat-pill">{{ stepHeat(`${current.label} ${current.detail}`) }}</p>
              </div>
            </div>

            <p class="inst">{{ instructionText }}</p>

            <div class="tip">Tip: A steady pace is safer than speed. Small progress is still progress.</div>
            <div class="speech-row">
              <button type="button" class="bb-btn bb-btn--secondary" @click="speak(instructionText)">
                Read this step aloud
              </button>
              <label class="speech-toggle">
                <input v-model="autoSpeech" type="checkbox" />
                Auto-read next step
              </label>
            </div>
            <p class="speech-help">
              <template v-if="speechSupported">
                If there is still no voice, open `Settings` and raise volume or switch voice.
              </template>
              <template v-else>
                Text-to-speech is not available in this browser/session.
              </template>
            </p>

            <section v-if="checklist.length" class="checklist">
              <h3>Checklist</h3>
              <label v-for="item in checklist" :key="item" class="check">
                <input v-model="checks[item]" type="checkbox" />
                {{ item }}
              </label>
            </section>

            <div v-if="hasConflictWarnings && conflicts" class="warn" role="alert">
              Ingredient checks detected for your profile. Review before continuing.
            </div>

            <nav class="actions" aria-label="Step navigation">
              <button type="button" class="bb-btn bb-btn--secondary" :disabled="index === 0 || loadingDone" @click="prev">Back</button>
              <button type="button" class="bb-btn bb-btn--secondary" :disabled="loadingDone" @click="next">Skip</button>
              <button type="button" class="bb-btn bb-btn--primary done" :disabled="loadingDone" @click="markStepDoneAndNext">
                {{ loadingDone ? 'Saving…' : (index >= steps.length - 1 ? 'Finish Recipe' : 'Step Done - Next') }}
              </button>
            </nav>
          </article>

          <section class="timer-card">
            <div>
              <p class="timer-k">Suggested time for this step</p>
              <p class="clock" aria-live="polite">{{ formatClock(remaining) }}</p>
            </div>
            <div class="timer-actions">
              <button type="button" class="bb-btn bb-btn--secondary" @click="startTimer">Start Timer</button>
              <button type="button" class="bb-btn bb-btn--secondary" @click="stopTimer">Stop</button>
            </div>
          </section>
        </section>
      </div>
    </template>
    <p v-else-if="graph && !current" class="muted page-muted">This recipe has no steps to guide yet.</p>
    <p v-else-if="!err" class="muted page-muted">Loading…</p>
  </div>
</template>

<style scoped>
.page {
  max-width: 74rem;
  margin: 0 auto;
  padding: 1rem 1.25rem 2rem;
}
.err {
  color: #b91c1c;
}
.muted {
  color: var(--bb-muted);
}
.page-muted {
  text-align: center;
  padding: 2rem 1rem;
}
.load-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 50vh;
  padding: 2rem 1rem;
}
.load-screen__inner {
  max-width: 22rem;
  text-align: center;
}
.load-screen__title {
  margin: 1rem 0 0;
  font-family: var(--bb-font-headline);
  font-size: 1.35rem;
  font-weight: 900;
  color: var(--bb-text);
}
.load-screen__text {
  margin: 0.5rem 0 0;
  font-size: 0.95rem;
  line-height: 1.55;
  color: var(--bb-muted);
}
.spinner {
  width: 44px;
  height: 44px;
  margin: 0 auto;
  border: 3px solid color-mix(in srgb, var(--bb-muted) 25%, transparent);
  border-top-color: var(--bb-primary);
  border-radius: 50%;
  animation: guided-spin 0.75s linear infinite;
}
@keyframes guided-spin {
  to {
    transform: rotate(360deg);
  }
}
.layout {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 1rem;
}
.rail,
.step-card,
.timer-card {
  background: var(--bb-surface-low);
  border-radius: 16px;
  box-shadow: 0 12px 30px rgba(26, 28, 25, 0.04);
}
.rail {
  padding: 0.9rem;
  align-self: start;
  position: sticky;
  top: 5.1rem;
}
.rail-head h2 {
  margin: 0;
  font-family: var(--bb-font-headline);
}
.rail-head p {
  margin: 0.2rem 0 0.8rem;
  color: var(--bb-muted);
  font-size: 0.9rem;
}
.bar-wrap {
  width: 100%;
  height: 8px;
  border-radius: 999px;
  background: var(--bb-surface-lowest);
  overflow: hidden;
}
.bar {
  height: 100%;
  background: color-mix(in srgb, var(--bb-primary) 80%, #3b82f6);
}
.rail-progress {
  margin: 0.45rem 0 0.6rem;
  color: var(--bb-muted);
  font-size: 0.82rem;
}
.rail-steps {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0.35rem;
}
.rail-steps li {
  width: 100%;
  margin: 0;
}
.rail-steps li button {
  width: 100%;
  border: none;
  background: transparent;
  padding: 0.45rem 0.5rem;
  border-radius: 10px;
  font: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.rail-steps li.active button {
  background: color-mix(in srgb, var(--bb-primary) 14%, transparent);
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--bb-primary) 35%, transparent);
}
.rail-steps li.done:not(.active) button {
  opacity: 1;
}
.dot {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  box-sizing: border-box;
  border: 2px solid color-mix(in srgb, var(--bb-muted) 45%, transparent);
  background: var(--bb-surface-lowest);
  color: var(--bb-text);
  display: grid;
  place-items: center;
  font-size: 0.75rem;
  font-weight: 900;
  flex-shrink: 0;
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease;
}
.rail-steps li.active .dot:not(.dot--done) {
  border-color: color-mix(in srgb, var(--bb-primary) 55%, transparent);
  background: color-mix(in srgb, var(--bb-primary) 18%, var(--bb-surface-lowest));
  color: var(--bb-text);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--bb-primary) 25%, transparent);
}
.dot--done {
  border-color: color-mix(in srgb, #16a34a 55%, transparent);
  background: color-mix(in srgb, #16a34a 22%, var(--bb-surface-lowest));
  color: #166534;
}
html.bb-dark .dot--done {
  color: color-mix(in srgb, #bbf7d0 90%, var(--bb-text));
  border-color: color-mix(in srgb, #22c55e 45%, transparent);
  background: color-mix(in srgb, #22c55e 18%, var(--bb-surface-low));
}
.dot__check {
  font-size: 0.85rem;
  font-weight: 900;
  line-height: 1;
}
.rail-steps li.active .dot--done {
  box-shadow: 0 0 0 2px color-mix(in srgb, #16a34a 28%, transparent);
}
html.bb-dark .rail-steps li.active .dot--done {
  box-shadow: 0 0 0 2px color-mix(in srgb, #22c55e 35%, transparent);
}
.main {
  display: grid;
  gap: 0.9rem;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}
.back {
  color: var(--bb-accent);
  text-decoration: none;
  font-weight: 700;
}
.mini-k {
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--bb-muted);
  font-family: var(--bb-font-label);
  font-weight: 800;
}
.step-card {
  padding: 1rem;
}
.step-top {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}
.step-top__text {
  min-width: 0;
  flex: 1;
}
.step-icon {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: var(--bb-surface-lowest);
  display: grid;
  place-items: center;
  font-size: 1.7rem;
}
.step-heading {
  margin: 0;
  font-family: var(--bb-font-headline);
  font-size: clamp(1.35rem, 2.8vw, 1.85rem);
  font-weight: 900;
  letter-spacing: -0.02em;
  line-height: 1.25;
}
.heat-pill {
  margin: 0.45rem 0 0;
  display: inline-flex;
  padding: 0.42rem 0.65rem;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 800;
  color: #92400e;
  background: color-mix(in srgb, #f59e0b 18%, var(--bb-surface-lowest));
}
.inst {
  margin: 0.85rem 0 0;
  line-height: 1.6;
  font-size: 1.04rem;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.tip {
  margin-top: 0.8rem;
  padding: 0.65rem 0.75rem;
  border-radius: 10px;
  background: color-mix(in srgb, #3b82f6 12%, var(--bb-surface-lowest));
  color: #1e3a8a;
  font-weight: 700;
  font-size: 0.9rem;
}
.speech-row {
  margin-top: 0.7rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}
.speech-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--bb-muted);
  font-size: 0.88rem;
  font-weight: 700;
}
.speech-help {
  margin: 0.5rem 0 0;
  color: var(--bb-muted);
  font-size: 0.82rem;
}
.checklist {
  margin-top: 0.85rem;
}
.checklist h3 {
  margin: 0 0 0.4rem;
  font-size: 0.95rem;
}
.check {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
  font-size: 0.92rem;
}
.warn {
  margin-top: 0.7rem;
  border-radius: 10px;
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #991b1b;
  font-size: 0.85rem;
  padding: 0.55rem 0.7rem;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-top: 0.95rem;
}
.done {
  margin-left: auto;
}
.timer-card {
  padding: 0.9rem 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.8rem;
}
.timer-k {
  margin: 0;
  color: var(--bb-muted);
  font-size: 0.85rem;
}
.clock {
  margin: 0.2rem 0 0;
  font-size: 2rem;
  line-height: 1;
  color: color-mix(in srgb, var(--bb-primary) 85%, #2563eb);
  font-family: var(--bb-font-headline);
  font-weight: 900;
}
.timer-actions {
  display: flex;
  gap: 0.55rem;
  flex-wrap: wrap;
}
@media (max-width: 960px) {
  .layout {
    grid-template-columns: 1fr;
  }
  .rail {
    position: relative;
    top: 0;
  }
  .done {
    margin-left: 0;
    flex: 1;
  }
}
</style>

