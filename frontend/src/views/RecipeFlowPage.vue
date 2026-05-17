<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import SimplifiedRecipeFlow from '../components/flow/SimplifiedRecipeFlow.vue'
import { biteBudUserIdHeader, getBiteBudUserId } from '../composables/useUserId'
import { apiFetch, apiUrl } from '../lib/api'
import { getOrderedRecipeSteps } from '../lib/recipeSteps'
import type { RecipeGraph, RecipeNode } from '../types/recipe'
import type { SensoryConflictResponse } from '../types/sensory'

/** Must match `prepLaneLabel` on SimplifiedRecipeFlow and the Prep chip below. */
const PREP_INGREDIENTS_LANE = 'Prep Ingredients'

const route = useRoute()
const router = useRouter()

const graph = ref<RecipeGraph | null>(null)
const refined = ref<boolean>(true)
const canRefine = ref<boolean>(false)
const completed = ref<string[]>([])
const selected = ref<{
  id: string
  label: string
  detail: string
  ingredientLabels: string[]
} | null>(null)
const loadErr = ref<string | null>(null)
const pageLoading = ref(true)
const activeLane = ref<string | null>(null)
const conflicts = ref<SensoryConflictResponse | null>(null)
const imageUrl = ref<string | null>(null)
const recipeComplexity = ref<string | null>(null)
const recipeTags = ref<string[]>([])
const recipeLede = ref<string | null>(null)
const roadmapView = ref<'visual' | 'full'>('visual')

const recipeId = computed(() => route.params.id as string)
const ingredients = computed(() => graph.value?.nodes.filter((node) => node.type === 'ingredient') ?? [])
const stepNodes = computed(() => (graph.value ? getOrderedRecipeSteps(graph.value) : []))
const timelineNodes = computed(() => stepNodes.value)
const lanes = computed(() => [
  ...new Set(stepNodes.value.map((step) => step.lane).filter((lane): lane is string => Boolean(lane))),
])

const displayHeroImageUrl = computed(() => {
  if (!graph.value) return null
  return imageUrl.value ?? graph.value.heroImageUrl ?? null
})
const hasHeroImage = computed(() => Boolean(displayHeroImageUrl.value))

const hasConflictWarnings = computed(() => {
  const conflict = conflicts.value
  if (!conflict?.hasProfile) return false
  return conflict.sensory.length + conflict.dietary.length > 0
})

const profileMatchText = computed(() => {
  if (!conflicts.value?.hasProfile) return 'No profile linked yet. You can still cook this recipe.'
  if (!hasConflictWarnings.value) return 'This recipe matches your food preferences — all ingredients appear safe or sometimes OK.'
  const conflict = conflicts.value
  const messages: string[] = []
  if (conflict.dietary.length) {
    const uniqueConstraints = [...new Set(conflict.dietary.map((entry) => entry.constraint))]
    messages.push(
      `May conflict with your dietary or cultural settings (${uniqueConstraints.slice(0, 6).join(', ')}${uniqueConstraints.length > 6 ? '…' : ''}).`,
    )
  }
  if (conflict.sensory.length) {
    messages.push('Some ingredients match foods you marked unsafe or unsure.')
  }
  return `${messages.join(' ')} Review the list below before cooking.`
})

const totalMinutes = computed(() => {
  if (graph.value?.totalTimeMinutes != null) return graph.value.totalTimeMinutes
  const sum = stepNodes.value.reduce((acc, step) => acc + Math.max(0, Number(step.timeMinutes ?? 0)), 0)
  return sum || null
})

/** Hero stat: Low / Medium / High effort (API complexity or step count). */
const effortLabel = computed(() => {
  const complexity = recipeComplexity.value?.toLowerCase()
  if (complexity === 'low') return 'Low'
  if (complexity === 'medium') return 'Medium'
  if (complexity === 'high') return 'High'
  const stepCount = stepNodes.value.length
  if (stepCount <= 6) return 'Low'
  if (stepCount <= 10) return 'Medium'
  return 'High'
})

const servingsLabel = computed(() => {
  const servings = Number(graph.value?.servings ?? NaN)
  if (!Number.isFinite(servings) || servings <= 0) return '—'
  return `${Math.round(servings)}`
})

async function load(opts?: { showPageLoading?: boolean }) {
  const showGlobal = opts?.showPageLoading !== false
  if (showGlobal) pageLoading.value = true
  loadErr.value = null
  try {
    const data = await apiFetch<{
      graph: RecipeGraph
      refined?: boolean
      canRefine?: boolean
      imageUrl?: string | null
      lede?: string | null
      complexity?: string | null
      heatLevel?: string | null
      tags?: unknown
    }>(`/api/recipes/${recipeId.value}`, {
      headers: biteBudUserIdHeader(),
    })
    graph.value = data.graph
    refined.value = data.refined ?? true
    canRefine.value = data.canRefine ?? false
    imageUrl.value = data.imageUrl ?? null
    recipeLede.value = data.lede ?? null
    recipeComplexity.value = data.complexity ?? null
    recipeTags.value = Array.isArray(data.tags)
      ? data.tags.filter((tag): tag is string => typeof tag === 'string')
      : []
    const uid = getBiteBudUserId()
    if (uid) {
      const prog = await apiFetch<{ completedNodeIds: string[] }>(`/api/recipes/${recipeId.value}/progress`, {
        headers: { 'X-User-Id': uid },
      })
      completed.value = prog.completedNodeIds ?? []
    } else {
      completed.value = []
    }
  } catch (e) {
    loadErr.value = e instanceof Error ? e.message : 'Failed to load recipe'
  } finally {
    if (showGlobal) pageLoading.value = false
  }
}

const refining = ref(false)
const refineErr = ref<string | null>(null)

async function refineWithAi() {
  refineErr.value = null
  refining.value = true
  try {
    await apiFetch(`/api/recipes/${recipeId.value}/refine`, { method: 'POST' })
    await load({ showPageLoading: false })
  } catch {
    refineErr.value = "Couldn’t refine right now. Please try again later."
  } finally {
    refining.value = false
  }
}

async function loadConflicts() {
  const uid = getBiteBudUserId()
  if (!uid) {
    conflicts.value = null
    return
  }
  try {
    conflicts.value = await apiFetch<SensoryConflictResponse>(`/api/recipes/${recipeId.value}/sensory-conflicts`, {
      headers: { 'X-User-Id': uid },
    })
  } catch {
    conflicts.value = null
  }
}

onMounted(async () => {
  await load()
  await loadConflicts()
})

function ingredientLabelsForStep(step: RecipeNode): string[] {
  if (!graph.value || !step.ingredientIds?.length) return []
  const labelById = new Map(graph.value.nodes.map((node) => [node.id, node.label]))
  return step.ingredientIds.map((id) => labelById.get(id)).filter((label): label is string => Boolean(label))
}

function onSelectStep(payload: { id: string; label: string; detail: string; ingredientLabels: string[] }) {
  selected.value = payload
}

function ingredientSensoryKind(label: string): 'safe' | 'unsafe' | 'unsure' {
  const conflict = conflicts.value
  if (!conflict?.hasProfile) return 'safe'
  const match = conflict.sensory.find((sensoryItem) => sensoryItem.label.toLowerCase() === label.toLowerCase())
  if (!match) return 'safe'
  return match.kind === 'unsafe' ? 'unsafe' : 'unsure'
}

function ingredientSensoryDisplay(label: string): string {
  const kind = ingredientSensoryKind(label)
  if (kind === 'safe') return 'Safe'
  if (kind === 'unsafe') return 'Avoid'
  return 'Check'
}

function ingredientDietaryForLabel(label: string) {
  const conflict = conflicts.value
  if (!conflict?.hasProfile) return []
  const lowerLabel = label.toLowerCase()
  return conflict.dietary.filter((entry) => entry.label.toLowerCase() === lowerLabel)
}

function timelineHeat(step: RecipeNode): string {
  const text = `${step.label} ${step.detail}`.toLowerCase()
  if (text.includes('boil') || text.includes('fry') || text.includes('medium')) return 'Low-medium heat'
  if (text.includes('low')) return 'Low heat'
  return 'No heat'
}

function timelineEffort(step: RecipeNode): string {
  const t = Number(step.timeMinutes ?? 0)
  if (t >= 8) return 'Low effort'
  if (t >= 4) return 'Medium effort'
  return 'Quick step'
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function closeStepPanel() {
  selected.value = null
}

</script>

<template>
  <div v-if="loadErr" class="page err">
    <p>{{ loadErr }}</p>
    <p class="recipe-flow-back">
      <RouterLink class="recipe-flow-back__link" :to="{ name: 'search' }">Back to recipe search</RouterLink>
    </p>
  </div>
  <div
    v-else-if="pageLoading && !graph"
    class="page load-screen"
    role="status"
    aria-live="polite"
    aria-busy="true"
  >
    <div class="load-screen__inner">
      <div class="spinner" aria-hidden="true" />
      <h1 class="load-screen__title">Loading recipe</h1>
      <p class="load-screen__text">Gathering steps, ingredients, and your cooking flow. This usually takes a moment.</p>
      <p class="recipe-flow-back recipe-flow-back--muted">
        <RouterLink class="recipe-flow-back__link" :to="{ name: 'search' }">Back to recipe search</RouterLink>
      </p>
    </div>
  </div>
  <div v-else-if="!graph" class="page muted">
    <p>Loading…</p>
    <p class="recipe-flow-back">
      <RouterLink class="recipe-flow-back__link" :to="{ name: 'search' }">Back to recipe search</RouterLink>
    </p>
  </div>
  <div v-else class="page">
    <p class="recipe-flow-back">
      <RouterLink class="recipe-flow-back__link" :to="{ name: 'search' }">Back to recipe search</RouterLink>
    </p>
    <div v-if="!refined" class="ai-banner" role="status">
      <strong>AI is busy right now.</strong>
      <span class="ai-note">Showing a simplified guide. You can refine it later.</span>
      <button v-if="canRefine" type="button" class="mini" :disabled="refining" @click="refineWithAi">
        {{ refining ? 'Refining…' : 'Refine with AI' }}
      </button>
      <span v-else class="ai-note">Refine is unavailable for this recipe.</span>
    </div>
    <p v-if="refining" class="refine-busy" role="status">Refining your recipe—this can take a moment.</p>
    <p v-if="refineErr" class="refine-msg" role="status">{{ refineErr }}</p>

    <nav class="crumbs" aria-label="Breadcrumb">
      <RouterLink to="/search">Recipes</RouterLink>
      <span class="sep" aria-hidden="true">/</span>
      <span class="here">{{ graph.title }}</span>
    </nav>

    <div class="detail-layout" :class="{ 'detail-layout--no-image': !hasHeroImage }">
      <section class="hero-copy">
        <h1>{{ graph.title }}</h1>
        <p v-if="recipeLede" class="lede">{{ recipeLede }}</p>
        <div v-if="!hasHeroImage" class="hero-no-photo" role="note">
          <p class="hero-no-photo__title">No picture for this recipe</p>
          <p class="hero-no-photo__text">
            That is normal when you paste your own recipe. Use the ingredients and steps below—they are what you need to cook.
          </p>
        </div>
        <div class="hero-stats" aria-label="Recipe summary">
          <div class="hero-stat">
            <div class="hero-stat__label">Total time</div>
            <div class="hero-stat__value">{{ totalMinutes != null ? `${totalMinutes} min` : '—' }}</div>
          </div>
          <div class="hero-stat">
            <div class="hero-stat__label">Effort</div>
            <div class="hero-stat__value">{{ effortLabel }}</div>
          </div>
          <div class="hero-stat">
            <div class="hero-stat__label">Servings</div>
            <div class="hero-stat__value">{{ servingsLabel }}</div>
          </div>
        </div>
        <div v-if="recipeTags.length > 1" class="hero-tags">
          <span v-for="tag in recipeTags.slice(1, 5)" :key="tag" class="chip">{{ tag }}</span>
        </div>

        <div class="profile-match" :class="{ warn: hasConflictWarnings }">
          {{ profileMatchText }}
        </div>

        <aside class="cooking-cta-card" aria-labelledby="cooking-cta-headline">
          <p class="cooking-cta-card__eyebrow">
            <span class="cooking-cta-card__dot" aria-hidden="true" />
            Ready to start
          </p>
          <h2 id="cooking-cta-headline" class="cooking-cta-card__headline">Begin guided cooking</h2>
          <p class="cooking-cta-card__support">
            Step-by-step with timers, voice prompts, and hands-free mode.
          </p>
          <button
            type="button"
            class="cooking-cta-card__btn bb-btn"
            @click="router.push({ name: 'guidedServings', params: { id: recipeId } })"
          >
            <svg
              class="cooking-cta-card__play"
              viewBox="0 0 24 24"
              width="20"
              height="20"
              aria-hidden="true"
              focusable="false"
            >
              <path fill="currentColor" d="M8 5v14l11-7L8 5z" />
            </svg>
            Start cooking now
          </button>
        </aside>
      </section>

      <div v-if="hasHeroImage" class="hero-media">
        <div class="hero-image">
          <img :src="displayHeroImageUrl!" :alt="graph.title" class="hero-image-img" />
        </div>
      </div>
    </div>

    <section id="cooking-roadmap" class="roadmap-layout" tabindex="-1">
      <article class="panel timeline-panel timeline-panel--full">
        <header class="roadmap-head">
          <h2>Cooking Roadmap</h2>
          <div
            v-if="timelineNodes.length || ingredients.length"
            class="roadmap-view-tabs"
            role="tablist"
            aria-label="Roadmap view"
          >
            <button
              type="button"
              role="tab"
              class="roadmap-tab"
              :class="{ active: roadmapView === 'visual' }"
              :aria-selected="roadmapView === 'visual'"
              @click="roadmapView = 'visual'"
            >
              Visual Overview
            </button>
            <button
              type="button"
              role="tab"
              class="roadmap-tab"
              :class="{ active: roadmapView === 'full' }"
              :aria-selected="roadmapView === 'full'"
              @click="roadmapView = 'full'"
            >
              Full Steps
            </button>
          </div>
        </header>

        <div v-show="roadmapView === 'visual' && (timelineNodes.length || ingredients.length)" class="roadmap-visual">
          <div v-if="ingredients.length || lanes.length" class="lane-list">
            <button type="button" class="mini" :class="{ active: !activeLane }" @click="activeLane = null">Full view</button>
            <button
              v-if="ingredients.length"
              type="button"
              class="mini"
              :class="{ active: activeLane === PREP_INGREDIENTS_LANE }"
              @click="activeLane = PREP_INGREDIENTS_LANE"
            >
              {{ PREP_INGREDIENTS_LANE }}
            </button>
            <button
              v-for="lane in lanes"
              :key="lane"
              type="button"
              class="mini"
              :class="{ active: activeLane === lane }"
              @click="activeLane = lane"
            >
              {{ lane }}
            </button>
          </div>
          <div class="roadmap-flow-panel">
            <SimplifiedRecipeFlow
              embedded
              strip-layout
              :graph="graph"
              :completed-node-ids="completed"
              :active-lane="activeLane"
              :prep-lane-label="PREP_INGREDIENTS_LANE"
              @select-step="onSelectStep"
            />
          </div>
          <div class="roadmap-actions">
            <button type="button" class="mini" @click="scrollToTop">Back to top</button>
          </div>
        </div>

        <details
          v-show="ingredients.length && roadmapView === 'full'"
          id="recipe-prep-ingredients"
          class="full-prep-block"
        >
          <summary class="full-prep-head">
            <span class="full-prep-title">{{ PREP_INGREDIENTS_LANE }}</span>
            <span v-if="graph.servings != null" class="ingredients-servings">{{ graph.servings }} servings</span>
            <span class="full-prep-chevron" aria-hidden="true">⌄</span>
          </summary>
          <ul class="ing-list">
            <li v-for="ing in ingredients" :key="ing.id" class="ing-item">
              <span class="ing-main">
                <img
                  v-if="ing.imageUrl || ing.icon"
                  :src="ing.imageUrl || apiUrl(`/api/icons/wicked/${ing.icon}`)"
                  :alt="ing.label"
                  class="icon"
                />
                <span v-else class="emo" aria-hidden="true">{{ ing.emoji ?? '•' }}</span>
                <span class="ing-name">{{ ing.label }}</span>
                <span v-if="ing.detail && ing.detail !== ing.label" class="ing-detail">{{ ing.detail }}</span>
              </span>
              <span class="status-col">
                <span
                  class="status"
                  :class="{
                    sometimes: ingredientSensoryKind(ing.label) === 'unsure',
                    unsafe: ingredientSensoryKind(ing.label) === 'unsafe',
                  }"
                >
                  {{ ingredientSensoryDisplay(ing.label) }}
                </span>
                <span
                  v-for="d in ingredientDietaryForLabel(ing.label)"
                  :key="d.nodeId + ':' + d.constraint + ':' + d.kind"
                  class="diet-pill"
                >
                  {{ d.kind === 'cultural' ? 'Cultural' : 'Diet' }}: {{ d.constraint }}
                </span>
              </span>
            </li>
          </ul>
        </details>

        <ol v-show="roadmapView === 'full'" class="timeline-list">
          <li v-for="(step, idx) in timelineNodes" :key="step.id" class="timeline-item">
            <div class="timeline-icon">{{ step.emoji ?? '•' }}</div>
            <div class="timeline-body">
              <h3>Step {{ idx + 1 }} — {{ step.label }}</h3>
              <div class="timeline-meta">
                <span>{{ step.timeMinutes ?? 1 }} min</span>
                <span>{{ timelineHeat(step) }}</span>
                <span>{{ timelineEffort(step) }}</span>
              </div>
              <div class="timeline-actions">
                <details class="timeline-details">
                  <summary class="mini">View details</summary>
                  <div class="timeline-details__body">
                    <p class="timeline-details__text">{{ step.detail }}</p>
                    <div v-if="ingredientLabelsForStep(step).length">
                      <div class="timeline-details__label">Ingredients for this step</div>
                      <ul class="timeline-details__list">
                        <li v-for="label in ingredientLabelsForStep(step)" :key="label">{{ label }}</li>
                      </ul>
                    </div>
                  </div>
                </details>
              </div>
            </div>
          </li>
        </ol>
        <div v-show="roadmapView === 'full'" class="roadmap-actions">
          <button type="button" class="mini" @click="scrollToTop">Back to top</button>
        </div>
      </article>
    </section>

    <div v-if="selected" class="panel-host" role="presentation" @click.self="closeStepPanel">
      <aside class="panel-step" role="dialog" aria-labelledby="step-panel-title" @click.stop>
        <h3 id="step-panel-title">{{ selected.label }}</h3>
        <p class="detail">{{ selected.detail }}</p>
        <div v-if="selected.ingredientLabels.length">
          <h4>Ingredients for this step</h4>
          <ul>
            <li v-for="l in selected.ingredientLabels" :key="l">{{ l }}</li>
          </ul>
        </div>
        <button type="button" class="mini" @click="closeStepPanel">Close</button>
      </aside>
    </div>

    <div v-if="hasConflictWarnings && conflicts" class="conflict-banner" role="alert">
      <strong>Ingredient checks</strong>
      <p class="conflict-intro">These ingredients may overlap your profile (heuristic match—not medical advice):</p>
      <ul>
        <li v-for="(s, idx) in conflicts.sensory" :key="`s${idx}`">{{ s.label }} — {{ s.kind }} ({{ s.matchedFood }})</li>
        <li v-for="(d, idx) in conflicts.dietary" :key="`d${idx}`">{{ d.label }} — {{ d.kind }}: {{ d.constraint }}</li>
      </ul>
      <p v-if="conflicts.disclaimer" class="fineprint">{{ conflicts.disclaimer }}</p>
    </div>
  </div>
</template>

<style scoped>
.page {
  padding: 1rem 1.25rem 2.25rem;
  max-width: 64rem;
  margin: 0 auto;
}
.err {
  color: #b91c1c;
}
.muted {
  color: var(--bb-muted);
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
.recipe-flow-back {
  margin: 1rem 0 0;
}
.recipe-flow-back--muted {
  margin-top: 1.25rem;
}
.recipe-flow-back__link {
  font-weight: 700;
  font-size: 0.95rem;
  color: var(--bb-accent);
  text-decoration: none;
}
.recipe-flow-back__link:hover {
  text-decoration: underline;
}
.spinner {
  width: 44px;
  height: 44px;
  margin: 0 auto;
  border: 3px solid color-mix(in srgb, var(--bb-muted) 25%, transparent);
  border-top-color: var(--bb-primary);
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.refine-busy {
  margin: 0 0 0.65rem;
  padding: 0.55rem 0.75rem;
  border-radius: 10px;
  background: var(--bb-surface-low);
  border: 1px solid color-mix(in srgb, var(--bb-primary) 12%, transparent);
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--bb-text);
}
.crumbs {
  font-size: 0.9rem;
  margin-bottom: 0.85rem;
  color: var(--bb-muted);
}
.crumbs a {
  color: var(--bb-accent);
  text-decoration: none;
  font-weight: 700;
}
.sep {
  margin: 0 0.35rem;
}
.here {
  color: var(--bb-text);
  font-weight: 600;
}

.ai-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  padding: 0.7rem 0.9rem;
  border-radius: 12px;
  background: var(--bb-surface-low);
  box-shadow: 0 12px 32px rgba(26, 28, 25, 0.04);
  margin-bottom: 0.75rem;
  color: var(--bb-text);
  font-size: 0.92rem;
}
.ai-note {
  color: var(--bb-muted);
}
.refine-msg {
  color: var(--bb-muted);
  margin: 0.45rem 0 0.8rem;
  font-size: 0.9rem;
}

.detail-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.12fr) minmax(0, 0.88fr);
  gap: 1.1rem;
  margin-bottom: 1rem;
  align-items: stretch;
}
.detail-layout--no-image {
  grid-template-columns: 1fr;
}
.hero-media,
.hero-copy {
  background: var(--bb-surface-low);
  border: 1px solid var(--bb-border);
  border-radius: 18px;
  box-shadow: 0 14px 40px rgba(26, 28, 25, 0.05);
}
.hero-media {
  padding: 0.65rem;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  align-self: stretch;
}
.hero-image {
  flex: 1;
  border-radius: 14px;
  min-height: 12rem;
  background: var(--bb-surface-lowest);
  display: flex;
  overflow: hidden;
}
.hero-image-img {
  width: 100%;
  height: 100%;
  min-height: 12rem;
  object-fit: cover;
  border-radius: 14px;
}
.hero-copy {
  padding: 1.25rem 1.35rem 1.15rem;
}
.hero-no-photo {
  margin-top: 0.65rem;
  padding: 0.75rem 0.85rem;
  border-radius: 12px;
  background: var(--bb-surface-lowest);
  border: 1px solid color-mix(in srgb, var(--bb-primary) 12%, transparent);
}
.hero-no-photo__title {
  margin: 0;
  font-family: var(--bb-font-headline);
  font-size: 0.98rem;
  font-weight: 800;
  color: var(--bb-text);
}
.hero-no-photo__text {
  margin: 0.4rem 0 0;
  font-size: 0.88rem;
  line-height: 1.55;
  color: var(--bb-muted);
}
.hero-stats {
  margin-top: 0.85rem;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem 1rem;
}
.hero-stat {
  padding: 0.55rem 0.65rem;
  border-radius: 12px;
  background: var(--bb-surface-lowest);
  border: 1px solid color-mix(in srgb, var(--bb-primary) 10%, transparent);
}
.hero-stat__label {
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--bb-muted);
}
.hero-stat__value {
  margin-top: 0.2rem;
  font-family: var(--bb-font-headline);
  font-size: 1.22rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--bb-text);
}
.hero-tags {
  margin-top: 0.55rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}
.cooking-cta-card {
  margin-top: 0.85rem;
  padding: 1.2rem 1.25rem;
  border-radius: 16px;
  background: var(--bb-surface-lowest);
  border: 2px solid color-mix(in srgb, var(--bb-primary) 28%, var(--bb-border));
  box-shadow: 0 14px 36px rgba(26, 28, 25, 0.07);
}
.cooking-cta-card__eyebrow {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--bb-muted);
}
.cooking-cta-card__dot {
  flex-shrink: 0;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #16a34a;
}
.cooking-cta-card__headline {
  margin: 0.4rem 0 0;
  font-family: var(--bb-font-headline);
  font-size: 1.5rem;
  font-weight: 900;
  letter-spacing: -0.02em;
  color: var(--bb-text);
}
.cooking-cta-card__support {
  margin: 0.4rem 0 1rem;
  font-size: 0.95rem;
  line-height: 1.55;
  color: var(--bb-muted);
}
.cooking-cta-card__btn {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.8rem 1.15rem;
  font-size: 1rem;
  font-weight: 700;
  background: var(--bb-text);
  color: var(--bb-surface-lowest);
  border: none;
}
.cooking-cta-card__btn:hover {
  background: color-mix(in srgb, var(--bb-text) 88%, #000);
}
.cooking-cta-card__btn:focus-visible {
  outline: 2px solid var(--bb-focus-ring);
  outline-offset: 2px;
}
.cooking-cta-card__play {
  flex-shrink: 0;
  opacity: 0.95;
}
.cooking-cta-card__footnote {
  margin: 0.65rem 0 0;
  font-size: 0.82rem;
  color: var(--bb-muted);
  text-align: center;
}
.roadmap-visual {
  margin-bottom: 0.5rem;
}
.roadmap-visual .lane-list {
  margin-bottom: 0.5rem;
}
.roadmap-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 0.6rem;
}
.roadmap-flow-panel {
  overflow: visible;
  border-radius: 14px;
  padding-bottom: 0.25rem;
}
.roadmap-flow-panel :deep(.wrap) {
  min-height: 0;
}
.roadmap-flow-panel :deep(.wrap.stripLayout) {
  min-height: 0;
}
.roadmap-view-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  flex-shrink: 0;
}
.roadmap-tab {
  border: 1px solid color-mix(in srgb, var(--bb-primary) 22%, transparent);
  border-radius: 999px;
  padding: 0.35rem 0.75rem;
  background: var(--bb-surface-lowest);
  cursor: pointer;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--bb-text);
}
.roadmap-tab.active {
  background: color-mix(in srgb, var(--bb-primary) 88%, transparent);
  color: var(--bb-surface-lowest);
  border-color: transparent;
}
.ingredients-servings {
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--bb-muted);
  white-space: nowrap;
}
.ingredients-servings--muted {
  font-weight: 600;
  opacity: 0.85;
}

.hero-copy h1 {
  margin: 0;
  font-family: var(--bb-font-headline);
  font-weight: 900;
  letter-spacing: -0.02em;
  font-size: clamp(1.95rem, 4.2vw, 2.5rem);
}
.hero-copy .lede {
  font-size: 0.98rem;
}
.lede {
  margin: 0.5rem 0 0;
  color: var(--bb-muted);
  line-height: 1.55;
}
.chips {
  margin-top: 0.8rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}
.chip {
  padding: 0.35rem 0.55rem;
  border-radius: 999px;
  font-size: 0.77rem;
  font-weight: 700;
  background: var(--bb-surface-lowest);
  border: 1px solid color-mix(in srgb, var(--bb-primary) 10%, transparent);
}
.profile-match {
  margin-top: 0.9rem;
  padding: 0.7rem 0.8rem;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, #16a34a 45%, transparent);
  background: color-mix(in srgb, #16a34a 12%, var(--bb-surface-lowest));
  color: color-mix(in srgb, var(--bb-text) 90%, #14532d);
  font-size: 0.88rem;
  font-weight: 700;
}
.profile-match.warn {
  border-color: #fecaca;
  background: #fff1f2;
  color: #9f1239;
}
.roadmap-layout {
  margin-bottom: 1rem;
}
.timeline-panel--full {
  width: 100%;
  max-width: none;
}
.full-prep-block {
  margin: 0 0 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid color-mix(in srgb, var(--bb-muted) 18%, transparent);
}
.full-prep-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.65rem;
  flex-wrap: wrap;
}
.full-prep-block > summary {
  cursor: pointer;
  list-style: none;
}
.full-prep-block > summary::-webkit-details-marker {
  display: none;
}
.full-prep-title {
  font-family: var(--bb-font-headline);
  font-size: 1.05rem;
  font-weight: 800;
}
.full-prep-chevron {
  margin-left: auto;
  font-size: 1.1rem;
  transition: transform 0.2s ease;
}
.full-prep-block[open] .full-prep-chevron {
  transform: rotate(180deg);
}
.panel {
  background: var(--bb-surface-low);
  border: 1px solid var(--bb-border);
  border-radius: 16px;
  padding: 1rem;
  box-shadow: 0 12px 30px rgba(26, 28, 25, 0.04);
}
.panel h2 {
  margin: 0 0 0.65rem;
  font-family: var(--bb-font-headline);
  font-size: 1.12rem;
}
.ing-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0.55rem;
}
.ing-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.55rem;
  border-radius: 12px;
  background: var(--bb-surface-lowest);
  border: 1px solid var(--bb-border);
}
.ing-main {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 700;
}
.icon {
  width: 24px;
  height: 24px;
  object-fit: cover;
  border-radius: 6px;
}
.emo {
  font-size: 1.1rem;
}
.status-col {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.28rem;
  flex-shrink: 0;
  max-width: min(48%, 14rem);
  text-align: right;
}
.status {
  padding: 0.22rem 0.55rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 800;
  background: color-mix(in srgb, #16a34a 15%, var(--bb-surface-lowest));
  color: #166534;
}
.status.sometimes {
  background: color-mix(in srgb, #f59e0b 16%, var(--bb-surface-lowest));
  color: #92400e;
}
.status.unsafe {
  background: color-mix(in srgb, #ef4444 14%, var(--bb-surface-lowest));
  color: #991b1b;
}
.diet-pill {
  display: inline-block;
  padding: 0.18rem 0.45rem;
  border-radius: 8px;
  font-size: 0.65rem;
  font-weight: 800;
  line-height: 1.25;
  background: color-mix(in srgb, var(--bb-primary) 10%, var(--bb-surface-low));
  color: var(--bb-text);
  border: 1px solid color-mix(in srgb, var(--bb-primary) 18%, transparent);
}

.timeline-panel .roadmap-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  margin-bottom: 0.8rem;
}
.timeline-panel .roadmap-head h2 {
  margin: 0;
  font-family: var(--bb-font-headline);
}
.timeline-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0.7rem;
}
.timeline-item {
  display: grid;
  grid-template-columns: 40px 1fr;
  gap: 0.75rem;
  padding: 0.75rem;
  border-radius: 12px;
  background: var(--bb-surface-lowest);
}
.timeline-icon {
  width: 38px;
  height: 38px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--bb-primary) 12%, transparent);
  font-size: 1.1rem;
}
.timeline-body h3 {
  margin: 0;
  font-size: 1.02rem;
}
.timeline-body p {
  margin: 0.35rem 0;
  color: var(--bb-muted);
}
.timeline-meta {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  font-size: 0.82rem;
  color: var(--bb-muted);
}
.timeline-actions {
  margin-top: 0.5rem;
  display: flex;
  gap: 0.55rem;
  flex-wrap: wrap;
  align-items: center;
}
.timeline-details {
  width: 100%;
}
.timeline-details__body {
  margin-top: 0.45rem;
  padding-top: 0.55rem;
  border-top: 1px solid color-mix(in srgb, var(--bb-border) 80%, transparent);
}
.timeline-details__text {
  margin: 0;
  color: var(--bb-muted);
  line-height: 1.5;
  white-space: pre-wrap;
}
.timeline-details__label {
  margin-top: 0.55rem;
  font-size: 0.8rem;
  font-weight: 800;
}
.timeline-details__list {
  margin: 0.35rem 0 0;
  padding-left: 1rem;
  color: var(--bb-muted);
  line-height: 1.45;
}

.lane-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.mini {
  border: 1px solid color-mix(in srgb, var(--bb-primary) 20%, transparent);
  border-radius: 10px;
  padding: 0.35rem 0.55rem;
  background: var(--bb-surface-lowest);
  color: var(--bb-text);
  cursor: pointer;
  font: inherit;
}
.mini:hover {
  border-color: color-mix(in srgb, var(--bb-primary) 40%, transparent);
}
.mini.active {
  background: color-mix(in srgb, var(--bb-accent) 12%, transparent);
  border-color: var(--bb-accent);
  color: var(--bb-text);
}

.panel-host {
  position: fixed;
  inset: 0;
  z-index: 55;
  background: rgba(28, 25, 23, 0.38);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}
.panel-step {
  width: min(680px, 100%);
  max-height: 80vh;
  overflow-y: auto;
  padding: 1rem;
  border-radius: 14px;
  background: var(--bb-surface);
  border: 1px solid var(--bb-border);
}
.panel-step h3 {
  margin: 0 0 0.5rem;
}
.detail {
  margin: 0 0 0.7rem;
  white-space: pre-wrap;
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.conflict-banner {
  margin-top: 1rem;
  padding: 0.75rem 0.9rem;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--bb-error) 35%, var(--bb-border));
  background: #fef2f2;
  font-size: 0.9rem;
}
.conflict-intro {
  margin: 0.35rem 0;
  color: var(--bb-muted);
}
.conflict-banner ul {
  margin: 0.35rem 0 0;
  padding-left: 1.2rem;
}
.fineprint {
  font-size: 0.75rem;
  color: var(--bb-muted);
  margin: 0.5rem 0 0;
}

.profile-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.85rem;
  padding: 0.55rem 0.75rem;
  background: var(--bb-accent-soft);
  border: 1px solid var(--bb-border);
  border-radius: 10px;
  margin-top: 1rem;
  font-size: 0.9rem;
}
.chip-label {
  font-weight: 800;
  color: var(--bb-accent);
}
.strip-note {
  color: var(--bb-muted);
  flex: 1;
  min-width: 12rem;
}
.edit {
  font-weight: 700;
  color: var(--bb-accent);
}

@media (max-width: 960px) {
  .detail-layout {
    grid-template-columns: 1fr;
    align-items: start;
  }
  .hero-media {
    align-self: start;
  }
  .hero-image {
    flex: none;
    min-height: 0;
    max-height: 200px;
    aspect-ratio: 16 / 10;
  }
  .hero-image-img {
    min-height: 0;
    max-height: 200px;
    height: auto;
  }
  .timeline-panel .roadmap-head {
    flex-direction: column;
    align-items: stretch;
    gap: 0.55rem;
  }
  .timeline-panel .roadmap-head h2 {
    font-size: clamp(1.05rem, 4vw, 1.12rem);
    line-height: 1.25;
    overflow-wrap: break-word;
  }
  .roadmap-view-tabs {
    width: 100%;
    justify-content: flex-start;
  }
  .roadmap-tab {
    white-space: normal;
    text-align: center;
    line-height: 1.25;
  }
  .roadmap-layout,
  .roadmap-flow-panel,
  .timeline-panel {
    min-width: 0;
  }
  .roadmap-flow-panel :deep(.wrap.stripLayout) {
    max-width: 100%;
    overflow-x: hidden;
  }
  .roadmap-flow-panel :deep(.flow-lane-heading),
  .roadmap-flow-panel :deep(.flow-lane-heading--summary),
  .roadmap-flow-panel :deep(.step-title--full),
  .roadmap-flow-panel :deep(.bubble__txt) {
    overflow-wrap: break-word;
    word-break: break-word;
  }
  .roadmap-flow-panel :deep(.flow-lane-heading--summary span:first-child) {
    min-width: 0;
    flex: 1;
  }
}
</style>

