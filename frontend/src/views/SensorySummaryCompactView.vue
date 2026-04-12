<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { apiFetch } from '../lib/api'
import { fetchIngredientIconMap, type IngredientMapItem } from '../lib/ingredientMap'
import { fetchWickedPickerItems, type WickedPickerItem } from '../lib/wickedIconPicker'
import {
  CULTURAL_CHIPS,
  DIETARY_CHIPS,
  TEMPERATURE_PRESENTATION,
  TEXTURE_OPTION_PRESENTATION,
  TEXTURE_OPTIONS,
  type SensoryChip,
} from '../composables/useSensorySetupForm'
import { useSensoryProfile } from '../composables/useSensoryProfile'
import { getBiteBudUserId } from '../composables/useUserId'
import type { SensoryFoodItemDTO, SensoryFoodStatus } from '../types/sensory'

const router = useRouter()
const route = useRoute()
const { hasProfile, profile, loading: profileLoading, refresh } = useSensoryProfile()

const restrictionLookup = new Map<string, SensoryChip>(
  [...DIETARY_CHIPS, ...CULTURAL_CHIPS].map((c) => [c.label, c]),
)

watch(
  () => route.name,
  (name) => {
    if (name === 'sensorySummary') void refresh()
  },
  { immediate: true },
)

const submitting = ref(false)
const submitError = ref('')

async function submitAndGoHome() {
  const uid = getBiteBudUserId()
  if (!uid || !hasProfile.value || !profile.value) return
  submitError.value = ''
  submitting.value = true
  try {
    await apiFetch('/api/sensory/profile', {
      method: 'POST',
      headers: { 'X-User-Id': uid },
      body: JSON.stringify({
        texturePrefs: profile.value.texturePrefs,
        temperaturePref: profile.value.temperaturePref ?? null,
        dietaryNeeds: profile.value.dietaryNeeds,
        culturalRequirements: profile.value.culturalRequirements,
      }),
    })
    await refresh()
    router.push({ name: 'home' })
  } catch (e) {
    submitError.value = e instanceof Error ? e.message : 'Could not save. Please try again.'
  } finally {
    submitting.value = false
  }
}

const TEXTURE_UNSAFE_PREFIX = 'unsafe:'

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr))
}

function decodeTexturePrefs(prefs: string[] | null | undefined): {
  unsafe: string[]
} {
  const unsafe: string[] = []
  for (const raw of prefs ?? []) {
    if (typeof raw !== 'string') continue
    if (raw.startsWith(TEXTURE_UNSAFE_PREFIX)) unsafe.push(raw.slice(TEXTURE_UNSAFE_PREFIX.length))
  }
  return { unsafe: uniq(unsafe) }
}

const decoded = computed(() => decodeTexturePrefs(profile.value?.texturePrefs ?? []))

const temperatureChips = computed(() => {
  const v = profile.value?.temperaturePref ?? ''
  return v.split(',').map((x) => x.trim()).filter(Boolean)
})

const selectedTempRows = computed(() =>
  TEMPERATURE_PRESENTATION.filter((row) => temperatureChips.value.includes(row.value)),
)

const selectedTexturesOrdered = computed(() =>
  TEXTURE_OPTIONS.filter((t) => decoded.value.unsafe.includes(t)),
)

const selectedRestrictionChips = computed((): SensoryChip[] => {
  const dietary = profile.value?.dietaryNeeds ?? []
  const cultural = profile.value?.culturalRequirements ?? []
  const labels = uniq([...dietary, ...cultural])
  return labels.map((l) => {
    const known = restrictionLookup.get(l)
    if (known) return known
    return {
      label: l,
      kind: cultural.includes(l) ? 'cultural' : 'dietary',
      emoji: '📋',
      hint: 'Restriction on your profile',
    }
  })
})

const foodItemsAll = computed(() => profile.value?.foodItems ?? [])

const wickedById = ref<Map<string, WickedPickerItem>>(new Map())
const ingredientByKey = ref<Map<string, IngredientMapItem>>(new Map())
const wickedList = ref<WickedPickerItem[]>([])

onMounted(async () => {
  try {
    const [wicked, ing] = await Promise.all([
      fetchWickedPickerItems(),
      fetchIngredientIconMap().catch(() => [] as IngredientMapItem[]),
    ])
    wickedList.value = wicked
    wickedById.value = new Map(wicked.map((i) => [i.wickedIconId, i]))
    ingredientByKey.value = new Map(ing.map((i) => [i.ingredientKey, i]))
  } catch {
    wickedList.value = []
    wickedById.value = new Map()
    ingredientByKey.value = new Map()
  }
})

type SumFoodDisp = {
  label: string
  hint: string
  emoji: string
  wickedIconId?: string
}

function foodRowDisplay(f: SensoryFoodItemDTO): SumFoodDisp {
  const wid = f.notes?.wickedIconId?.trim()
  if (wid) {
    const w = wickedById.value.get(wid)
    return { label: f.name, hint: w?.hint ?? 'Wicked food icon', emoji: '🍽️', wickedIconId: wid }
  }
  const k = f.notes?.ingredientKey
  if (k && ingredientByKey.value.has(k)) {
    const m = ingredientByKey.value.get(k)!
    return { label: f.name, hint: m.hint, emoji: m.emoji }
  }
  const nameMatch = wickedList.value.find((i) => i.label.toLowerCase() === f.name.trim().toLowerCase())
  if (nameMatch) {
    return {
      label: f.name,
      hint: nameMatch.hint,
      emoji: '🍽️',
      wickedIconId: nameMatch.wickedIconId,
    }
  }
  return { label: f.name, hint: 'Saved on your profile', emoji: '🍽️' }
}

/** Same-origin proxy: serves DB `asset` or fetches stored `image_url` from Wicked hosts (see backend). */
function foodThumbSrc(disp: SumFoodDisp): string | null {
  if (disp.wickedIconId) return `/api/icons/wicked/${encodeURIComponent(disp.wickedIconId)}`
  return null
}

const foodThumbBroken = ref<Set<string>>(new Set())

function onFoodThumbError(key: string) {
  foodThumbBroken.value = new Set(foodThumbBroken.value).add(key)
}

const summaryFoodRows = computed(() =>
  foodItemsAll.value.map((f) => ({ food: f, disp: foodRowDisplay(f) })),
)

function foodPillClass(status: SensoryFoodStatus): string {
  if (status === 'SAFE') return 'food-pill pill--safe'
  if (status === 'UNSAFE') return 'food-pill pill--unsafe'
  return 'food-pill pill--sometimes'
}

function foodStatusLabel(status: SensoryFoodStatus): string {
  if (status === 'SAFE') return 'SAFE'
  if (status === 'UNSAFE') return 'UNSAFE'
  return 'SOMETIMES'
}

function tempCountPhrase(n: number): string {
  if (n === 0) return 'You have not chosen any temperature types to avoid yet.'
  if (n === 1) return 'You have chosen 1 temperature type to avoid in recipes.'
  return `You have chosen ${n} temperature types to avoid in recipes.`
}

function textureCountPhrase(n: number): string {
  if (n === 0) return 'You have not marked any textures as unsafe yet.'
  if (n === 1) return 'You have chosen 1 texture type marked as unsafe for you.'
  return `You have chosen ${n} texture types marked as unsafe for you.`
}

function restrictionCountPhrase(n: number): string {
  if (n === 0) return 'You have not selected any dietary or cultural restrictions yet.'
  if (n === 1) return 'You have chosen 1 dietary or cultural restriction.'
  return `You have chosen ${n} dietary or cultural restrictions.`
}

function foodCountPhrase(n: number): string {
  if (n === 0) return 'You have not added any foods to your safety list yet.'
  if (n === 1) return 'You have tagged 1 food on your safety list.'
  return `You have tagged ${n} foods on your safety list.`
}
</script>

<template>
  <div class="page">
    <div class="top-row">
      <a class="link" href="#" @click.prevent="router.back()">← Back</a>
      <RouterLink v-if="hasProfile" to="/sensory/setup" class="link">Edit →</RouterLink>
      <span v-else class="link-placeholder" />
    </div>

    <div v-if="profileLoading" class="muted">Loading…</div>
    <div v-else-if="!hasProfile || !profile" class="muted">
      No profile yet. <RouterLink to="/sensory" class="inline-link">Create your sensory profile</RouterLink>.
    </div>

    <div v-else class="card">
      <div class="card-title">
        <span class="title-icon title-icon--anim" aria-hidden="true">📋</span>
        <span>Your Profile Summary</span>
      </div>

      <div class="summary-stack">
        <section class="summary-block" aria-labelledby="sum-temp-heading">
          <div class="block-head">
            <h2 id="sum-temp-heading" class="block-title">Unsafe Temperatures</h2>
            <RouterLink to="/sensory/setup/temperature" class="block-edit">Edit</RouterLink>
          </div>
          <p class="block-count">{{ tempCountPhrase(temperatureChips.length) }}</p>
          <div
            v-if="selectedTempRows.length > 0"
            class="choice-grid"
            role="list"
            aria-label="Temperatures you avoid"
          >
            <div
              v-for="row in selectedTempRows"
              :key="row.value"
              class="choice-card choice-card--static choice-card--temp-on"
              role="listitem"
            >
              <span class="choice-emoji choice-emoji--anim" aria-hidden="true">{{ row.emoji }}</span>
              <span class="choice-label">{{ row.value }}</span>
              <span class="choice-hint">{{ row.hint }}</span>
            </div>
          </div>
        </section>

        <section class="summary-block" aria-labelledby="sum-tex-heading">
          <div class="block-head">
            <h2 id="sum-tex-heading" class="block-title">Unsafe Textures</h2>
            <RouterLink to="/sensory/setup/texture" class="block-edit">Edit</RouterLink>
          </div>
          <p class="block-count">{{ textureCountPhrase(decoded.unsafe.length) }}</p>
          <div
            v-if="selectedTexturesOrdered.length > 0"
            class="choice-grid"
            role="list"
            aria-label="Textures marked unsafe"
          >
            <div
              v-for="t in selectedTexturesOrdered"
              :key="t"
              class="choice-card choice-card--static choice-card--texture-on"
              role="listitem"
            >
              <span class="choice-emoji choice-emoji--anim" aria-hidden="true">{{
                TEXTURE_OPTION_PRESENTATION[t].emoji
              }}</span>
              <span class="choice-label">{{ t }}</span>
              <span class="choice-hint">{{ TEXTURE_OPTION_PRESENTATION[t].hint }}</span>
            </div>
          </div>
        </section>

        <section class="summary-block" aria-labelledby="sum-diet-heading">
          <div class="block-head">
            <h2 id="sum-diet-heading" class="block-title">Dietary &amp; Cultural Restrictions</h2>
            <RouterLink to="/sensory/setup/dietary-cultural" class="block-edit">Edit</RouterLink>
          </div>
          <p class="block-count">{{ restrictionCountPhrase(selectedRestrictionChips.length) }}</p>
          <div
            v-if="selectedRestrictionChips.length > 0"
            class="choice-grid"
            role="list"
            aria-label="Your restrictions"
          >
            <div
              v-for="c in selectedRestrictionChips"
              :key="c.kind + ':' + c.label"
              class="choice-card choice-card--static choice-card--diet-on"
              role="listitem"
            >
              <span class="choice-emoji choice-emoji--anim" aria-hidden="true">{{ c.emoji }}</span>
              <span class="choice-label">{{ c.label }}</span>
              <span class="choice-hint">{{ c.hint }}</span>
            </div>
          </div>
        </section>

        <section class="summary-block" aria-labelledby="sum-food-heading">
          <div class="block-head">
            <h2 id="sum-food-heading" class="block-title">Food Safety Tags</h2>
            <RouterLink to="/sensory/setup/food-safety" class="block-edit">Edit</RouterLink>
          </div>
          <p class="block-count">{{ foodCountPhrase(foodItemsAll.length) }}</p>
          <p v-if="foodItemsAll.length > 0" class="block-lead">
            Each tag uses a Wicked ingredient icon from your profile (same library as recipe steps).
          </p>
          <div
            v-if="foodItemsAll.length > 0"
            class="food-summary-grid"
            role="list"
            aria-label="Food safety tags"
          >
            <div
              v-for="{ food, disp } in summaryFoodRows"
              :key="food.id"
              class="choice-card choice-card--static choice-card--food-on"
              role="listitem"
            >
              <div class="food-sum-visual">
                <img
                  v-if="foodThumbSrc(disp) && !foodThumbBroken.has(food.id)"
                  class="food-sum-thumb food-sum-thumb--anim"
                  :src="foodThumbSrc(disp) ?? undefined"
                  alt=""
                  @error="onFoodThumbError(food.id)"
                />
                <span v-else class="choice-emoji food-sum-emoji--anim" aria-hidden="true">{{ disp.emoji }}</span>
              </div>
              <span class="choice-label food-sum-label">{{ disp.label }}</span>
              <span class="choice-hint">{{ disp.hint }}</span>
              <span class="food-sum-pill" :class="foodPillClass(food.status)">{{
                foodStatusLabel(food.status)
              }}</span>
            </div>
          </div>
        </section>
      </div>

      <p v-if="submitError" class="submit-err" role="alert">{{ submitError }}</p>

      <div class="actions">
        <RouterLink to="/sensory/setup" class="bb-btn bb-btn--secondary">Edit profile</RouterLink>
        <button
          type="button"
          class="btn-submit"
          :disabled="submitting || profileLoading"
          @click="submitAndGoHome"
        >
          {{ submitting ? 'Saving…' : 'Submit' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: 760px;
  margin: 0 auto;
  padding: 1.25rem 1.25rem 3rem;
}
.top-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.8rem;
}
.link {
  color: var(--bb-accent);
  text-decoration: none;
  font-weight: 800;
}
.link-placeholder {
  width: 2rem;
}
.muted {
  color: var(--bb-muted);
}
.inline-link {
  color: var(--bb-accent);
  font-weight: 800;
  text-decoration: none;
}
.card {
  background: #fff;
  border: 1px solid var(--bb-border);
  border-radius: 18px;
  padding: 1rem 1.1rem;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.04);
}
.card-title {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  font-weight: 950;
  font-size: 1.15rem;
  margin-bottom: 0.75rem;
}
.title-icon {
  font-size: 1.1rem;
  display: inline-block;
}
@media (prefers-reduced-motion: no-preference) {
  .title-icon--anim {
    animation: icon-wiggle 3s ease-in-out infinite;
  }
  .choice-emoji--anim {
    display: inline-block;
    animation: emoji-bob 2.2s ease-in-out infinite;
  }
  .food-sum-emoji--anim {
    display: inline-block;
    animation: emoji-bob 2.5s ease-in-out infinite;
  }
  .food-sum-thumb--anim {
    animation: thumb-pulse 2.6s ease-in-out infinite;
  }
}
@media (prefers-reduced-motion: reduce) {
  .title-icon--anim,
  .choice-emoji--anim,
  .food-sum-emoji--anim,
  .food-sum-thumb--anim {
    animation: none;
  }
}
@keyframes emoji-bob {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-4px);
  }
}
@keyframes icon-wiggle {
  0%,
  100% {
    transform: rotate(0deg);
  }
  25% {
    transform: rotate(-6deg);
  }
  75% {
    transform: rotate(6deg);
  }
}
@keyframes thumb-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.04);
    opacity: 0.92;
  }
}

.summary-stack {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.summary-block {
  background: var(--bb-surface-low);
  border-radius: 14px;
  padding: 0.85rem 1rem;
  border: 1px solid color-mix(in srgb, var(--bb-border) 80%, transparent);
}
.block-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.75rem;
  margin-bottom: 0.35rem;
}
.block-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 900;
  color: var(--bb-primary);
}
.block-edit {
  color: var(--bb-accent);
  text-decoration: none;
  font-weight: 800;
  font-size: 0.85rem;
  flex-shrink: 0;
}
.block-count {
  margin: 0 0 0.75rem;
  font-size: 0.88rem;
  color: var(--bb-muted);
  line-height: 1.45;
  font-weight: 600;
}
.block-lead {
  margin: -0.35rem 0 0.75rem;
  font-size: 0.82rem;
  color: var(--bb-muted);
  line-height: 1.45;
  font-weight: 600;
}

.choice-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
}
.choice-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.35rem;
  min-height: 5.25rem;
  padding: 0.6rem 0.45rem;
  border-radius: 14px;
  border: 2px solid transparent;
  background: var(--bb-surface-lowest);
}
.choice-card--static {
  cursor: default;
  pointer-events: none;
}
.choice-emoji {
  font-size: 1.5rem;
  line-height: 1;
}
.choice-label {
  font-size: 0.88rem;
  font-weight: 800;
  color: var(--bb-primary, inherit);
}
.choice-hint {
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--bb-muted);
  line-height: 1.25;
  max-width: 100%;
}
.choice-card--temp-on {
  background: color-mix(in srgb, var(--bb-primary) 22%, var(--bb-surface-lowest));
  border-color: color-mix(in srgb, var(--bb-primary) 45%, transparent);
}
.choice-card--texture-on {
  background: color-mix(in srgb, var(--bb-error) 14%, var(--bb-surface-lowest));
  border-color: color-mix(in srgb, var(--bb-error) 40%, transparent);
}
.choice-card--diet-on {
  background: color-mix(in srgb, var(--bb-primary) 18%, var(--bb-surface-lowest));
  border-color: color-mix(in srgb, var(--bb-primary) 40%, transparent);
}

.choice-card--food-on {
  background: color-mix(in srgb, var(--bb-primary) 14%, var(--bb-surface-lowest));
  border-color: color-mix(in srgb, var(--bb-primary) 38%, transparent);
  min-height: 7.5rem;
}
.food-summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 0.75rem;
}
.food-sum-visual {
  width: 2.5rem;
  height: 2.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto;
}
.food-sum-thumb {
  width: 2.5rem;
  height: 2.5rem;
  object-fit: contain;
  border-radius: 8px;
  background: var(--bb-surface-high);
}
.food-sum-label {
  max-width: 100%;
  overflow-wrap: anywhere;
}
.food-sum-pill {
  margin-top: 0.15rem;
}
.food-pill {
  display: inline-flex;
  padding: 0.3rem 0.6rem;
  border-radius: 999px;
  font-weight: 900;
  font-size: 0.75rem;
}
.pill--safe {
  background: #dcfce7;
  color: #166534;
  border: 1px solid #86efac;
}
.pill--unsafe {
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fca5a5;
}
.pill--sometimes {
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fdba74;
}

.submit-err {
  margin: 0.75rem 0 0;
  color: #b91c1c;
  font-weight: 600;
  font-size: 0.9rem;
}

.actions {
  margin-top: 1rem;
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.65rem;
  align-items: center;
}

.btn-submit {
  border: none;
  background: #0ea5a4;
  color: #fff;
  font-weight: 800;
  border-radius: 10px;
  padding: 0.55rem 1.15rem;
  cursor: pointer;
  font-size: 0.95rem;
}
.btn-submit:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}
</style>
