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
      <div class="choice-block">
        <RouterLink class="choice choice--secondary bb-btn bb-btn--secondary" :to="{ name: 'myProgress' }">
          See my activity
        </RouterLink>
        <p class="choice-hint">
          Discover your food activity.
        </p>
      </div>

      <div v-if="showInsightsLink" class="choice-block">
        <RouterLink class="choice choice--profile bb-btn" :to="{ name: 'myInsights' }">
          See my patterns
        </RouterLink>
        <p class="choice-hint">
          Discover what tends to work best for you when cooking at home or dining out.
        </p>
      </div>
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
  gap: 1.1rem;
}
.choice-block {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.choice-hint {
  margin: 0;
  padding: 0 0.35rem;
  font-size: 0.88rem;
  line-height: 1.5;
  color: var(--bb-muted);
  text-align: center;
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
.choice--profile {
  background: #b89ac8;
  border: 2px solid transparent;
  color: #fff;
}
.choice--profile:hover {
  background: #9f7bb3;
  border-color: transparent;
  color: #fff;
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
