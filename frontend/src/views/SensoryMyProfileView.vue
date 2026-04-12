<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useSensoryProfile } from '../composables/useSensoryProfile'

const router = useRouter()
const { profile, loading: profileLoading, hasProfile } = useSensoryProfile()

const TEXTURE_SAFE_PREFIX = 'safe:'
const TEXTURE_UNSURE_PREFIX = 'sometimes:'
const TEXTURE_UNSAFE_PREFIX = 'unsafe:'

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr))
}

function decodeTexturePrefs(prefs: string[] | null | undefined): {
  safe: string[]
  sometimes: string[]
  unsafe: string[]
} {
  const safe: string[] = []
  const sometimes: string[] = []
  const unsafe: string[] = []
  for (const raw of prefs ?? []) {
    if (typeof raw !== 'string') continue
    if (raw.startsWith(TEXTURE_SAFE_PREFIX)) safe.push(raw.slice(TEXTURE_SAFE_PREFIX.length))
    else if (raw.startsWith(TEXTURE_UNSURE_PREFIX)) sometimes.push(raw.slice(TEXTURE_UNSURE_PREFIX.length))
    else if (raw.startsWith(TEXTURE_UNSAFE_PREFIX)) unsafe.push(raw.slice(TEXTURE_UNSAFE_PREFIX.length))
    else safe.push(raw)
  }
  return { safe: uniq(safe), sometimes: uniq(sometimes), unsafe: uniq(unsafe) }
}

const decoded = computed(() => decodeTexturePrefs(profile.value?.texturePrefs ?? []))

const safeFoods = computed(() => (profile.value?.foodItems ?? []).filter((f) => f.status === 'SAFE'))
const unsafeFoods = computed(() => (profile.value?.foodItems ?? []).filter((f) => f.status === 'UNSAFE'))
const sometimesFoods = computed(() => (profile.value?.foodItems ?? []).filter((f) => f.status === 'UNSURE'))

const dietaryChips = computed(() => profile.value?.dietaryNeeds ?? [])
</script>

<template>
  <div class="page">
    <div class="top-row">
      <a class="link" href="#" @click.prevent="router.back()">← Back</a>
      <div class="title">My Sensory Profile</div>
      <RouterLink v-if="hasProfile" to="/sensory/summary" class="done-link">Done</RouterLink>
      <button v-else type="button" class="done-btn" @click="router.push({ name: 'sensory' })">Done</button>
    </div>

    <div class="content">
      <p v-if="profileLoading" class="muted">Loading…</p>
      <div v-else-if="!hasProfile" class="muted">
        No profile yet. <RouterLink to="/sensory" class="inline-link">Create one</RouterLink>.
      </div>

      <div v-else class="grid">
        <section class="card">
          <div class="card-h">🧤 Texture Preferences</div>
          <div class="chip-wrap">
            <span v-for="t in decoded.safe" :key="'s:' + t" class="mini-pill mini-pill--safe">{{ t }}</span>
            <span v-if="decoded.safe.length === 0" class="muted">—</span>
          </div>
        </section>

        <section class="card">
          <div class="card-h">🌡️ Temperature</div>
          <div class="chip-wrap">
            <span
              v-for="t in (profile?.temperaturePref ?? '').split(',').map((x) => x.trim()).filter(Boolean)"
              :key="'t:' + t"
              class="mini-chip"
            >
              {{ t }}
            </span>
            <span v-if="!(profile?.temperaturePref ?? '').includes(',') && !profile?.temperaturePref" class="muted">—</span>
          </div>
        </section>

        <section class="card card-safe">
          <div class="card-h">
            ✅ Safe Foods ({{ safeFoods.length }})
          </div>
          <div class="list">
            <div v-for="f in safeFoods" :key="f.id" class="list-row">
              <span class="list-icon">🍽️</span>
              <span class="list-name">{{ f.name }}</span>
            </div>
            <div v-if="safeFoods.length === 0" class="muted">—</div>
          </div>
        </section>

        <section class="card card-unsafe">
          <div class="card-h">
            ❌ Unsafe Foods ({{ unsafeFoods.length }})
          </div>
          <div class="list">
            <div v-for="f in unsafeFoods" :key="f.id" class="list-row">
              <span class="list-icon">🍽️</span>
              <span class="list-name">{{ f.name }}</span>
            </div>
            <div v-if="unsafeFoods.length === 0" class="muted">—</div>
          </div>
        </section>

        <section class="card card-sometimes">
          <div class="card-h">
            🍋 Sometimes Foods ({{ sometimesFoods.length }})
          </div>
          <div class="list">
            <div v-for="f in sometimesFoods" :key="f.id" class="list-row">
              <span class="list-icon">🍽️</span>
              <span class="list-name">{{ f.name }}</span>
            </div>
            <div v-if="sometimesFoods.length === 0" class="muted">—</div>
          </div>
        </section>

        <section class="card card-diet">
          <div class="card-h">🧾 Dietary Restrictions</div>
          <div class="chip-wrap">
            <span v-for="d in dietaryChips" :key="'d:' + d" class="mini-diet-chip">{{ d }}</span>
            <span v-if="dietaryChips.length === 0" class="muted">—</span>
          </div>
        </section>
      </div>

      <div class="actions">
        <RouterLink to="/sensory/setup" class="bb-btn bb-btn--secondary">Edit</RouterLink>
        <button type="button" class="btn-primary" @click="router.push({ name: 'home' })">Done</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: 72rem;
  margin: 0 auto;
  padding: 1.5rem 1.25rem 3.5rem;
}
.top-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}
.title {
  font-family: var(--bb-font-headline);
  font-size: 1.6rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--bb-primary);
}
.link {
  color: var(--bb-primary);
  text-decoration: none;
  font-weight: 900;
}
.done-link {
  text-decoration: none;
  font-weight: 950;
  color: #fff;
  background: var(--bb-cta-gradient);
  padding: 0.65rem 1rem;
  border-radius: 10px;
}
.done-btn {
  border: none;
  background: var(--bb-cta-gradient);
  color: #fff;
  font-weight: 950;
  border-radius: 10px;
  padding: 0.65rem 1rem;
  cursor: pointer;
}
.muted {
  color: var(--bb-muted);
}
.inline-link {
  color: var(--bb-primary);
  font-weight: 900;
  text-decoration: none;
}
.content {
  background: transparent;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}
.card {
  background: var(--bb-surface-low);
  border-radius: 16px;
  padding: 1rem 1.05rem;
  box-shadow: 0 12px 32px rgba(26, 28, 25, 0.04);
}
.card-h {
  font-family: var(--bb-font-headline);
  font-weight: 800;
  margin-bottom: 0.75rem;
}
.chip-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.mini-pill {
  padding: 0.35rem 0.6rem;
  border-radius: 999px;
  font-weight: 900;
  font-size: 0.9rem;
  background: color-mix(in srgb, var(--bb-secondary-container) 70%, var(--bb-surface-lowest));
  color: var(--bb-on-secondary-container);
}
.mini-chip {
  padding: 0.4rem 0.65rem;
  border-radius: 12px;
  font-weight: 950;
  background: color-mix(in srgb, var(--bb-primary) 12%, var(--bb-surface-lowest));
}
.mini-diet-chip {
  padding: 0.35rem 0.6rem;
  border-radius: 999px;
  font-weight: 900;
  font-size: 0.9rem;
  background: var(--bb-surface-lowest);
}
.list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.list-row {
  border-radius: 10px;
  padding: 0.45rem 0.6rem;
  border: 1px solid transparent;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--bb-surface-lowest);
}
.list-icon {
  width: 26px;
  display: inline-flex;
  justify-content: center;
}
.list-name {
  font-weight: 900;
}
.card-safe {
  background: var(--bb-surface-low);
}
.card-unsafe {
  background: var(--bb-surface-low);
}
.card-sometimes {
  background: var(--bb-surface-low);
}
.card-diet {
  background: var(--bb-surface-low);
}
.actions {
  margin-top: 1.25rem;
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}
.btn-primary {
  border: none;
  background: var(--bb-cta-gradient);
  color: #fff;
  font-weight: 950;
  border-radius: 10px;
  padding: 0.7rem 1.1rem;
  cursor: pointer;
}
</style>

