<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { biteBudUserIdHeader } from '../composables/useUserId'
import { apiFetch } from '../lib/api'

type FlavorKey = 'sweet' | 'salty' | 'sour' | 'bitter' | 'spicy'
type FlavorItem = { key: FlavorKey; label: string; ingredientIds: string[] }

const route = useRoute()
const router = useRouter()
const recipeId = computed(() => String(route.params.id ?? ''))
const servings = computed(() => Number(route.query.servings ?? 2))
const baseServings = computed(() => Number(route.query.baseServings ?? (servings.value || 2)))

const loading = ref(true)
const error = ref<string | null>(null)
const flavors = ref<FlavorItem[]>([])
const sliderValues = ref<Record<FlavorKey, number>>({
  sweet: 0,
  salty: 0,
  sour: 0,
  bitter: 0,
  spicy: 0,
})

const STEPS = [-100, -50, -25, 0, 25, 50, 100] as const

function flavorKeyStorage(id: string): string {
  return `bitebud:flavors:${id}`
}

function flavorMapStorage(id: string): string {
  return `bitebud:flavor-map:${id}`
}

function labelForValue(v: number): string {
  if (v === 0) return 'Normal'
  if (v < 0) return `${Math.abs(v)}% less`
  return `${v}% more`
}

function back() {
  void router.push({
    name: 'guidedServings',
    params: { id: recipeId.value },
    query: { servings: String(servings.value), baseServings: String(baseServings.value) },
  })
}

function continueToCook() {
  const active: Record<string, number> = {}
  for (const f of flavors.value) active[f.key] = sliderValues.value[f.key]
  try {
    sessionStorage.setItem(flavorKeyStorage(recipeId.value), JSON.stringify(active))
    sessionStorage.setItem(flavorMapStorage(recipeId.value), JSON.stringify(flavors.value))
  } catch {
    // ignore
  }
  void router.push({
    name: 'guided',
    params: { id: recipeId.value },
    query: {
      servings: String(servings.value),
      baseServings: String(baseServings.value),
    },
  })
}

onMounted(async () => {
  loading.value = true
  error.value = null
  try {
    const data = await apiFetch<{ flavors: FlavorItem[] }>(`/api/recipes/${recipeId.value}/flavors`, {
      headers: biteBudUserIdHeader(),
    })
    flavors.value = (data.flavors ?? []).filter((f) => f.ingredientIds?.length)
    try {
      const raw = sessionStorage.getItem(flavorKeyStorage(recipeId.value))
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>
        for (const f of flavors.value) {
          const n = Number(parsed[f.key])
          if (STEPS.includes(n as any)) sliderValues.value[f.key] = n
        }
      }
    } catch {
      // ignore
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load flavors'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="flavor-page">
    <p v-if="error" class="err">{{ error }}</p>
    <div v-else-if="loading" class="card">Loading flavors…</div>
    <section v-else class="card">
      <h1 class="title">Adjust your flavors</h1>
      <p class="sub">Move each slider left to reduce a flavour, or right to increase it.</p>

      <div v-if="flavors.length === 0" class="none">No adjustable flavor ingredients were detected for this recipe.</div>

      <div v-for="flavor in flavors" :key="flavor.key" class="row">
        <div class="row-head">
          <h3>{{ flavor.label }}</h3>
          <p>{{ labelForValue(sliderValues[flavor.key]) }}</p>
        </div>
        <input
          v-model.number="sliderValues[flavor.key]"
          class="slider"
          type="range"
          :min="-100"
          :max="100"
          :step="25"
          list="flavor-steps"
        />
        <div class="scale-text">
          <span>100% less</span>
          <span>50% less</span>
          <span>25% less</span>
          <span>Normal</span>
          <span>25% more</span>
          <span>50% more</span>
          <span>100% more</span>
        </div>
      </div>
      <datalist id="flavor-steps">
        <option v-for="s in STEPS" :key="s" :value="s" />
      </datalist>

      <p class="foot">
        These controls update ingredient amounts used for each flavor in guided cooking.
      </p>

      <div class="actions">
        <button type="button" class="bb-btn" @click="back">← Back</button>
        <button type="button" class="bb-btn bb-btn--primary" @click="continueToCook">Continue →</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.flavor-page {
  max-width: 32rem;
  margin: 0 auto;
  padding: 1.5rem 1rem 2rem;
}
.err {
  color: var(--bb-error);
}
.card {
  background: var(--bb-surface-low);
  border: 1px solid var(--bb-border);
  border-radius: 22px;
  box-shadow: 0 12px 30px rgba(26, 28, 25, 0.06);
  padding: 1.1rem 1rem;
}
.title {
  margin: 0;
  font-family: var(--bb-font-headline);
  font-size: 2.1rem;
}
.sub {
  margin: 0.6rem 0 0;
  color: var(--bb-muted);
}
.none {
  margin-top: 0.9rem;
  padding: 0.75rem;
  border-radius: 10px;
  background: var(--bb-surface-lowest);
  border: 1px solid var(--bb-border);
  color: var(--bb-muted);
}
.row {
  margin-top: 0.8rem;
  background: var(--bb-surface-lowest);
  border: 1px solid var(--bb-border);
  border-radius: 14px;
  padding: 0.7rem 0.8rem;
}
.row-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.row-head h3 {
  margin: 0;
  font-size: 1.15rem;
}
.row-head p {
  margin: 0;
  color: var(--bb-muted);
  font-weight: 700;
}
.slider {
  width: 100%;
  margin-top: 0.5rem;
}
.scale-text {
  margin-top: 0.35rem;
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0.2rem;
  font-size: 0.66rem;
  color: var(--bb-muted);
}
.scale-text span {
  text-align: center;
}
.foot {
  margin: 0.9rem 0 0;
  color: var(--bb-muted);
  font-size: 0.92rem;
}
.actions {
  margin-top: 1rem;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}
</style>
