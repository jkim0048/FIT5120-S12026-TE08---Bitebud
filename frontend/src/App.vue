<script setup lang="ts">
import { watchEffect } from 'vue'
import { RouterLink, RouterView } from 'vue-router'
import { useSettings } from './composables/useSettings'

const { settings } = useSettings()

watchEffect(() => {
  const html = document.documentElement

  const fontPx = settings.value.textSize === 'small' ? 15 : settings.value.textSize === 'large' ? 18 : 16
  html.style.setProperty('--bb-font-size', `${fontPx}px`)

  html.classList.toggle('bb-dark', settings.value.darkMode)

  const tint =
    settings.value.backgroundTint === 'yellow'
      ? 'rgba(253, 224, 71, 0.18)'
      : settings.value.backgroundTint === 'blue'
        ? 'rgba(59, 130, 246, 0.12)'
        : settings.value.backgroundTint === 'green'
          ? 'rgba(34, 197, 94, 0.12)'
          : settings.value.backgroundTint === 'peach'
            ? 'rgba(251, 146, 60, 0.14)'
            : 'transparent'
  html.style.setProperty('--bb-bg-tint', tint)
})
</script>

<template>
  <div class="app-shell">
    <a href="#main-content" class="skip-link">Skip to content</a>
    <header class="top-bar">
      <div class="top-inner">
        <RouterLink to="/" class="brand" aria-label="BiteBud home">
          <img class="brand-logo" src="/bitebud-mark.png" alt="BiteBud" />
          <span class="brand-text">BiteBud</span>
        </RouterLink>
        <nav class="primary-nav" aria-label="Primary">
          <RouterLink to="/search">Find a recipe</RouterLink>
          <RouterLink to="/sensory">Sensory profile</RouterLink>
          <RouterLink to="/settings">Settings</RouterLink>
        </nav>
      </div>
    </header>
    <main id="main-content" class="main" tabindex="-1">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  position: relative;
}
.top-bar {
  position: sticky;
  top: 0;
  z-index: 50;
  background: color-mix(in srgb, var(--bb-surface) 85%, transparent);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}
.top-inner {
  max-width: 72rem;
  margin: 0 auto;
  padding: 0.85rem 1.25rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1rem;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  text-decoration: none;
  min-width: 44px;
}
.brand-logo {
  height: 34px;
  width: auto;
  display: block;
  object-fit: contain;
}
.brand-text {
  font-family: var(--bb-font-headline);
  font-weight: 900;
  font-size: 1.35rem;
  letter-spacing: -0.02em;
  color: var(--bb-primary);
  line-height: 1;
}
.primary-nav {
  font-family: var(--bb-font-headline);
  display: flex;
  gap: 1.15rem;
  flex-wrap: wrap;
}
.primary-nav a {
  color: var(--bb-text);
  text-decoration: none;
  font-size: 0.95rem;
}
.primary-nav a.router-link-active {
  color: var(--bb-accent);
  font-weight: 600;
}
.main {
  flex: 1;
}

@media (max-width: 640px) {
  .top-inner {
    padding: 0.75rem 1rem;
    flex-wrap: wrap;
    align-items: flex-start;
  }
  .brand {
    flex: 1 1 auto;
  }
  .brand-logo {
    height: 30px;
  }
  .brand-text {
    font-size: 1.2rem;
  }
  .primary-nav {
    width: 100%;
    justify-content: flex-start;
    gap: 0.85rem 1rem;
  }
  .primary-nav a {
    font-size: 0.95rem;
    padding: 0.35rem 0;
  }
}
</style>
