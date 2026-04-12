<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { fetchIngredientIconMap, type IngredientMapItem } from '../lib/ingredientMap'
import { fetchWickedPickerItems, type WickedPickerItem } from '../lib/wickedIconPicker'
import { useSensorySetupForm } from '../composables/useSensorySetupForm'
import type { SensoryFoodItemDTO } from '../types/sensory'

const router = useRouter()
const {
  profileLoading,
  foodsForDisplay,
  showingExampleFoods,
  foodInputWickedIconId,
  foodInputStatus,
  addFoodError,
  addFoodBusy,
  editingFood,
  editingNotesTex,
  editingNotesSmell,
  editingNotesTemp,
  statusPillClasses,
  statusLabel,
  onFoodRowClick,
  addFood,
  saveEditingFood,
  deleteEditingFood,
  onCloseEdit,
  saveAndViewSummary,
} = useSensorySetupForm()

const wickedItems = ref<WickedPickerItem[]>([])
const pickerLoading = ref(true)
const pickerError = ref('')

const ingredientLegacy = ref<IngredientMapItem[]>([])

const wickedById = computed(() => new Map(wickedItems.value.map((i) => [i.wickedIconId, i])))
const ingredientByKey = computed(() => new Map(ingredientLegacy.value.map((i) => [i.ingredientKey, i])))

onMounted(async () => {
  pickerLoading.value = true
  pickerError.value = ''
  try {
    const [wicked, ing] = await Promise.all([
      fetchWickedPickerItems(),
      fetchIngredientIconMap().catch(() => [] as IngredientMapItem[]),
    ])
    wickedItems.value = wicked
    ingredientLegacy.value = ing
  } catch (e) {
    pickerError.value = e instanceof Error ? e.message : 'Could not load Wicked icons.'
  } finally {
    pickerLoading.value = false
  }
})

const takenWickedIds = computed(() => {
  const set = new Set<string>()
  for (const f of foodsForDisplay.value) {
    if (f.example) continue
    const wid = f.notes?.wickedIconId
    if (wid) {
      set.add(wid)
      continue
    }
    const match = wickedItems.value.find(
      (i) => i.label.toLowerCase() === f.name.trim().toLowerCase(),
    )
    if (match) set.add(match.wickedIconId)
  }
  return set
})

const selectableWicked = computed(() =>
  wickedItems.value.filter((i) => !takenWickedIds.value.has(i.wickedIconId)),
)

type RowDisp = { hint: string; emoji: string; thumbSrc: string | null }

function wickedThumbPath(iconId: string): string {
  return `/api/icons/wicked/${encodeURIComponent(iconId)}`
}

function rowDisplay(food: SensoryFoodItemDTO & { example?: boolean }): RowDisp {
  if (food.example) {
    if (food.name === 'Onion') return { emoji: '🧅', hint: 'Example — often strong smell or taste', thumbSrc: null }
    if (food.name === 'Scrambled Egg')
      return { emoji: '🍳', hint: 'Example — texture and smell vary a lot', thumbSrc: null }
    return { emoji: '🍽️', hint: 'Example row', thumbSrc: null }
  }
  const wid = food.notes?.wickedIconId?.trim()
  if (wid) {
    const w = wickedById.value.get(wid)
    return {
      hint: w?.hint ?? 'Wicked food icon',
      emoji: '🍽️',
      thumbSrc: wickedThumbPath(wid),
    }
  }
  const ik = food.notes?.ingredientKey
  if (ik && ingredientByKey.value.has(ik)) {
    const m = ingredientByKey.value.get(ik)!
    return { emoji: m.emoji, hint: m.hint, thumbSrc: null }
  }
  const nameMatch = wickedItems.value.find((i) => i.label.toLowerCase() === food.name.trim().toLowerCase())
  if (nameMatch) {
    return {
      hint: nameMatch.hint,
      emoji: '🍽️',
      thumbSrc: wickedThumbPath(nameMatch.wickedIconId),
    }
  }
  return { emoji: '🍽️', hint: 'Saved on your profile', thumbSrc: null }
}

const foodThumbBroken = ref<Set<string>>(new Set())

function onFoodThumbError(rowId: string) {
  foodThumbBroken.value = new Set(foodThumbBroken.value).add(rowId)
}

const foodRows = computed(() =>
  foodsForDisplay.value.map((food) => ({
    food,
    disp: rowDisplay(food),
  })),
)

// Browser can show a row without syncing v-model; ensure a real id is selected when options exist.
watch(
  selectableWicked,
  (list) => {
    if (list.length > 0 && !foodInputWickedIconId.value) {
      foodInputWickedIconId.value = list[0].wickedIconId
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="page">
    <div class="top-nav">
      <a class="link" href="#" @click.prevent="router.push({ name: 'sensorySetup' })">← Back</a>
      <button type="button" class="link link-btn" :disabled="profileLoading" @click="saveAndViewSummary">View Summary →</button>
    </div>
    <h1 class="h1">Food Safety Tags</h1>
    <p class="sub">Tag ingredients from the Wicked library so we can match icons in recipes.</p>

    <section class="card">
      <p v-if="showingExampleFoods" class="example-banner" role="note">Below as an example</p>
      <ul class="food-list" role="list">
        <li v-for="{ food, disp } in foodRows" :key="food.id" class="food-li">
          <button
            type="button"
            class="food-card"
            :class="{ 'food-card--disabled': food.example }"
            :disabled="food.example"
            @click="onFoodRowClick(food)"
          >
            <div class="food-card-main">
              <div class="food-card-visual">
                <img
                  v-if="disp.thumbSrc && !foodThumbBroken.has(food.id)"
                  class="food-thumb food-thumb--anim"
                  :src="disp.thumbSrc"
                  alt=""
                  @error="onFoodThumbError(food.id)"
                />
                <span v-else class="food-card-emoji food-card-emoji--anim" aria-hidden="true">{{ disp.emoji }}</span>
              </div>
              <div class="food-card-copy">
                <span class="food-card-name">{{ food.name }}</span>
                <span class="food-card-hint">{{ disp.hint }}</span>
              </div>
            </div>
            <span class="food-pill" :class="statusPillClasses(food.status)">{{ statusLabel(food.status) }}</span>
          </button>
        </li>
      </ul>

      <div class="add-food">
        <div class="add-food-title">Add a Wicked icon</div>
        <p class="add-food-help">
          Icons are stored in <strong>wicked_icons</strong> (name + image URL). If the catalog is empty or stale, the
          server syncs from <strong>food.getwicked.app</strong> and updates the database automatically.
        </p>
        <div v-if="pickerError" class="map-err" role="alert">{{ pickerError }}</div>
        <div v-else-if="pickerLoading" class="muted map-loading">Loading Wicked icons…</div>
        <template v-else>
          <div class="add-food-row">
            <select
              v-model="foodInputWickedIconId"
              class="select select-ingredient"
              :disabled="profileLoading || selectableWicked.length === 0"
            >
              <option disabled value="">Select a Wicked icon…</option>
              <option v-for="opt in selectableWicked" :key="opt.wickedIconId" :value="opt.wickedIconId">
                {{ opt.label }}
              </option>
            </select>
            <select v-model="foodInputStatus" class="select" :disabled="profileLoading">
              <option value="UNSURE">Sometimes</option>
              <option value="UNSAFE">Unsafe</option>
            </select>
            <button
              type="button"
              class="link link-btn add-text-action"
              :disabled="addFoodBusy || !foodInputWickedIconId || selectableWicked.length === 0"
              @click="addFood"
            >
              {{ addFoodBusy ? 'Adding…' : 'Add' }}
            </button>
          </div>
          <p v-if="addFoodError" class="add-err" role="alert">{{ addFoodError }}</p>
          <p v-if="selectableWicked.length === 0 && wickedItems.length > 0" class="muted add-foot">
            All icons in the list are already on your list.
          </p>
          <p v-if="wickedItems.length === 0" class="muted add-foot">
            No icons available. Ensure the backend can reach https://food.getwicked.app/ to populate
            <code>wicked_icons</code>.
          </p>
        </template>
      </div>
    </section>

    <div class="footer">
      <button type="button" class="bb-btn bb-btn--secondary" @click="router.push({ name: 'sensorySetupDietaryCultural' })">Back</button>
      <button type="button" class="btn-primary" @click="saveAndViewSummary">Save and Next</button>
    </div>

    <div v-if="editingFood" class="modal-backdrop" role="dialog" aria-modal="true">
      <div class="modal">
        <div class="modal-head">
          <div class="modal-title">Edit food</div>
          <button type="button" class="modal-close" @click="onCloseEdit">✕</button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label class="lbl">Food name</label>
            <input class="input" v-model="editingFood.name" :disabled="true" />
          </div>
          <div class="field">
            <label class="lbl">Status</label>
            <select v-model="editingFood.status" class="select">
              <option value="SAFE">Safe</option>
              <option value="UNSURE">Sometimes OK</option>
              <option value="UNSAFE">Unsafe</option>
            </select>
          </div>
          <div class="field-grid">
            <div class="field">
              <label class="lbl">Texture note</label>
              <input class="input" v-model="editingNotesTex" />
            </div>
            <div class="field">
              <label class="lbl">Smell note</label>
              <input class="input" v-model="editingNotesSmell" />
            </div>
            <div class="field">
              <label class="lbl">Temperature note</label>
              <input class="input" v-model="editingNotesTemp" />
            </div>
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="bb-btn bb-btn--secondary" @click="deleteEditingFood">Remove</button>
          <button type="button" class="btn-primary" @click="saveEditingFood">Save changes</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: 72rem;
  margin: 0 auto;
  padding: 1.5rem 1.25rem 3rem;
}
.top-nav {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.8rem;
}
.link {
  color: var(--bb-primary);
  text-decoration: none;
  font-weight: 800;
}
.link-btn {
  border: none;
  background: transparent;
  cursor: pointer;
}
.add-text-action {
  align-self: center;
  padding: 0.35rem 0.25rem;
  font-size: 0.95rem;
  white-space: nowrap;
}
.add-text-action:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.h1 {
  margin: 0 0 0.3rem;
  color: var(--bb-primary);
  font-size: 2rem;
}
.sub {
  color: var(--bb-muted);
  margin: 0 0 1rem;
  line-height: 1.45;
}
.card {
  background: var(--bb-surface-low);
  border-radius: 16px;
  padding: 1rem;
}
.example-banner {
  margin: 0 0 0.85rem;
  padding: 0.65rem 0.75rem;
  border-radius: 10px;
  background: color-mix(in srgb, var(--bb-primary) 10%, var(--bb-surface-lowest));
  color: var(--bb-muted);
  font-size: 0.9rem;
  line-height: 1.45;
}
.food-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.food-li {
  margin: 0;
  padding: 0;
}
.food-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  text-align: left;
  border-radius: 14px;
  padding: 0.7rem 0.85rem;
  border: 2px solid transparent;
  background: var(--bb-surface-lowest);
  cursor: pointer;
  font: inherit;
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
}
.food-card:not(:disabled):hover,
.food-card:not(:disabled):focus-visible {
  border-color: color-mix(in srgb, var(--bb-primary) 35%, transparent);
}
@media (prefers-reduced-motion: no-preference) {
  .food-card:not(:disabled):hover,
  .food-card:not(:disabled):focus-visible {
    transform: scale(1.01);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.07);
  }
  .food-card-emoji--anim {
    display: inline-block;
    animation: emoji-bob 2.2s ease-in-out infinite;
  }
  .food-thumb--anim {
    animation: thumb-pulse 2.5s ease-in-out infinite;
  }
}
@media (prefers-reduced-motion: reduce) {
  .food-card:not(:disabled):focus-visible {
    outline: 2px solid var(--bb-primary);
    outline-offset: 2px;
  }
  .food-card-emoji--anim,
  .food-thumb--anim {
    animation: none;
  }
}
@keyframes emoji-bob {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-3px);
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
.food-card--disabled {
  opacity: 0.72;
  cursor: default;
  pointer-events: none;
}
.food-card-main {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
  flex: 1;
}
.food-card-visual {
  width: 2.5rem;
  height: 2.5rem;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.food-thumb {
  width: 2.5rem;
  height: 2.5rem;
  object-fit: contain;
  border-radius: 8px;
  background: var(--bb-surface-high);
}
.food-card-emoji {
  font-size: 1.75rem;
  line-height: 1;
}
.food-card-copy {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
.food-card-name {
  font-weight: 900;
  font-size: 1rem;
  color: var(--bb-primary);
}
.food-card-hint {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--bb-muted);
  line-height: 1.3;
}
.food-pill {
  display: inline-flex;
  padding: 0.35rem 0.65rem;
  border-radius: 999px;
  font-weight: 900;
  font-size: 0.8rem;
  flex-shrink: 0;
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
.add-food {
  margin-top: 1rem;
}
.add-food-title {
  font-weight: 900;
  margin-bottom: 0.35rem;
  color: var(--bb-muted);
}
.add-food-help {
  margin: 0 0 0.65rem;
  font-size: 0.85rem;
  color: var(--bb-muted);
  line-height: 1.4;
}
.add-food-help strong {
  color: var(--bb-primary);
  font-weight: 800;
}
.map-err,
.add-err {
  margin: 0 0 0.5rem;
  color: #b91c1c;
  font-size: 0.88rem;
  font-weight: 600;
}
.map-loading {
  font-size: 0.9rem;
}
.add-foot {
  margin: 0.5rem 0 0;
  font-size: 0.82rem;
}
.add-foot code {
  font-size: 0.75rem;
}
.add-food-row {
  display: grid;
  grid-template-columns: 1.4fr 1fr auto;
  gap: 0.6rem;
  align-items: stretch;
}
.select,
.input {
  width: 100%;
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 0.7rem 0.8rem;
  font: inherit;
  background: var(--bb-surface-high);
}
.select-ingredient {
  min-height: 2.85rem;
}
.btn-primary {
  border: none;
  background: var(--bb-cta-gradient);
  color: #fff;
  font-weight: 900;
  border-radius: 10px;
  padding: 0.7rem 1.1rem;
  cursor: pointer;
}
.btn-small {
  padding: 0.55rem 0.8rem;
}
.muted {
  color: var(--bb-muted);
}
.footer {
  display: flex;
  justify-content: space-between;
  margin-top: 1rem;
}
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(28, 25, 23, 0.38);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  z-index: 100;
}
.modal {
  width: 680px;
  max-width: 100%;
  border-radius: 14px;
  background: var(--bb-surface-lowest);
  border: 1px solid var(--bb-border);
  overflow: hidden;
}
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.9rem 1.1rem;
  border-bottom: 1px solid var(--bb-border);
}
.modal-title {
  font-weight: 900;
}
.modal-close {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 1.1rem;
  color: var(--bb-muted);
}
.modal-body {
  padding: 1rem 1.1rem;
}
.field {
  margin-bottom: 0.9rem;
}
.lbl {
  display: block;
  font-weight: 800;
  color: var(--bb-muted);
  font-size: 0.9rem;
  margin: 0.5rem 0 0.3rem;
}
.field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0.7rem;
}
.modal-actions {
  padding: 0.9rem 1.1rem;
  border-top: 1px solid var(--bb-border);
  display: flex;
  justify-content: space-between;
}
@media (max-width: 720px) {
  .add-food-row,
  .field-grid {
    grid-template-columns: 1fr;
  }
}
</style>
