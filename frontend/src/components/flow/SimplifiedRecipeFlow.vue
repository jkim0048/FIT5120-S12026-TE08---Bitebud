<script setup lang="ts">
import { computed } from 'vue'
import { apiUrl } from '../../lib/api'
import { getOrderedRecipeSteps } from '../../lib/recipeSteps'
import type { RecipeGraph, RecipeNode } from '../../types/recipe'

const props = defineProps<{
  graph: RecipeGraph
  completedNodeIds: string[]
  activeLane?: string | null
  /** Tighter layout when embedded in recipe hero */
  embedded?: boolean
  /**
   * Horizontal scroll strip (hero). When multiple lanes exist, shows steps for
   * `activeLane` only, or all steps when `activeLane` is null (parent "All lanes").
   */
  stripLayout?: boolean
  /** Hide ingredient chips in strip mode when the parent already lists ingredients (e.g. recipe page column). */
  hideStripIngredients?: boolean
  /** Virtual lane title for the ingredient grid in strip layout (must match parent filter chip). */
  prepLaneLabel?: string
}>()

const completed = computed(() => new Set(props.completedNodeIds))

const ingredients = computed(() => props.graph.nodes.filter((n) => n.type === 'ingredient'))
const steps = computed(() => getOrderedRecipeSteps(props.graph))

const prepLaneName = computed(() => {
  const t = props.prepLaneLabel?.trim()
  return t && t.length > 0 ? t : 'Prep Ingredients'
})

const prepLaneActive = computed(() => props.activeLane?.trim() === prepLaneName.value)

/** All ingredients for the Prep lane (strip); cap for layout. */
const prepDisplayIngredients = computed(() => ingredients.value.slice(0, 40))

const showPrepStripBlock = computed(
  () =>
    Boolean(
      props.stripLayout &&
        ingredients.value.length > 0 &&
        !props.hideStripIngredients &&
        (!props.activeLane?.trim() || prepLaneActive.value),
    ),
)

/** Steps shown in strip: filtered by activeLane when set (v1 multi-lane rule). */
const stripSteps = computed(() => {
  if (prepLaneActive.value) return []
  const a = props.activeLane?.trim()
  if (!a) return steps.value
  return steps.value.filter((s) => (s.lane ?? 'Steps') === a)
})

const isDefaultLaneMode = computed(
  () => lanes.value.length === 1 && lanes.value[0] === 'Steps' && steps.value.every((s) => !s.lane),
)

const lanes = computed(() => {
  const all = [
    ...new Set(
      steps.value
        .map((n) => n.lane)
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0),
    ),
  ]
  return all.length ? all : ['Steps']
})

const visibleLanes = computed(() => {
  const a = props.activeLane?.trim()
  if (!a) return lanes.value
  return lanes.value.includes(a) ? [a] : lanes.value
})

function splitSectionPrefix(text: string): { section: string | null; body: string } {
  const t = text.trim()
  const m = t.match(/^((?:for\s+the\s+)[^:]+):\s*(.*)$/i)
  if (!m) return { section: null, body: t }
  const body = (m[2] ?? '').trim()
  return body ? { section: (m[1] ?? '').trim(), body } : { section: null, body: t }
}

function stripLeadingQtyForName(full: string): string {
  let s = full.trim()
  for (let pass = 0; pass < 4; pass++) {
    const prev = s
    s = s
      .replace(/^\s*\d+\s+\d+\/\d+\s+/, '')
      .replace(/^\s*\d+\/\d+\s+/, '')
      .replace(/^\s*\d+(?:\.\d+)?\s*(?:ml|cl|l|litres?|liters?|g|grams?|kg)\b\s*/i, '')
      .replace(/^\s*[\d.]+\s*\-\s*[\d.]+\s*/, '')
      .replace(/^\s*[\d.]+\s*/, '')
      .replace(
        /^\s*(cup|cups|tbsp|tablespoon|tablespoons|tsp|teaspoon|teaspoons|g|kg|mg|ml|l|oz|lb|pound|pounds|clove|cloves|pinch|dash)\b\s*/i,
        '',
      )
      .replace(/^(carton|tub|jar|packet|pack|can|bottle)\s+(?:of\s+)?/i, '')
      .trim()
    if (s === prev) break
  }
  return s.replace(/^(to serve|for serving|for garnish|to garnish|for dipping|for brushing)\b/i, '').trim()
}

function ingredientDisplayLabel(ing: RecipeNode): string {
  const rawLabel = typeof ing.label === 'string' ? ing.label.trim() : ''
  const cleanLabel = rawLabel.replace(/^((?:for\s+the\s+)[^:]+):\s*/i, '').trim()
  if (cleanLabel && !/\d/.test(cleanLabel) && cleanLabel.length <= 44) return cleanLabel

  const detailRaw = typeof ing.detail === 'string' ? ing.detail.trim() : ''
  const { body } = splitSectionPrefix(detailRaw)
  const fromDetail = stripLeadingQtyForName(body)
  if (fromDetail && fromDetail.length <= 80) return fromDetail

  if (cleanLabel) return cleanLabel
  return rawLabel || 'Ingredient'
}

function ingredientMeasurement(ing: RecipeNode): string | null {
  const raw = typeof ing.detail === 'string' ? ing.detail.trim() : ''
  if (!raw) return null
  const { body } = splitSectionPrefix(raw)
  const m = body.trim()
  if (!m) return null
  if (m.toLowerCase() === ingredientDisplayLabel(ing).trim().toLowerCase()) return null
  return m
}

function ingredientLabelsForStep(step: RecipeNode): string[] {
  const ids = step.ingredientIds ?? []
  if (!ids.length) return []
  const byId = new Map(ingredients.value.map((n) => [n.id, n.label]))
  return ids.map((id) => byId.get(id)).filter((v): v is string => Boolean(v))
}

function ingredientsForLane(lane: string): RecipeNode[] {
  const stepIds = steps.value
    .filter((s) => {
      if (!props.activeLane) return (s.lane ?? 'Steps') === lane
      return (s.lane ?? 'Steps') === lane
    })
    .flatMap((s) => s.ingredientIds ?? [])

  const want = new Set(stepIds)
  const inLane = ingredients.value.filter((i) => want.has(i.id))
  return inLane.length ? inLane : ingredients.value.slice(0, 3)
}

function timeLabel(n: RecipeNode): string | null {
  const t = n.timeMinutes
  if (t == null) return null
  if (t <= 0) return null
  return `${t}m`
}

/** Multi-lane + “All lanes”: group step cards under each lane name in strip layout. */
const stripGroupByLane = computed(
  () =>
    Boolean(
      props.stripLayout &&
        !isDefaultLaneMode.value &&
        lanes.value.length > 1 &&
        !props.activeLane?.trim(),
    ),
)

const lanesWithStepsInFlow = computed(() =>
  lanes.value.filter((lane) => steps.value.some((s) => (s.lane ?? 'Steps') === lane)),
)

const stripHasSteps = computed(() => stripSteps.value.length > 0)

const stripStepsHeading = computed(() => {
  const active = props.activeLane?.trim()
  if (active) return active
  if (lanes.value.length === 1 && !isDefaultLaneMode.value) return lanes.value[0] ?? 'Cooking steps'
  if (stripGroupByLane.value) return 'Cooking steps'
  return 'Cooking steps'
})

function orderedStepsInLane(lane: string): RecipeNode[] {
  return steps.value.filter((s) => (s.lane ?? 'Steps') === lane)
}

function shouldNumberLaneSteps(laneSteps: RecipeNode[]): boolean {
  return laneSteps.length > 1
}
</script>

<template>
  <section class="wrap" :class="{ embedded: embedded, stripLayout: stripLayout }">
    <!-- Horizontal strip (embedded hero) -->
    <template v-if="stripLayout">
      <template v-if="showPrepStripBlock">
        <!-- Full view (activeLane = null): make Prep Ingredients collapsible -->
        <details v-if="stripGroupByLane" class="strip-prep-section strip-prep-details" aria-labelledby="flow-strip-prep-heading">
          <summary id="flow-strip-prep-heading" class="flow-section-heading flow-lane-heading--prep flow-lane-heading--summary">
            <span>{{ prepLaneName }}</span>
            <span class="lane-details__chevron" aria-hidden="true">⌄</span>
          </summary>
          <div class="strip-ing-grid">
            <div
              v-for="ing in prepDisplayIngredients"
              :key="ing.id"
              class="bubble bubble--strip"
              :title="ingredientDisplayLabel(ing)"
            >
              <img
                v-if="ing.imageUrl || ing.icon"
                :src="ing.imageUrl || apiUrl(`/api/icons/wicked/${ing.icon}`)"
                :alt="ingredientDisplayLabel(ing)"
                class="bubble__icon"
              />
              <span v-else class="bubble__emo" aria-hidden="true">{{ ing.emoji ?? '•' }}</span>
              <div class="bubble__main">
                <div class="bubble__txt">{{ ingredientDisplayLabel(ing) }}</div>
                <details v-if="ingredientMeasurement(ing)" class="ing-measure">
                  <summary class="ing-measure__summary">View measurement</summary>
                  <div class="ing-measure__body">{{ ingredientMeasurement(ing) }}</div>
                </details>
              </div>
            </div>
          </div>
        </details>

        <!-- Other states (e.g. Prep lane selected): keep always visible -->
        <section v-else class="strip-prep-section" aria-labelledby="flow-strip-prep-heading">
          <h3 id="flow-strip-prep-heading" class="flow-section-heading flow-lane-heading--prep">
            {{ prepLaneName }}
          </h3>
          <div class="strip-ing-grid">
            <div
              v-for="ing in prepDisplayIngredients"
              :key="ing.id"
              class="bubble bubble--strip"
              :title="ingredientDisplayLabel(ing)"
            >
              <img
                v-if="ing.imageUrl || ing.icon"
                :src="ing.imageUrl || apiUrl(`/api/icons/wicked/${ing.icon}`)"
                :alt="ingredientDisplayLabel(ing)"
                class="bubble__icon"
              />
              <span v-else class="bubble__emo" aria-hidden="true">{{ ing.emoji ?? '•' }}</span>
              <div class="bubble__main">
                <div class="bubble__txt">{{ ingredientDisplayLabel(ing) }}</div>
                <details v-if="ingredientMeasurement(ing)" class="ing-measure">
                  <summary class="ing-measure__summary">View measurement</summary>
                  <div class="ing-measure__body">{{ ingredientMeasurement(ing) }}</div>
                </details>
              </div>
            </div>
          </div>
        </section>
      </template>

      <section
        v-if="stripHasSteps && !prepLaneActive"
        class="strip-steps-section"
        aria-labelledby="flow-strip-steps-heading"
      >
        <h3 id="flow-strip-steps-heading" class="flow-section-heading">{{ stripStepsHeading }}</h3>

        <template v-if="stripGroupByLane">
          <template v-for="lane in lanesWithStepsInFlow" :key="lane">
            <details class="lane-details">
              <summary class="flow-lane-heading flow-lane-heading--summary">
                <span>{{ lane }}</span>
                <span class="lane-details__chevron" aria-hidden="true">⌄</span>
              </summary>
              <div class="strip-track strip-track--lane" role="list">
                <article
                  v-for="(s, idx) in orderedStepsInLane(lane)"
                  :key="s.id"
                  class="step step--strip"
                  role="listitem"
                  :class="{ done: completed.has(s.id) }"
                >
                  <div class="step-top">
                    <div class="step-top-left">
                      <span
                        v-if="shouldNumberLaneSteps(orderedStepsInLane(lane))"
                        class="step-num"
                        aria-label="Step number"
                      >
                        {{ idx + 1 }}
                      </span>
                      <span class="step-emo" aria-hidden="true">{{ s.emoji ?? '•' }}</span>
                    </div>
                    <div class="step-top-right">
                      <span v-if="timeLabel(s)" class="step-time">{{ timeLabel(s) }}</span>
                    </div>
                  </div>
                  <div class="step-title step-title--full">{{ s.label }}</div>
                  <details class="step-details">
                    <summary class="step-view-details">View details</summary>
                    <div class="step-details__body">
                      <p class="step-details__text">{{ s.detail || s.label }}</p>
                      <div v-if="ingredientLabelsForStep(s).length">
                        <div class="step-details__label">Ingredients for this step</div>
                        <ul class="step-details__list">
                          <li v-for="label in ingredientLabelsForStep(s)" :key="label">{{ label }}</li>
                        </ul>
                      </div>
                    </div>
                  </details>
                </article>
              </div>
            </details>
          </template>
        </template>

        <template v-else>
          <div class="strip-track" role="list">
            <article
              v-for="(s, idx) in stripSteps"
              :key="s.id"
              class="step step--strip"
              role="listitem"
              :class="{ done: completed.has(s.id) }"
            >
              <div class="step-top">
                <div class="step-top-left">
                  <span
                    v-if="stripSteps.length > 1"
                    class="step-num"
                    aria-label="Step number"
                  >
                    {{ idx + 1 }}
                  </span>
                  <span class="step-emo" aria-hidden="true">{{ s.emoji ?? '•' }}</span>
                </div>
                <div class="step-top-right">
                  <span v-if="timeLabel(s)" class="step-time">{{ timeLabel(s) }}</span>
                </div>
              </div>
              <div class="step-title step-title--full">{{ s.label }}</div>
              <details class="step-details">
                <summary class="step-view-details">View details</summary>
                <div class="step-details__body">
                  <p class="step-details__text">{{ s.detail || s.label }}</p>
                  <div v-if="ingredientLabelsForStep(s).length">
                    <div class="step-details__label">Ingredients for this step</div>
                    <ul class="step-details__list">
                      <li v-for="label in ingredientLabelsForStep(s)" :key="label">{{ label }}</li>
                    </ul>
                  </div>
                </div>
              </details>
            </article>
          </div>
        </template>
      </section>
    </template>

    <!-- Default vertical lanes -->
    <template v-else>
      <div class="lanes-head" :style="{ gridTemplateColumns: `repeat(${visibleLanes.length}, minmax(0, 1fr))` }">
        <div v-for="lane in visibleLanes" :key="lane" class="lane-pill">
          <span class="lane-pill__label">{{ lane }}</span>
        </div>
      </div>

      <div class="lanes-grid" :style="{ gridTemplateColumns: `repeat(${visibleLanes.length}, minmax(0, 1fr))` }">
        <div v-for="lane in visibleLanes" :key="lane" class="lane-col">
          <div class="col-section-heading">Ingredients</div>
          <div class="bubbles">
            <div v-for="ing in ingredientsForLane(lane)" :key="ing.id" class="bubble" :title="ingredientDisplayLabel(ing)">
              <img
                v-if="ing.imageUrl || ing.icon"
                :src="ing.imageUrl || apiUrl(`/api/icons/wicked/${ing.icon}`)"
                :alt="ingredientDisplayLabel(ing)"
                class="bubble__icon"
              />
              <span v-else class="bubble__emo" aria-hidden="true">{{ ing.emoji ?? '•' }}</span>
              <span class="bubble__txt">{{ ingredientDisplayLabel(ing) }}</span>
            </div>
          </div>

          <div class="stack">
            <div class="stack-head">Cooking steps</div>
            <article
              v-for="s in steps.filter((x) => (x.lane ?? 'Steps') === lane)"
              :key="s.id"
              class="step"
              :class="{ done: completed.has(s.id) }"
            >
              <div class="step-top">
                <span class="step-emo" aria-hidden="true">{{ s.emoji ?? '•' }}</span>
                <div class="step-top-right">
                  <span v-if="timeLabel(s)" class="step-time">{{ timeLabel(s) }}</span>
                </div>
              </div>
              <div class="step-title">{{ s.label }}</div>
              <details class="step-details">
                <summary class="step-view-details">View details</summary>
                <div class="step-details__body">
                  <p class="step-details__text">{{ s.detail || s.label }}</p>
                  <div v-if="ingredientLabelsForStep(s).length">
                    <div class="step-details__label">Ingredients for this step</div>
                    <ul class="step-details__list">
                      <li v-for="label in ingredientLabelsForStep(s)" :key="label">{{ label }}</li>
                    </ul>
                  </div>
                </div>
              </details>
            </article>
          </div>
        </div>

      </div>
    </template>
  </section>
</template>

<style scoped>
.wrap {
  background: var(--bb-surface-container);
  border-radius: 18px;
  padding: 1.25rem 1.25rem 1.5rem;
  position: relative;
  overflow: hidden;
}
.wrap.embedded {
  padding: 0.85rem 0.9rem 1rem;
  border-radius: 14px;
}
.wrap.embedded:not(.stripLayout) .lanes-grid {
  min-height: min(280px, 50vh);
  gap: 0.9rem;
}
.wrap.embedded:not(.stripLayout) .lane-col::before {
  top: 84px;
}
.wrap.embedded:not(.stripLayout) .lane-col {
  gap: 0.85rem;
}

.wrap.stripLayout {
  overflow: visible;
  padding-bottom: 0.75rem;
}

.flow-section-heading {
  margin: 0 0 0.45rem;
  font-family: var(--bb-font-headline);
  font-size: 0.95rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--bb-text);
}
.flow-lane-heading {
  margin: 0.55rem 0 0.35rem;
  font-family: var(--bb-font-headline);
  font-size: 0.82rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--bb-muted);
}
.flow-lane-heading--summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  cursor: pointer;
  list-style: none;
}
.flow-lane-heading--summary::-webkit-details-marker {
  display: none;
}
.lane-details {
  margin-top: 0.35rem;
}
.lane-details__chevron {
  transition: transform 0.2s ease;
  font-size: 1.1rem;
}
.lane-details[open] .lane-details__chevron {
  transform: rotate(180deg);
}
.flow-lane-heading:first-of-type {
  margin-top: 0.15rem;
}
.strip-prep-section .flow-lane-heading--prep {
  margin-top: 0;
}
.strip-prep-section {
  margin-bottom: 0.5rem;
}
.strip-steps-section {
  margin-top: 0.35rem;
}
.strip-ing-wrap {
  margin-bottom: 0.65rem;
}
.strip-ing-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 0.45rem;
  padding: 0.25rem 0 0.35rem;
  align-items: stretch;
}

.bubble--strip {
  width: 100%;
  min-height: 84px;
  padding: 0.55rem 0.6rem;
  border-radius: 12px;
  border: 1px solid var(--bb-border);
  box-shadow: 0 6px 18px rgba(26, 28, 25, 0.04);
  background: var(--bb-surface-lowest);
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: 0.6rem;
  text-align: left;
}
.bubble--strip .bubble__icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
}
.bubble--strip .bubble__emo {
  font-size: 1.25rem;
}
.bubble--strip .bubble__txt {
  font-size: 0.72rem;
  max-width: none;
  text-align: left;
}
.bubble--strip .bubble__main {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.ing-measure {
  margin-top: 0.1rem;
}
.ing-measure__summary {
  cursor: pointer;
  list-style: none;
  font-size: 0.7rem;
  font-weight: 800;
  color: var(--bb-muted);
}
.ing-measure__summary::-webkit-details-marker {
  display: none;
}
.ing-measure[open] .ing-measure__summary,
.ing-measure__summary:hover {
  color: var(--bb-text);
}
.ing-measure__body {
  margin-top: 0.18rem;
  font-size: 0.72rem;
  color: var(--bb-text);
  opacity: 0.9;
}

.strip-track {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.25rem 0 0.35rem;
}
.strip-track--lane {
  padding-bottom: 0.5rem;
}
.final-inner--strip-block {
  margin-top: 0.35rem;
  width: 100%;
  grid-column: unset;
}

.step--strip {
  min-width: 0;
  width: 100%;
  text-align: left;
  border: 1px solid var(--bb-border);
  background: var(--bb-surface-lowest);
  border-radius: 12px;
  padding: 0.5rem 0.55rem;
  box-shadow: 0 6px 18px rgba(26, 28, 25, 0.04);
  font: inherit;
}
.step--strip.done {
  /* Keep done steps readable in light mode */
  opacity: 0.82;
}

.step-title--clamp {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 5;
  overflow: hidden;
  line-clamp: 5;
  font-size: 0.82rem;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.step-title--full {
  font-size: 0.9rem;
  line-height: 1.35;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.final-inner--strip {
  grid-column: 1 / -1;
  box-sizing: border-box;
  border-radius: 12px;
  background: var(--bb-secondary-container);
  color: var(--bb-on-secondary-container);
  padding: 0.65rem 0.75rem;
  box-shadow: 0 6px 18px rgba(26, 28, 25, 0.06);
  text-align: left;
}
.final-inner--strip .final-title {
  font-size: 0.95rem;
}
.final-inner--strip .final-sub {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 5;
  overflow: hidden;
  line-clamp: 5;
  font-size: 0.78rem;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.lanes-head {
  display: grid;
  gap: 1rem;
  margin-bottom: 1.25rem;
  position: relative;
  z-index: 2;
}

.lane-pill {
  display: flex;
  justify-content: center;
}
.lane-pill__label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.6rem 1.15rem;
  border-radius: 999px;
  background: var(--bb-primary);
  color: #fff;
  font-family: var(--bb-font-headline);
  font-weight: 800;
  letter-spacing: -0.01em;
}

.lanes-grid {
  display: grid;
  gap: 1.35rem;
  min-height: 540px;
  position: relative;
  z-index: 2;
}

.col-section-heading {
  width: 100%;
  max-width: 230px;
  margin: 0;
  padding: 0 0.1rem;
  font-family: var(--bb-font-headline);
  font-size: 0.82rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--bb-muted);
  text-align: center;
}
.lane-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.85rem;
  position: relative;
  padding: 0 0.25rem 0.25rem;
}

.lane-col::before {
  content: '';
  position: absolute;
  top: 96px;
  bottom: 12px;
  left: 50%;
  width: 2px;
  transform: translateX(-50%);
  background-image: linear-gradient(to bottom, color-mix(in srgb, var(--bb-muted) 35%, transparent) 33%, transparent 0%);
  background-position: center;
  background-size: 2px 10px;
  background-repeat: repeat-y;
  opacity: 0.32;
  pointer-events: none;
}

.bubbles {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.75rem;
  padding: 0.25rem 0.25rem 0.35rem;
  border-radius: 16px;
  background: color-mix(in srgb, var(--bb-surface-lowest) 65%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--bb-primary) 10%, transparent);
}
.bubble {
  width: 98px;
  min-height: 98px;
  height: auto;
  align-self: flex-start;
  border-radius: 14px;
  background: var(--bb-surface-lowest);
  border: 2px solid color-mix(in srgb, var(--bb-on-secondary-container) 18%, transparent);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 0.28rem;
  padding: 0.5rem 0.42rem 0.55rem;
  text-align: center;
  box-sizing: border-box;
}
.bubble__icon {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: 10px;
  flex-shrink: 0;
}
.bubble__emo {
  font-size: 1.85rem;
  line-height: 1;
  flex-shrink: 0;
}
.bubble__txt {
  font-family: var(--bb-font-label);
  font-size: 0.6rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--bb-muted);
  width: 100%;
  max-width: 86px;
  line-height: 1.25;
  word-break: break-word;
  overflow-wrap: anywhere;
  hyphens: auto;
}

.stack {
  width: 100%;
  max-width: 230px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.85rem;
}
.stack-head {
  width: 100%;
  text-align: left;
  font-family: var(--bb-font-headline);
  font-weight: 800;
  color: var(--bb-muted);
  letter-spacing: -0.01em;
  font-size: 0.95rem;
  padding: 0 0.1rem;
  margin-top: 0.15rem;
  margin-bottom: -0.25rem;
}

.step {
  width: 100%;
  text-align: left;
  border: 1px solid var(--bb-border);
  background: var(--bb-surface-lowest);
  border-radius: 14px;
  padding: 0.8rem 0.85rem;
  box-shadow: 0 12px 32px rgba(26, 28, 25, 0.04);
  font: inherit;
}
.step.done {
  opacity: 0.68;
}
.step-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.35rem;
}
.step-top-left {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
}
.step-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  font-family: var(--bb-font-label);
  font-size: 0.72rem;
  font-weight: 900;
  color: var(--bb-text);
  background: color-mix(in srgb, var(--bb-primary) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--bb-primary) 22%, transparent);
  flex-shrink: 0;
}
.step-top-right {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.step-view-details {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: -0.01em;
  color: var(--bb-muted);
  background: color-mix(in srgb, var(--bb-muted) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--bb-muted) 18%, transparent);
  opacity: 0.92;
  white-space: nowrap;
  cursor: pointer;
  list-style: none;
}
.step-view-details::-webkit-details-marker {
  display: none;
}
.step-details[open] .step-view-details,
.step-view-details:hover {
  color: var(--bb-accent);
  background: color-mix(in srgb, var(--bb-accent) 16%, transparent);
  border-color: color-mix(in srgb, var(--bb-accent) 26%, transparent);
}
.step-details {
  margin-top: 0.55rem;
}
.step-details__body {
  margin-top: 0.45rem;
  border-top: 1px solid color-mix(in srgb, var(--bb-border) 80%, transparent);
  padding-top: 0.5rem;
}
.step-details__text {
  margin: 0;
  color: var(--bb-muted);
  font-size: 0.82rem;
  line-height: 1.45;
  white-space: pre-wrap;
}
.step-details__label {
  margin-top: 0.55rem;
  font-size: 0.72rem;
  font-weight: 800;
  color: var(--bb-text);
}
.step-details__list {
  margin: 0.3rem 0 0;
  padding-left: 1rem;
  color: var(--bb-muted);
  font-size: 0.8rem;
  line-height: 1.45;
}
.step-emo {
  font-size: 1.15rem;
  line-height: 1;
}
.step-time {
  font-family: var(--bb-font-label);
  font-size: 0.72rem;
  font-weight: 800;
  color: var(--bb-muted);
  background: var(--bb-surface-highest);
  padding: 0.15rem 0.45rem;
  border-radius: 10px;
}
.step-title {
  font-weight: 700;
  line-height: 1.25;
  color: var(--bb-text);
}

.final {
  grid-column: 1 / -1;
  display: flex;
  justify-content: center;
  margin-top: 1.1rem;
}
.final-inner {
  max-width: 360px;
  width: 100%;
  border-radius: 18px;
  background: var(--bb-secondary-container);
  color: var(--bb-on-secondary-container);
  padding: 1.15rem 1.25rem;
  box-shadow: 0 12px 32px rgba(26, 28, 25, 0.06);
  text-align: center;
}
.final-title {
  font-family: var(--bb-font-headline);
  font-weight: 800;
  letter-spacing: -0.01em;
}
.final-sub {
  margin-top: 0.25rem;
  opacity: 0.85;
}

.wrap::after {
  content: '';
  position: absolute;
  top: -120px;
  right: -120px;
  width: 320px;
  height: 320px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bb-primary) 8%, transparent);
  filter: blur(44px);
  pointer-events: none;
}
.wrap::before {
  content: '';
  position: absolute;
  bottom: -120px;
  left: -120px;
  width: 340px;
  height: 340px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bb-on-secondary-container) 10%, transparent);
  filter: blur(44px);
  pointer-events: none;
}

@media (max-width: 980px) {
  .lanes-grid {
    grid-template-columns: 1fr !important;
  }
  .lane-col::before {
    display: none;
  }
}
</style>
