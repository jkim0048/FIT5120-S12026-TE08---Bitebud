<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import {
  CULTURAL_CHIPS,
  DIETARY_CHIPS,
  TEXTURE_OPTION_PRESENTATION,
  TEXTURE_OPTIONS,
  useSensorySetupForm,
} from '../composables/useSensorySetupForm'
import { getBiteBudUserId } from '../composables/useUserId'

const router = useRouter()
const expanded = ref<'texture' | 'dietary' | 'food' | null>(null)

const SECTION_ORDER = ['texture', 'dietary', 'food'] as const

const {
  profileLoading,
  saveError,
  selectedUnsafeTextures,
  selectedDietary,
  selectedCultural,
  foodQuery,
  foodPickerOpen,
  pickerLoading,
  pickerError,
  filteredPickerItems,
  shortPickerLabel,
  foodDisplayName,
  addFoodError,
  foodsForDisplay,
  textureDone,
  dietaryDone,
  foodSafetyDone,
  toggleUnsafeTexture,
  toggleDietary,
  toggleCultural,
  loadFoodPickerItems,
  choosePickerItem,
  openFoodPicker,
  closeFoodPickerSoon,
  resolveWickedImage,
  saveAndViewSummary,
  saveTexturesSection,
  saveDietaryCulturalSection,
  saveFoodSafetySection,
  editingFood,
  editFoodError,
  editFoodBusy,
  onFoodRowClick,
  saveEditingFood,
  deleteEditingFood,
  onCloseEdit,
} = useSensorySetupForm()

const sectionBusy = ref<'texture' | 'dietary' | 'food' | null>(null)
const sectionError = ref('')

onMounted(() => {
  if (!getBiteBudUserId()) router.replace({ name: 'auth' })
})

function toggleSection(name: 'texture' | 'dietary' | 'food') {
  expanded.value = expanded.value === name ? null : name
  sectionError.value = ''
  if (name === 'food') void loadFoodPickerItems()
}

async function saveSection(name: 'texture' | 'dietary' | 'food') {
  sectionError.value = ''
  sectionBusy.value = name
  try {
    if (name === 'texture') await saveTexturesSection()
    if (name === 'dietary') await saveDietaryCulturalSection()
    if (name === 'food') await saveFoodSafetySection()

    if (name === 'food') {
      expanded.value = null
    } else {
      const i = SECTION_ORDER.indexOf(name)
      if (i >= 0 && i < SECTION_ORDER.length - 1) {
        const next = SECTION_ORDER[i + 1]!
        expanded.value = next
        if (next === 'food') void loadFoodPickerItems()
      }
    }
  } catch (e) {
    sectionError.value = e instanceof Error ? e.message : 'Could not save section. Please try again.'
  } finally {
    sectionBusy.value = null
  }
}

function onSuggestionImageError(e: Event, fallback: string | null) {
  if (!fallback) return
  const img = e.target as HTMLImageElement | null
  if (!img || img.dataset.fallbackApplied === '1') return
  img.dataset.fallbackApplied = '1'
  img.src = fallback
}

function onFoodEditThumbError(e: Event) {
  const img = e.target as HTMLImageElement | null
  if (img) img.style.display = 'none'
}
</script>

<template>
  <div class="page">
    <div class="top-nav">
      <RouterLink class="link link-back" :to="{ name: 'profileStart' }">← Back to profile</RouterLink>
      <button type="button" class="link link-btn" :disabled="profileLoading" @click="saveAndViewSummary">Save and review →</button>
    </div>

    <h1 class="h1">Set up your food preferences</h1>
    <p class="sub">Expand each section below, update preferences, then save each section.</p>

    <p v-if="saveError || sectionError" class="save-err" role="alert">{{ sectionError || saveError }}</p>

    <section class="stack">
      <article class="section-card">
        <button type="button" class="section-head" @click="toggleSection('texture')">
          <div>
            <h2>Challenging textures</h2>
            <p>Select textures that are not safe for you.</p>
          </div>
          <div class="right">
            <span class="done">{{ textureDone ? '✓' : '○' }}</span>
            <span>{{ expanded === 'texture' ? '−' : '+' }}</span>
          </div>
        </button>
        <div v-if="expanded === 'texture'" class="section-body">
          <div class="option-grid">
            <button
              v-for="opt in TEXTURE_OPTIONS"
              :key="opt"
              type="button"
              class="option-card"
              :class="{ on: selectedUnsafeTextures.includes(opt) }"
              :aria-pressed="selectedUnsafeTextures.includes(opt)"
              @click="toggleUnsafeTexture(opt)"
            >
              <div class="opt-emoji">{{ TEXTURE_OPTION_PRESENTATION[opt].emoji }}</div>
              <div class="opt-title">{{ opt }}</div>
              <div class="opt-hint">{{ TEXTURE_OPTION_PRESENTATION[opt].hint }}</div>
            </button>
          </div>
          <button type="button" class="bb-btn bb-btn--primary save-btn" :disabled="sectionBusy === 'texture'" @click="saveSection('texture')">
            {{ sectionBusy === 'texture' ? 'Saving…' : 'Save and Next' }}
          </button>
        </div>
      </article>

      <article class="section-card">
        <button type="button" class="section-head" @click="toggleSection('dietary')">
          <div>
            <h2>Dietary &amp; Cultural Restrictions</h2>
            <p>Select restrictions that should be treated as unsafe for suggestions.</p>
          </div>
          <div class="right">
            <span class="done">{{ dietaryDone ? '✓' : '○' }}</span>
            <span>{{ expanded === 'dietary' ? '−' : '+' }}</span>
          </div>
        </button>
        <div v-if="expanded === 'dietary'" class="section-body">
          <div class="option-grid">
            <button
              v-for="chip in [...DIETARY_CHIPS, ...CULTURAL_CHIPS]"
              :key="chip.label"
              type="button"
              class="option-card"
              :class="{ on: selectedDietary.includes(chip.label) || selectedCultural.includes(chip.label) }"
              :aria-pressed="selectedDietary.includes(chip.label) || selectedCultural.includes(chip.label)"
              @click="chip.kind === 'dietary' ? toggleDietary(chip.label) : toggleCultural(chip.label)"
            >
              <div class="opt-emoji">{{ chip.emoji }}</div>
              <div class="opt-title">{{ chip.label }}</div>
              <div class="opt-hint">{{ chip.hint }}</div>
            </button>
          </div>
          <button type="button" class="bb-btn bb-btn--primary save-btn" :disabled="sectionBusy === 'dietary'" @click="saveSection('dietary')">
            {{ sectionBusy === 'dietary' ? 'Saving…' : 'Save and Next' }}
          </button>
        </div>
      </article>

      <article class="section-card">
        <button type="button" class="section-head" @click="toggleSection('food')">
          <div>
            <h2>Any food Allergies or Intolerances</h2>
            <p>Tag ingredients from the ingredients library so know your preference.</p>
          </div>
          <div class="right">
            <span class="done">{{ foodSafetyDone ? '✓' : '○' }}</span>
            <span>{{ expanded === 'food' ? '−' : '+' }}</span>
          </div>
        </button>
        <div v-if="expanded === 'food'" class="section-body">
          <div class="food-controls-head">
            <span class="food-controls-label">Add food Item from the list</span>
          </div>
          <p class="food-help">Click or search for an ingredient.</p>

          <div class="food-add-row">
            <div class="food-input-wrap">
              <input
                id="food-search"
                v-model="foodQuery"
                class="food-input"
                placeholder="Search a food tag..."
                @focus="openFoodPicker(); loadFoodPickerItems()"
                @blur="closeFoodPickerSoon"
              />
              <ul v-if="foodPickerOpen && foodQuery && filteredPickerItems.length" class="picker-list">
                <li v-for="item in filteredPickerItems" :key="item.wickedIconId">
                  <button type="button" class="picker-item" @click="choosePickerItem(item)">
                    <img
                      class="picker-thumb"
                      :src="resolveWickedImage(item.wickedIconId) || item.imageUrl || ''"
                      :alt="`${item.label} icon`"
                      @error="onSuggestionImageError($event, item.imageUrl)"
                    />
                    <span class="picker-copy">
                      <span>{{ shortPickerLabel(item) }}</span>
                      <small v-if="item.hint">{{ item.hint }}</small>
                    </span>
                  </button>
                </li>
              </ul>
            </div>
          </div>
          <div v-if="pickerLoading" class="muted">Loading food tags…</div>
          <div v-if="pickerError" class="save-err">{{ pickerError }}</div>
          <p v-if="addFoodError" class="save-err">{{ addFoodError }}</p>

          <ul class="food-list">
            <li v-for="item in foodsForDisplay" :key="item.id" class="food-li">
              <button type="button" class="food-item food-item--clickable" @click="void onFoodRowClick(item)">
                <img
                  class="food-thumb"
                  :src="resolveWickedImage(item.notes?.wickedIconId) || ''"
                  alt=""
                />
                <span class="food-name-wrap">
                  <span class="food-name">{{ foodDisplayName(item) }}</span>
                  <small class="food-note">Tap to edit or remove</small>
                </span>
              </button>
            </li>
          </ul>
          <button type="button" class="bb-btn bb-btn--primary save-btn" :disabled="sectionBusy === 'food'" @click="saveSection('food')">
            {{ sectionBusy === 'food' ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </article>
    </section>

    <div class="footer">
      <button type="button" class="bb-btn bb-btn--secondary" @click="router.push({ name: 'cookingStart' })">Skip for now</button>
      <button type="button" class="bb-btn bb-btn--primary" :disabled="profileLoading" @click="saveAndViewSummary">Save and review</button>
    </div>

    <Teleport to="body">
      <div v-if="editingFood" class="food-edit-layer">
        <div class="food-edit-backdrop" role="presentation" @click="onCloseEdit" />
        <div class="food-edit-root" role="dialog" aria-modal="true" aria-labelledby="food-edit-title">
        <div class="food-edit-modal">
          <div class="food-edit-head">
            <h2 id="food-edit-title" class="food-edit-title">Edit food</h2>
            <button type="button" class="food-edit-close" aria-label="Close" @click="onCloseEdit">×</button>
          </div>
          <div class="food-edit-body">
            <div class="food-edit-tag-preview" aria-hidden="true">
              <img
                v-if="resolveWickedImage(editingFood.notes?.wickedIconId)"
                class="food-edit-preview-thumb"
                alt=""
                :src="resolveWickedImage(editingFood.notes?.wickedIconId)!"
                @error="onFoodEditThumbError"
              />
              <span v-else class="food-edit-preview-ph">🍽</span>
              <div class="food-edit-preview-text">
                <span class="food-edit-preview-name">{{ editingFood.name }}</span>
              </div>
            </div>

            <label class="food-edit-label" for="food-edit-name">Food name</label>
            <input
              id="food-edit-name"
              class="food-edit-input food-edit-input--readonly"
              type="text"
              :value="editingFood.name"
              readonly
              tabindex="-1"
              aria-readonly="true"
            />

            <p v-if="editFoodError" class="food-edit-err" role="alert">{{ editFoodError }}</p>
          </div>
          <div class="food-edit-footer">
            <button type="button" class="bb-btn bb-btn--secondary" :disabled="editFoodBusy" @click="deleteEditingFood">Remove</button>
            <button type="button" class="bb-btn bb-btn--primary" :disabled="editFoodBusy" @click="saveEditingFood">
              {{ editFoodBusy ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.page {
  max-width: 72rem;
  margin: 0 auto;
  padding: 1.25rem 1.25rem 3rem;
}
.top-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}
.link {
  color: var(--bb-primary);
  text-decoration: none;
  font-weight: 700;
}
.link-back {
  flex: 0 1 auto;
  min-width: 0;
}
.link-btn {
  border: none;
  background: transparent;
  cursor: pointer;
}
.muted {
  color: var(--bb-muted);
}
.h1 {
  margin: 0 0 0.2rem;
  font-family: var(--bb-font-headline);
  font-size: 2.1rem;
  color: var(--bb-primary);
}
.sub {
  margin: 0 0 1rem;
  color: var(--bb-muted);
}
.save-err {
  color: #b91c1c;
  font-weight: 600;
}
.stack {
  display: grid;
  gap: 0.9rem;
}
.section-card {
  background: var(--bb-surface-lowest);
  border: 1px solid var(--bb-border);
  border-radius: 16px;
  padding: 0.8rem 0.9rem 0.95rem;
}
.section-head {
  width: 100%;
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  border: none;
  background: transparent;
  text-align: left;
  padding: 0.35rem 0;
  color: var(--bb-text);
}
.section-head h2 {
  margin: 0;
  font-family: var(--bb-font-headline);
  font-size: 1.95rem;
  line-height: 1.05;
  color: var(--bb-text);
}
.section-head p {
  margin: 0.3rem 0 0;
  color: color-mix(in srgb, var(--bb-text) 75%, var(--bb-bg));
}
.right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 800;
}
.done {
  color: #166534;
}
.section-body {
  margin-top: 0.85rem;
  border-top: 1px solid var(--bb-border);
  padding-top: 0.85rem;
}
.option-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.65rem;
}
.option-card {
  border: 1px solid var(--bb-border);
  background: #fff;
  border-radius: 14px;
  padding: 0.75rem 0.65rem;
  text-align: center;
  min-height: 110px;
}
.option-card.on {
  border-color: var(--bb-primary);
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--bb-primary) 35%, transparent);
  background: color-mix(in srgb, var(--bb-primary) 10%, #fff);
}
.opt-emoji {
  font-size: 1.2rem;
  line-height: 1;
}
.opt-title {
  margin-top: 0.35rem;
  font-weight: 800;
  color: var(--bb-primary);
}
.opt-hint {
  margin-top: 0.3rem;
  color: var(--bb-muted);
  font-size: 0.8rem;
  line-height: 1.25;
}
.food-controls-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}
.food-controls-label {
  font-weight: 700;
}
.food-summary-link {
  border: none;
  background: transparent;
  color: var(--bb-primary);
  font-weight: 700;
  cursor: pointer;
}
.food-example-top {
  margin: 0 0 0.5rem;
  padding: 0.5rem 0.65rem;
  font-size: 0.85rem;
  line-height: 1.4;
  color: var(--bb-muted);
  background: color-mix(in srgb, var(--bb-secondary-container) 55%, var(--bb-surface-lowest));
  border: 1px solid var(--bb-border);
  border-radius: 10px;
}
.food-help {
  margin: 0.35rem 0 0.6rem;
  color: var(--bb-muted);
  font-size: 0.82rem;
}
.food-add-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.5rem;
  align-items: start;
}
.food-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.food-input-wrap {
  position: relative;
}
.food-input {
  border: 1px solid var(--bb-border);
  border-radius: 8px;
  padding: 0.55rem 0.7rem;
  font: inherit;
  background: #fff;
  width: 100%;
}
.food-status-select {
  border: 1px solid var(--bb-border);
  border-radius: 8px;
  padding: 0.55rem 0.7rem;
  font: inherit;
  background: #fff;
}
.food-add-btn {
  border: none;
  background: transparent;
  color: var(--bb-primary);
  font-weight: 700;
  padding: 0.55rem 0.45rem;
  cursor: pointer;
}
.food-add-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.picker-list {
  list-style: none;
  margin: 0.2rem 0 0;
  padding: 0;
  max-height: 180px;
  overflow: auto;
  border: 1px solid var(--bb-border);
  border-radius: 8px;
  background: #fff;
  position: absolute;
  width: 100%;
  z-index: 10;
}
.picker-item {
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  padding: 0.45rem 0.65rem;
  display: flex;
  align-items: center;
  gap: 0.55rem;
  color: var(--bb-text);
}
.picker-copy {
  display: grid;
  flex: 1;
  min-width: 0;
}
.picker-copy > span {
  color: var(--bb-text);
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.picker-copy small {
  color: var(--bb-muted);
}
.picker-thumb,
.food-thumb {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  object-fit: cover;
  background: var(--bb-surface-high);
}
.food-list {
  margin: 0.9rem 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0.4rem;
}
.food-item {
  display: grid;
  grid-template-columns: 28px 1fr;
  align-items: center;
  gap: 0.55rem;
  background: #fff;
  border: 1px solid var(--bb-border);
  border-radius: 8px;
  padding: 0.5rem 0.65rem;
}
.food-li {
  list-style: none;
}
.food-item--example {
  background: #f8fafc;
}
.food-item--clickable {
  width: 100%;
  cursor: pointer;
  font: inherit;
  text-align: left;
  border: 1px solid var(--bb-border);
}
.food-item--clickable:focus-visible {
  outline: 2px solid var(--bb-focus-ring);
  outline-offset: 2px;
}
.food-name {
  min-width: 0;
  display: block;
  color: var(--bb-text);
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.food-name-wrap {
  display: grid;
  min-width: 0;
  width: 100%;
}
.food-note {
  color: var(--bb-muted);
  font-size: 0.75rem;
}
.food-status {
  font-size: 0.75rem;
  border-radius: 999px;
  padding: 0.2rem 0.45rem;
  line-height: 1;
}
.food-status--safe {
  background: #dcfce7;
  color: #166534;
}
.food-status--unsafe {
  background: #fee2e2;
  color: #991b1b;
}
.food-status--unsure {
  background: #fef3c7;
  color: #92400e;
}
.save-btn {
  margin-top: 0.85rem;
}
.footer {
  margin-top: 1rem;
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}
@media (max-width: 980px) {
  .option-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 560px) {
  .option-grid {
    grid-template-columns: 1fr;
  }
  .food-add-row {
    grid-template-columns: 1fr;
  }
}

.food-edit-layer {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}
.food-edit-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(26, 28, 25, 0.45);
}
.food-edit-root {
  position: relative;
  width: 100%;
  max-width: 26rem;
}
.food-edit-modal {
  background: var(--bb-surface-lowest);
  border-radius: 16px;
  box-shadow: 0 24px 48px rgba(26, 28, 25, 0.18);
  border: 1px solid var(--bb-border);
  overflow: hidden;
}
.food-edit-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--bb-border);
}
.food-edit-title {
  margin: 0;
  font-family: var(--bb-font-headline);
  font-size: 1.15rem;
  color: var(--bb-primary);
}
.food-edit-close {
  border: none;
  background: transparent;
  font-size: 1.5rem;
  line-height: 1;
  color: var(--bb-muted);
  cursor: pointer;
  padding: 0.15rem 0.35rem;
}
.food-edit-body {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.food-edit-label {
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--bb-muted);
}
.food-edit-input {
  border: 1px solid var(--bb-border);
  border-radius: 10px;
  padding: 0.55rem 0.7rem;
  font: inherit;
  background: var(--bb-surface-low);
  color: var(--bb-text);
}
.food-edit-input--readonly {
  cursor: default;
  color: var(--bb-muted);
  background: color-mix(in srgb, var(--bb-surface-high) 65%, var(--bb-surface-lowest));
}
.food-edit-tag-preview {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.55rem 0.65rem;
  margin-bottom: 0.35rem;
  background: var(--bb-surface-low);
  border: 1px solid var(--bb-border);
  border-radius: 10px;
}
.food-edit-preview-thumb {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  object-fit: cover;
  background: var(--bb-surface-high);
  flex-shrink: 0;
}
.food-edit-preview-ph {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  font-size: 1.2rem;
  opacity: 0.45;
  flex-shrink: 0;
}
.food-edit-preview-text {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.food-edit-preview-name {
  font-weight: 700;
  color: var(--bb-text);
  font-size: 0.95rem;
  line-height: 1.25;
  word-break: break-word;
}
.food-edit-preview-pill {
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  padding: 0.22rem 0.45rem;
  border-radius: 999px;
  flex-shrink: 0;
}
.food-edit-err {
  margin: 0.25rem 0 0;
  color: var(--bb-error);
  font-size: 0.88rem;
  font-weight: 600;
}
.food-edit-footer {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  border-top: 1px solid var(--bb-border);
  background: color-mix(in srgb, var(--bb-surface-low) 55%, var(--bb-surface-lowest));
}
</style>
