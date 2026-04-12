<script setup lang="ts">
import { useRouter } from 'vue-router'
import { TEXTURE_OPTIONS, TEXTURE_OPTION_PRESENTATION, useSensorySetupForm } from '../composables/useSensorySetupForm'

const router = useRouter()
const { selectedUnsafeTextures, toggleUnsafeTexture, profileLoading, saveAndViewSummary, saveProfileOnly } =
  useSensorySetupForm()

async function onSaveAndNext() {
  await saveProfileOnly()
  router.push({ name: 'sensorySetupTemperature' })
}

function ariaLabelForTexture(label: string) {
  const p = TEXTURE_OPTION_PRESENTATION[label as keyof typeof TEXTURE_OPTION_PRESENTATION]
  return p ? `${label}. ${p.hint}. Mark as unsafe if this texture is not OK for you.` : label
}
</script>

<template>
  <div class="page">
    <div class="top-nav">
      <a class="link" href="#" @click.prevent="router.push({ name: 'sensorySetup' })">← Back</a>
      <button type="button" class="link link-btn" :disabled="profileLoading" @click="saveAndViewSummary">View Summary →</button>
    </div>
    <h1 class="h1">Unsafe Textures</h1>
    <p class="sub">Select textures that are not safe for you.</p>

    <section class="card">
      <div class="choice-grid" role="group" aria-label="Texture options">
        <button
          v-for="t in TEXTURE_OPTIONS"
          :key="t"
          type="button"
          class="choice-card"
          :class="{ 'choice-card--on': selectedUnsafeTextures.includes(t) }"
          :aria-pressed="selectedUnsafeTextures.includes(t)"
          :aria-label="ariaLabelForTexture(t)"
          @click="toggleUnsafeTexture(t)"
        >
          <span class="choice-emoji" aria-hidden="true">{{ TEXTURE_OPTION_PRESENTATION[t].emoji }}</span>
          <span class="choice-label">{{ t }}</span>
          <span class="choice-hint">{{ TEXTURE_OPTION_PRESENTATION[t].hint }}</span>
        </button>
      </div>
    </section>

    <div class="footer">
      <button type="button" class="bb-btn bb-btn--secondary" @click="router.push({ name: 'sensorySetup' })">Back</button>
      <button type="button" class="btn-primary" @click="onSaveAndNext">Save and Next</button>
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
.h1 {
  margin: 0 0 0.3rem;
  color: var(--bb-primary);
  font-size: 2rem;
}
.sub {
  color: var(--bb-muted);
  margin: 0 0 1rem;
}
.card {
  background: var(--bb-surface-low);
  border-radius: 16px;
  padding: 1rem;
}
.choice-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.85rem;
}
.choice-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.35rem;
  min-height: 5.5rem;
  padding: 0.65rem 0.5rem;
  border-radius: 14px;
  border: 2px solid transparent;
  background: var(--bb-surface-lowest);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
}
.choice-emoji {
  font-size: 1.65rem;
  line-height: 1;
}
.choice-label {
  font-size: 0.95rem;
  font-weight: 800;
  color: var(--bb-primary, inherit);
}
.choice-hint {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--bb-muted);
  line-height: 1.25;
  max-width: 100%;
}
.choice-card--on {
  background: color-mix(in srgb, var(--bb-error) 14%, var(--bb-surface-lowest));
  border-color: color-mix(in srgb, var(--bb-error) 45%, transparent);
}
@media (prefers-reduced-motion: no-preference) {
  .choice-card:hover,
  .choice-card:focus-visible {
    transform: scale(1.02);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
  }
  .choice-card--on {
    animation: choice-pulse 2.4s ease-in-out infinite;
  }
}
@media (prefers-reduced-motion: reduce) {
  .choice-card:hover,
  .choice-card:focus-visible {
    outline: 2px solid var(--bb-primary);
    outline-offset: 2px;
  }
}
@keyframes choice-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--bb-error) 35%, transparent);
  }
  50% {
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--bb-error) 0%, transparent);
  }
}
.choice-card:focus-visible {
  outline: none;
}
.footer {
  display: flex;
  justify-content: space-between;
  margin-top: 1rem;
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
</style>
