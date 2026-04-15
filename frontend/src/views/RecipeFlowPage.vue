<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import SimplifiedRecipeFlow from '../components/flow/SimplifiedRecipeFlow.vue'
import { useSensoryProfile } from '../composables/useSensoryProfile'
import { biteBudUserIdHeader, getBiteBudUserId } from '../composables/useUserId'
import { useSettings } from '../composables/useSettings'
import { apiFetch } from '../lib/api'
import { getOrderedRecipeSteps } from '../lib/recipeSteps'
import type { RecipeGraph, RecipeNode } from '../types/recipe'
import type { SensoryConflictResponse } from '../types/sensory'

/** Must match `prepLaneLabel` on SimplifiedRecipeFlow and the Prep chip below. */
const PREP_INGREDIENTS_LANE = 'Prep Ingredients'

const route = useRoute()
const router = useRouter()
const { hasProfile, profile, loading: profileLoading } = useSensoryProfile()
const { settings } = useSettings()

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
const roadmapView = ref<'visual' | 'full'>('visual')

const recipeId = computed(() => route.params.id as string)
const ingredients = computed(() => graph.value?.nodes.filter((n) => n.type === 'ingredient') ?? [])
const stepNodes = computed(() => (graph.value ? getOrderedRecipeSteps(graph.value) : []))
const timelineNodes = computed(() => stepNodes.value)
const lanes = computed(() => [...new Set(stepNodes.value.map((n) => n.lane).filter((x): x is string => Boolean(x)))])

const displayHeroImageUrl = computed(() => {
  if (!graph.value) return null
  return imageUrl.value ?? graph.value.heroImageUrl ?? null
})
const hasHeroImage = computed(() => Boolean(displayHeroImageUrl.value))

const hasConflictWarnings = computed(() => {
  const c = conflicts.value
  if (!c?.hasProfile) return false
  return c.sensory.length + c.dietary.length > 0
})

const profileMatchText = computed(() => {
  if (!conflicts.value?.hasProfile) return 'No profile linked yet. You can still cook this recipe.'
  if (!hasConflictWarnings.value) return 'This recipe matches your sensory profile — all ingredients appear safe or sometimes OK.'
  const c = conflicts.value
  const bits: string[] = []
  if (c.dietary.length) {
    const uniq = [...new Set(c.dietary.map((d) => d.constraint))]
    bits.push(`May conflict with your dietary or cultural settings (${uniq.slice(0, 6).join(', ')}${uniq.length > 6 ? '…' : ''}).`)
  }
  if (c.sensory.length) {
    bits.push('Some ingredients match foods you marked unsafe or unsure.')
  }
  return `${bits.join(' ')} Review the list below before cooking.`
})

const totalMinutes = computed(() => {
  if (graph.value?.totalTimeMinutes != null) return graph.value.totalTimeMinutes
  const sum = stepNodes.value.reduce((acc, s) => acc + Math.max(0, Number(s.timeMinutes ?? 0)), 0)
  return sum || null
})

/** Hero stat: Low / Medium / High effort (API complexity or step count). */
const effortLabel = computed(() => {
  const c = recipeComplexity.value?.toLowerCase()
  if (c === 'low') return 'Low'
  if (c === 'medium') return 'Medium'
  if (c === 'high') return 'High'
  const count = stepNodes.value.length
  if (count <= 6) return 'Low'
  if (count <= 10) return 'Medium'
  return 'High'
})

function playChime() {
  if (!settings.value.stepChime) return
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.value = 0.0001
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, settings.value.volume), ctx.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18)
    osc.stop(ctx.currentTime + 0.2)
    osc.onended = () => ctx.close()
  } catch {
    // ignore
  }
}

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
    recipeComplexity.value = data.complexity ?? null
    recipeTags.value = Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === 'string') : []
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
  const byId = new Map(graph.value.nodes.map((n) => [n.id, n.label]))
  return step.ingredientIds.map((id) => byId.get(id)).filter((v): v is string => Boolean(v))
}

function onSelectStep(payload: { id: string; label: string; detail: string; ingredientLabels: string[] }) {
  selected.value = payload
}

async function toggleStepDone(stepId: string) {
  if (!graph.value) return
  const uid = getBiteBudUserId()
  if (!uid) return
  const set = new Set(completed.value)
  const wasDone = set.has(stepId)
  if (wasDone) set.delete(stepId)
  else set.add(stepId)
  const next = [...set]
  await apiFetch(`/api/recipes/${recipeId.value}/progress`, {
    method: 'POST',
    body: JSON.stringify({ completedNodeIds: next }),
    headers: { 'X-User-Id': uid },
  })
  completed.value = next
  if (!wasDone) playChime()
}

function closeStepPanel() {
  selected.value = null
}

function ingredientSensoryKind(label: string): 'safe' | 'unsafe' | 'unsure' {
  const c = conflicts.value
  if (!c?.hasProfile) return 'safe'
  const match = c.sensory.find((x) => x.label.toLowerCase() === label.toLowerCase())
  if (!match) return 'safe'
  return match.kind === 'unsafe' ? 'unsafe' : 'unsure'
}

function ingredientSensoryDisplay(label: string): string {
  const k = ingredientSensoryKind(label)
  if (k === 'safe') return 'Safe'
  if (k === 'unsafe') return 'Avoid'
  return 'Check'
}

function ingredientDietaryForLabel(label: string) {
  const c = conflicts.value
  if (!c?.hasProfile) return []
  const low = label.toLowerCase()
  return c.dietary.filter((d) => d.label.toLowerCase() === low)
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

</script>

<template>
  <div v-if="loadErr" class="page err">{{ loadErr }}</div>
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
    </div>
  </div>
  <div v-else-if="!graph" class="page muted">Loading…</div>
  <div v-else class="page">
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
        <p class="lede">
          <template v-if="recipeTags.length">
            {{ recipeTags[0] }} · A gentle, low-sensory recipe view with calm steps.
          </template>
          <template v-else>A gentle, low-sensory recipe view. Calm steps and predictable structure.</template>
        </p>
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
        </div>
        <div v-if="recipeTags.length > 1" class="hero-tags">
          <span v-for="tag in recipeTags.slice(1, 5)" :key="tag" class="chip">{{ tag }}</span>
        </div>

        <div class="profile-match" :class="{ warn: hasConflictWarnings }">
          {{ profileMatchText }}
        </div>

        <div class="cta-row">
          <button type="button" class="bb-btn bb-btn--primary bb-btn--guided" @click="router.push({ name: 'guided', params: { id: recipeId } })">
            <svg class="cta-play" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <path fill="currentColor" d="M8 5v14l11-7L8 5z" />
            </svg>
            Begin Guided Cooking
          </button>
        </div>
      </section>

      <div v-if="hasHeroImage" class="hero-media">
        <div class="hero-image">
          <img :src="displayHeroImageUrl!" :alt="graph.title" class="hero-image-img" />
        </div>
      </div>
    </div>

    <section class="roadmap-layout">
      <article class="panel timeline-panel timeline-panel--full">
        <header id="cooking-roadmap" class="roadmap-head" tabindex="-1">
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
            <button type="button" class="mini" :class="{ active: !activeLane }" @click="activeLane = null">All lanes</button>
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
        </div>

        <div
          v-show="ingredients.length && roadmapView === 'full'"
          id="recipe-prep-ingredients"
          class="full-prep-block"
        >
          <div class="full-prep-head">
            <h3 class="full-prep-title">{{ PREP_INGREDIENTS_LANE }}</h3>
            <span v-if="graph.servings != null" class="ingredients-servings">{{ graph.servings }} servings</span>
            <span v-else class="ingredients-servings ingredients-servings--muted">Servings not specified</span>
          </div>
          <ul class="ing-list">
            <li v-for="ing in ingredients" :key="ing.id" class="ing-item">
              <span class="ing-main">
                <img
                  v-if="ing.imageUrl || ing.icon"
                  :src="ing.imageUrl || `/api/icons/wicked/${ing.icon}`"
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
                  >{{ ingredientSensoryDisplay(ing.label) }}</span
                >
                <span
                  v-for="d in ingredientDietaryForLabel(ing.label)"
                  :key="d.nodeId + ':' + d.constraint + ':' + d.kind"
                  class="diet-pill"
                  >{{ d.kind === 'cultural' ? 'Cultural' : 'Diet' }}: {{ d.constraint }}</span
                >
              </span>
            </li>
          </ul>
        </div>

        <ol v-show="roadmapView === 'full'" class="timeline-list">
          <li v-for="(step, idx) in timelineNodes" :key="step.id" class="timeline-item">
            <div class="timeline-icon">{{ step.emoji ?? '•' }}</div>
            <div class="timeline-body">
              <h3>Step {{ idx + 1 }} — {{ step.label }}</h3>
              <p>{{ step.detail }}</p>
              <div class="timeline-meta">
                <span>{{ step.timeMinutes ?? 1 }} min</span>
                <span>{{ timelineHeat(step) }}</span>
                <span>{{ timelineEffort(step) }}</span>
              </div>
              <div class="timeline-actions">
                <label class="check">
                  <input type="checkbox" :checked="completed.includes(step.id)" @change="toggleStepDone(step.id)" />
                  Mark done
                </label>
                <button
                  type="button"
                  class="mini"
                  @click="onSelectStep({ id: step.id, label: step.label, detail: step.detail, ingredientLabels: ingredientLabelsForStep(step) })"
                >
                  View details
                </button>
              </div>
            </div>
          </li>
        </ol>
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
        <label class="check">
          <input type="checkbox" :checked="completed.includes(selected.id)" @change="toggleStepDone(selected.id)" />
          Mark step complete
        </label>
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

    <div v-if="!profileLoading && hasProfile && profile" class="profile-strip" role="status">
      <span class="chip-label">Your sensory profile</span>
      <span v-if="profile.unsafeFoods.length" class="strip-note">
        <strong>Avoid</strong>: {{ profile.unsafeFoods.slice(0, 5).join(', ') }}<template v-if="profile.unsafeFoods.length > 5">…</template>
      </span>
      <RouterLink to="/sensory/setup" class="edit">Edit</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.page {
  padding: 1rem 1.25rem 2.25rem;
  max-width: 72rem;
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
  grid-template-columns: 0.88fr 1.12fr;
  gap: 1.1rem;
  margin-bottom: 1rem;
  align-items: start;
}
.detail-layout--no-image {
  grid-template-columns: 1fr;
}
.hero-media,
.hero-copy {
  background: var(--bb-surface-low);
  border-radius: 18px;
  box-shadow: 0 14px 40px rgba(26, 28, 25, 0.05);
}
.hero-media {
  padding: 0.65rem;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  align-self: start;
}
.hero-image {
  border-radius: 14px;
  min-height: 188px;
  background: var(--bb-surface-lowest);
  color: var(--bb-muted);
  font-family: var(--bb-font-label);
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  display: grid;
  place-items: center;
  overflow: hidden;
}
.hero-image-img {
  width: 100%;
  height: 100%;
  min-height: 188px;
  max-height: 220px;
  object-fit: cover;
  border-radius: 14px;
}
.hero-copy {
  padding: 1.1rem 1.1rem 1rem;
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
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem 1rem;
  max-width: 22rem;
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
  font-size: 1.15rem;
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
.bb-btn--guided {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}
.cta-play {
  flex-shrink: 0;
  opacity: 0.95;
}
.roadmap-visual {
  margin-bottom: 0.5rem;
}
.roadmap-visual .lane-list {
  margin-bottom: 0.5rem;
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
  font-size: clamp(1.8rem, 4vw, 2.35rem);
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
.cta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: center;
  margin-top: 0.85rem;
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
.full-prep-title {
  margin: 0;
  font-family: var(--bb-font-headline);
  font-size: 1.05rem;
  font-weight: 800;
}
.panel {
  background: var(--bb-surface-low);
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
  cursor: pointer;
  font: inherit;
}
.mini.active {
  background: color-mix(in srgb, var(--bb-accent) 12%, transparent);
  border-color: var(--bb-accent);
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
  border: 1px solid #fecaca;
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
  border: 1px solid #fed7aa;
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
  }
}
</style>

