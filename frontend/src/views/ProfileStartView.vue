<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useSensoryProfile } from '../composables/useSensoryProfile'
import { useSettings } from '../composables/useSettings'

const { hasProfile } = useSensoryProfile()
const { settings } = useSettings()

const showInsightsLink = computed(() => settings.value.insightsEnabled !== false)

const sensoryRoute = computed(() => ({
  name: hasProfile.value ? 'sensorySummary' : 'sensorySetup',
}))
</script>

<template>
  <main class="page">
    <header class="head">
      <h1 class="h1">My profile</h1>
      <p class="lede">Update your food preferences, see your activity, or explore your patterns.</p>
    </header>

    <div class="choices" role="group" aria-label="Profile actions">
      <RouterLink class="choice bb-btn bb-btn--primary" :to="sensoryRoute">Update my food preferences</RouterLink>
      <RouterLink class="choice choice--secondary bb-btn bb-btn--secondary" :to="{ name: 'myProgress' }">
        See my activity
      </RouterLink>
      <RouterLink
        v-if="showInsightsLink"
        class="choice choice--secondary bb-btn bb-btn--secondary"
        :to="{ name: 'myInsights' }"
      >
        See my patterns
      </RouterLink>
    </div>

    <p class="footer-nav">
      <RouterLink :to="{ name: 'cookingStart' }" class="muted-link">Back to start</RouterLink>
    </p>
  </main>
</template>

<style scoped>
.page {
  max-width: 28rem;
  margin: 0 auto;
  padding: 2rem 1.25rem 3rem;
  min-height: 60vh;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}
.head {
  text-align: center;
  margin-bottom: 2rem;
}
.h1 {
  margin: 0 0 0.65rem;
  font-family: var(--bb-font-headline);
  font-weight: 800;
  font-size: clamp(1.55rem, 4vw, 2rem);
  letter-spacing: -0.03em;
  color: var(--bb-primary);
}
.lede {
  margin: 0;
  color: var(--bb-muted);
  font-size: 1rem;
  line-height: 1.55;
}
.choices {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.choice {
  width: 100%;
  justify-content: center;
  text-align: center;
  padding: 1rem 1.25rem;
  border-radius: 16px;
  font-family: var(--bb-font-headline);
  font-weight: 700;
  font-size: 1.05rem;
  text-decoration: none;
}
.choice--secondary {
  border-width: 2px;
}
.footer-nav {
  margin-top: auto;
  padding-top: 2rem;
  text-align: center;
}
.muted-link {
  color: var(--bb-muted);
  font-weight: 600;
  text-decoration: none;
  font-size: 0.92rem;
}
.muted-link:hover {
  color: var(--bb-accent);
  text-decoration: underline;
}
</style>
