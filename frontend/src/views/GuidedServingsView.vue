<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { biteBudUserIdHeader } from '../composables/useUserId'
import { apiFetch } from '../lib/api'
import type { RecipeGraph } from '../types/recipe'

const route = useRoute()
const router = useRouter()
const recipeId = computed(() => String(route.params.id ?? ''))

const loading = ref(true)
const error = ref<string | null>(null)
const title = ref('Recipe')
const defaultServings = ref(2)
const selectedServings = ref(2)

function storageKey(id: string): string {
  return `bitebud:servings:${id}`
}

function clampServings(v: number): number {
  const n = Math.round(v)
  return Math.max(1, Math.min(16, n))
}

function adjust(delta: number) {
  selectedServings.value = clampServings(selectedServings.value + delta)
}

function goBack() {
  void router.push({ name: 'recipe', params: { id: recipeId.value } })
}

function continueToGuided() {
  try {
    sessionStorage.setItem(storageKey(recipeId.value), String(selectedServings.value))
  } catch {
    // ignore storage failures
  }
  void router.push({
    name: 'guidedFlavors',
    params: { id: recipeId.value },
    query: {
      servings: String(selectedServings.value),
      baseServings: String(defaultServings.value),
    },
  })
}

onMounted(async () => {
  loading.value = true
  error.value = null
  try {
    const data = await apiFetch<{ graph: RecipeGraph }>(`/api/recipes/${recipeId.value}`, {
      headers: biteBudUserIdHeader(),
    })
    title.value = data.graph.title || 'Recipe'
    const base = Number(data.graph.servings ?? NaN)
    defaultServings.value = Number.isFinite(base) && base > 0 ? clampServings(base) : 2
    selectedServings.value = defaultServings.value
    try {
      const saved = Number(sessionStorage.getItem(storageKey(recipeId.value)))
      if (Number.isFinite(saved) && saved > 0) selectedServings.value = clampServings(saved)
    } catch {
      // ignore storage failures
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load recipe'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="servings-page">
    <p v-if="error" class="err">{{ error }}</p>
    <div v-else-if="loading" class="servings-card servings-card--loading">Loading servings…</div>
    <section v-else class="servings-card">
      <header class="servings-head">
        <h1 class="brand">BiteBud</h1>
        <p class="step-indicator">Servings</p>
      </header>

      <p class="chip">Servings</p>
      <h2 class="title">How many servings?</h2>
      <p class="sub">The ingredient amounts will adjust automatically for {{ title }}.</p>

      <div class="control" role="group" aria-label="Adjust servings">
        <button type="button" class="btn btn--ghost" @click="adjust(-1)" :disabled="selectedServings <= 1">−</button>
        <p class="value">{{ selectedServings }}</p>
        <button type="button" class="btn btn--ghost" @click="adjust(1)" :disabled="selectedServings >= 16">+</button>
      </div>

      <p class="hint">Default: {{ defaultServings }} servings</p>

      <footer class="actions">
        <button type="button" class="bb-btn btn-back" @click="goBack">← Back</button>
        <button type="button" class="bb-btn bb-btn--primary btn-next" @click="continueToGuided">Continue →</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.servings-page {
  max-width: 30rem;
  margin: 0 auto;
  padding: 1.5rem 1rem 2rem;
}
.err {
  color: var(--bb-error);
}
.servings-card {
  background: var(--bb-surface-low);
  border: 1px solid var(--bb-border);
  border-radius: 22px;
  box-shadow: 0 12px 30px rgba(26, 28, 25, 0.06);
  padding: 1.15rem 1.2rem 1rem;
  min-height: 72vh;
  display: flex;
  flex-direction: column;
}
.servings-card--loading {
  min-height: 14rem;
  justify-content: center;
  align-items: center;
  color: var(--bb-muted);
}
.servings-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.brand {
  margin: 0;
  font-family: var(--bb-font-headline);
  color: var(--bb-primary);
  font-size: 2rem;
  font-weight: 900;
}
.step-indicator {
  margin: 0;
  color: var(--bb-muted);
  font-weight: 700;
}
.chip {
  margin: 0.85rem 0 0;
  display: inline-flex;
  align-items: center;
  width: fit-content;
  border-radius: 999px;
  background: color-mix(in srgb, #3fbf7f 22%, var(--bb-surface-lowest));
  color: #1f6d4a;
  padding: 0.2rem 0.65rem;
  font-weight: 700;
  font-size: 0.85rem;
}
.title {
  margin: 0.75rem 0 0;
  font-family: var(--bb-font-headline);
  font-size: clamp(1.8rem, 5vw, 2.4rem);
  line-height: 1.15;
}
.sub {
  margin: 0.35rem 0 0;
  color: var(--bb-muted);
  line-height: 1.45;
}
.control {
  margin-top: 1.15rem;
  border: 1px solid var(--bb-border);
  border-radius: 18px;
  padding: 0.85rem;
  background: var(--bb-surface-lowest);
  display: grid;
  grid-template-columns: 56px 1fr 56px;
  align-items: center;
  gap: 0.65rem;
}
.btn {
  height: 44px;
  border-radius: 12px;
  border: 1px solid var(--bb-border);
  background: var(--bb-surface-lowest);
  color: var(--bb-text);
  font-size: 1.6rem;
  line-height: 1;
  font-weight: 700;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.value {
  margin: 0;
  text-align: center;
  font-family: var(--bb-font-headline);
  font-size: 2.4rem;
  font-weight: 900;
}
.hint {
  margin: 0.65rem 0 0;
  color: var(--bb-muted);
  font-size: 0.9rem;
}
.actions {
  margin-top: auto;
  padding-top: 1rem;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.65rem;
}
.btn-back,
.btn-next {
  min-height: 48px;
  font-weight: 800;
}
</style>
