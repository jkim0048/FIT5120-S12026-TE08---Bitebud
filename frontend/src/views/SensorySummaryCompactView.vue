<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { apiFetch } from '../lib/api'
import { persistSensoryProfileSnapshot } from '../lib/sensorySnapshot'
import { refreshSensoryProfile, useSensoryProfile } from '../composables/useSensoryProfile'
import { getBiteBudUserId } from '../composables/useUserId'
import type { SensoryFoodStatus } from '../types/sensory'
import {
  CULTURAL_CHIPS,
  decodeUnsafeTexturePrefs,
  DIETARY_CHIPS,
  TEMPERATURE_PRESENTATION,
  TEXTURE_OPTION_PRESENTATION,
} from '../composables/useSensorySetupForm'

const router = useRouter()
const { profile, loading: profileLoading, hasProfile } = useSensoryProfile()

const submitBusy = ref(false)
const submitError = ref('')

onMounted(() => {
  void refreshSensoryProfile()
})

const temperatures = computed(() => {
  const tp = profile.value?.temperaturePref
  if (!tp?.trim()) return []
  return tp
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
})

const temperatureCards = computed(() =>
  temperatures.value
    .map((v) => TEMPERATURE_PRESENTATION.find((x) => x.value === v))
    .filter((x): x is NonNullable<typeof x> => Boolean(x)),
)

const unsafeTextures = computed(() => decodeUnsafeTexturePrefs(profile.value?.texturePrefs))

const textureCards = computed(() =>
  unsafeTextures.value
    .map((label) => {
      const k = label as keyof typeof TEXTURE_OPTION_PRESENTATION
      return TEXTURE_OPTION_PRESENTATION[k] ? { label, ...TEXTURE_OPTION_PRESENTATION[k] } : null
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x)),
)

type Chip = (typeof DIETARY_CHIPS)[number]

const dietaryCulturalCards = computed(() => {
  const d = profile.value?.dietaryNeeds ?? []
  const c = profile.value?.culturalRequirements ?? []
  const out: Chip[] = []
  for (const label of d) {
    const chip = DIETARY_CHIPS.find((x) => x.label === label)
    if (chip) out.push(chip)
  }
  for (const label of c) {
    const chip = CULTURAL_CHIPS.find((x) => x.label === label)
    if (chip) out.push(chip)
  }
  return out
})

const dietaryCulturalCount = computed(() => dietaryCulturalCards.value.length)

const foodItems = computed(() => profile.value?.foodItems ?? [])

function statusLabel(status: SensoryFoodStatus): string {
  if (status === 'SAFE') return 'SAFE'
  if (status === 'UNSAFE') return 'UNSAFE'
  return 'SOMETIMES'
}

function statusPillClass(status: SensoryFoodStatus): string {
  if (status === 'SAFE') return 'pill pill--safe'
  if (status === 'UNSAFE') return 'pill pill--unsafe'
  return 'pill pill--sometimes'
}

function resolveWickedImage(iconId: string | undefined | null): string | null {
  if (!iconId?.trim()) return null
  return `/api/icons/wicked/${iconId}`
}

function onFoodImageError(ev: Event) {
  const el = ev.target as HTMLImageElement | null
  if (el) el.style.display = 'none'
}

async function submitProfile(): Promise<void> {
  const uid = getBiteBudUserId()
  const p = profile.value
  submitError.value = ''
  if (!uid || !p) {
    submitError.value = 'Sign in and load your profile first.'
    return
  }
  submitBusy.value = true
  try {
    const body = {
      texturePrefs: p.texturePrefs,
      temperaturePref: p.temperaturePref ?? null,
      dietaryNeeds: p.dietaryNeeds,
      culturalRequirements: p.culturalRequirements,
    }
    await apiFetch('/api/sensory/profile', {
      method: 'POST',
      headers: { 'X-User-Id': uid },
      body: JSON.stringify(body),
    })
    persistSensoryProfileSnapshot(body as Record<string, unknown>)
    await router.push({ name: 'search' })
  } catch (e) {
    submitError.value = e instanceof Error ? e.message : 'Could not save. Try again.'
  } finally {
    submitBusy.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="top-row">
      <a class="link" href="#" @click.prevent="router.push({ name: 'sensorySetup' })">← Back</a>
      <RouterLink to="/sensory/setup" class="link">Edit →</RouterLink>
    </div>

    <div class="title-row">
      <h1 class="h1">📋 Your Profile Summary</h1>
    </div>
    <p class="sub">Review your sensory preferences before you search for recipes.</p>

    <p v-if="profileLoading" class="muted">Loading…</p>
    <div v-else-if="!hasProfile || !profile" class="muted">No profile yet. Please complete setup first.</div>

    <div v-else class="stack">
      <!-- Temperatures -->
      <section class="section-card">
        <div class="section-head">
          <h2 class="h2">Unsafe Temperatures</h2>
          <RouterLink to="/sensory/setup" class="section-edit">Edit</RouterLink>
        </div>
        <p class="summary-line">
          You have chosen {{ temperatures.length }} temperature type{{
            temperatures.length === 1 ? '' : 's'
          }}
          to avoid in recipes.
        </p>
        <div v-if="temperatureCards.length" class="grid grid--blue">
          <div v-for="t in temperatureCards" :key="t.value" class="mini-card mini-card--blue">
            <span class="mini-emoji">{{ t.emoji }}</span>
            <span class="mini-title">{{ t.value }}</span>
            <span class="mini-hint">{{ t.hint }}</span>
          </div>
        </div>
        <p v-else class="empty-note">None selected.</p>
      </section>

      <!-- Textures -->
      <section class="section-card">
        <div class="section-head">
          <h2 class="h2">Unsafe Textures</h2>
          <RouterLink to="/sensory/setup" class="section-edit">Edit</RouterLink>
        </div>
        <p class="summary-line">
          You have chosen {{ unsafeTextures.length }} texture type{{
            unsafeTextures.length === 1 ? '' : 's'
          }}
          marked as unsafe for you.
        </p>
        <div v-if="textureCards.length" class="grid grid--pink">
          <div v-for="t in textureCards" :key="t.label" class="mini-card mini-card--pink">
            <span class="mini-emoji">{{ t.emoji }}</span>
            <span class="mini-title">{{ t.label }}</span>
            <span class="mini-hint">{{ t.hint }}</span>
          </div>
        </div>
        <p v-else class="empty-note">None selected.</p>
      </section>

      <!-- Dietary -->
      <section class="section-card">
        <div class="section-head">
          <h2 class="h2">Dietary &amp; Cultural Restrictions</h2>
          <RouterLink to="/sensory/setup" class="section-edit">Edit</RouterLink>
        </div>
        <p class="summary-line">
          You have chosen {{ dietaryCulturalCount }} dietary or cultural restriction{{
            dietaryCulturalCount === 1 ? '' : 's'
          }}.
        </p>
        <div v-if="dietaryCulturalCards.length" class="grid grid--blue">
          <div v-for="chip in dietaryCulturalCards" :key="chip.label + chip.kind" class="mini-card mini-card--blue">
            <span class="mini-emoji">{{ chip.emoji }}</span>
            <span class="mini-title">{{ chip.label }}</span>
            <span class="mini-hint">{{ chip.hint }}</span>
          </div>
        </div>
        <p v-else class="empty-note">None selected.</p>
      </section>

      <!-- Food safety -->
      <section class="section-card">
        <div class="section-head">
          <h2 class="h2">Food Safety Tags</h2>
          <RouterLink to="/sensory/setup" class="section-edit">Edit</RouterLink>
        </div>
        <p class="summary-line">
          You have tagged {{ foodItems.length }} food{{ foodItems.length === 1 ? '' : 's' }} on your safety list.
        </p>
        <p class="food-lib-note">
          Each tag uses a Wicked ingredient icon from your profile (same library as recipe steps).
        </p>
        <div v-if="foodItems.length" class="food-grid">
          <div v-for="f in foodItems" :key="f.id" class="food-row">
            <div class="food-img-wrap">
              <img
                v-if="resolveWickedImage(f.notes?.wickedIconId)"
                class="food-img"
                :alt="''"
                :src="resolveWickedImage(f.notes?.wickedIconId)!"
                @error="onFoodImageError"
              />
              <span v-else class="food-img-ph" aria-hidden="true">🍽</span>
            </div>
            <div class="food-meta">
              <span class="food-name">{{ f.name }}</span>
              <span class="food-sub">Wicked food icon</span>
            </div>
            <span :class="statusPillClass(f.status)">{{ statusLabel(f.status) }}</span>
          </div>
        </div>
        <p v-else class="empty-note">No foods tagged yet.</p>
      </section>

      <p v-if="submitError" class="err" role="alert">{{ submitError }}</p>

      <div class="footer-actions">
        <RouterLink to="/sensory/setup" class="bb-btn bb-btn--secondary footer-btn">Edit profile</RouterLink>
        <button type="button" class="bb-btn bb-btn--primary footer-btn" :disabled="submitBusy" @click="submitProfile">
          {{ submitBusy ? 'Saving…' : 'Submit' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: 44rem;
  margin: 0 auto;
  padding: 1.5rem 1.25rem 3rem;
  background: #f3f4f2;
  min-height: 100%;
}
.top-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.link {
  color: var(--bb-primary);
  text-decoration: none;
  font-weight: 700;
}
.title-row {
  margin-top: 0.6rem;
}
.h1 {
  margin: 0;
  font-family: var(--bb-font-headline);
  color: var(--bb-primary);
  font-size: 1.45rem;
}
.sub {
  margin: 0.35rem 0 1.25rem;
  color: var(--bb-muted);
  font-size: 0.95rem;
}
.muted {
  color: var(--bb-muted);
}
.stack {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.section-card {
  background: #e8eae6;
  border-radius: 14px;
  padding: 1rem 1rem 1.1rem;
}
.section-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}
.h2 {
  margin: 0;
  font-size: 1.05rem;
  color: var(--bb-primary);
}
.section-edit {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--bb-accent);
  text-decoration: none;
}
.summary-line {
  margin: 0 0 0.75rem;
  font-size: 0.92rem;
  color: var(--bb-muted);
  line-height: 1.45;
}
.food-lib-note {
  margin: 0 0 0.75rem;
  font-size: 0.82rem;
  color: var(--bb-muted);
  line-height: 1.4;
}
.empty-note {
  margin: 0;
  font-size: 0.9rem;
  color: var(--bb-muted);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.65rem;
}
.mini-card {
  border-radius: 12px;
  padding: 0.65rem 0.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.2rem;
  border: 1px solid transparent;
}
.mini-card--blue {
  background: #dbeafe;
  border-color: #93c5fd;
}
.mini-card--pink {
  background: #fce7f3;
  border-color: #f9a8d4;
}
.mini-emoji {
  font-size: 1.35rem;
  line-height: 1;
}
.mini-title {
  font-weight: 800;
  font-size: 0.88rem;
  color: var(--bb-primary);
}
.mini-hint {
  font-size: 0.72rem;
  color: var(--bb-muted);
  line-height: 1.35;
}
.food-grid {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.food-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: #fff;
  border-radius: 12px;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--bb-border);
}
.food-img-wrap {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  background: #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: center;
}
.food-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.food-img-ph {
  font-size: 1.4rem;
  opacity: 0.45;
}
.food-meta {
  flex: 1;
  min-width: 0;
}
.food-name {
  display: block;
  font-weight: 700;
  font-size: 0.95rem;
  color: var(--bb-primary);
}
.food-sub {
  font-size: 0.75rem;
  color: var(--bb-muted);
}
.pill {
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  padding: 0.25rem 0.5rem;
  border-radius: 999px;
}
.pill--safe {
  background: #d1fae5;
  color: #065f46;
}
.pill--unsafe {
  background: #fee2e2;
  color: #991b1b;
}
.pill--sometimes {
  background: #fef3c7;
  color: #92400e;
}
.footer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-top: 0.5rem;
  padding-top: 0.5rem;
}
.footer-btn {
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.err {
  color: #b91c1c;
  font-size: 0.9rem;
  margin: 0;
}
</style>
