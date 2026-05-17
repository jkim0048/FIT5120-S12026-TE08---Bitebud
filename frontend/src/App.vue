<script setup lang="ts">
import { computed, ref, watch, watchEffect } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { useSettings } from './composables/useSettings'
import { useSession } from './composables/useSession'
import { useSensoryProfile } from './composables/useSensoryProfile'
import { useGentleToast } from './composables/useGentleToast'
import { fetchMotivationSummary } from './lib/motivationApi'

const { settings } = useSettings()
const route = useRoute()
const router = useRouter()
const { userId, isSignedIn, logout } = useSession()
const { hasProfile } = useSensoryProfile()

const eatDetailsRef = ref<HTMLDetailsElement | null>(null)
const profileDetailsRef = ref<HTMLDetailsElement | null>(null)

function closeNavDropdowns() {
  if (eatDetailsRef.value) eatDetailsRef.value.open = false
  if (profileDetailsRef.value) profileDetailsRef.value.open = false
}

function closeEatDropdownOnly() {
  if (eatDetailsRef.value) eatDetailsRef.value.open = false
}

function closeProfileDropdownOnly() {
  if (profileDetailsRef.value) profileDetailsRef.value.open = false
}

function onEatNavToggle(ev: Event) {
  const el = ev.target as HTMLDetailsElement
  if (el.open) closeProfileDropdownOnly()
}

function onProfileNavToggle(ev: Event) {
  const el = ev.target as HTMLDetailsElement
  if (el.open) closeEatDropdownOnly()
}

const sensoryRoute = computed(() => ({
  name: hasProfile.value ? 'sensorySummary' : 'sensorySetup',
}))
const toast = useGentleToast()

/** e.g. 1 → "1 day streak", 2 → "2nd day streak", 11 → "11th day streak" */
function streakDayPhrase(dayCount: number): string {
  if (!Number.isFinite(dayCount) || dayCount <= 0) return '0 day streak'
  if (dayCount === 1) return '1 day streak'
  const mod100 = dayCount % 100
  let ordinalBody: string
  if (mod100 >= 11 && mod100 <= 13) ordinalBody = `${dayCount}th`
  else {
    switch (dayCount % 10) {
      case 1:
        ordinalBody = `${dayCount}st`
        break
      case 2:
        ordinalBody = `${dayCount}nd`
        break
      case 3:
        ordinalBody = `${dayCount}rd`
        break
      default:
        ordinalBody = `${dayCount}th`
    }
  }
  return `${ordinalBody} day streak`
}

/** Same source as the former home hero streak: Epic 7 `/api/motivation/summary` (not `/api/me/activity`, which is 0 unless you logged today). */
const navMotivationLoaded = ref(false)
const navMotivationHasActivity = ref(false)
const navMotivationStreak = ref(0)

async function loadNavMotivationSummary(): Promise<void> {
  navMotivationLoaded.value = false
  if (!isSignedIn.value || !userId.value) {
    navMotivationHasActivity.value = false
    navMotivationStreak.value = 0
    navMotivationLoaded.value = true
    return
  }
  try {
    const s = await fetchMotivationSummary()
    navMotivationHasActivity.value = s.hasActivity
    navMotivationStreak.value = s.currentStreak
  } catch {
    navMotivationHasActivity.value = false
    navMotivationStreak.value = 0
  } finally {
    navMotivationLoaded.value = true
  }
}

watch(
  () => [isSignedIn.value, userId.value] as const,
  () => {
    void loadNavMotivationSummary()
  },
  { immediate: true },
)

watch(
  () => route.fullPath,
  () => {
    if (isSignedIn.value && userId.value) void loadNavMotivationSummary()
  },
)

const showNavStreakPill = computed(() => {
  if (!isSignedIn.value) return false
  if (settings.value.motivationEnabled === false) return false
  if (!navMotivationLoaded.value) return false
  return navMotivationHasActivity.value
})

const navStreakLabel = computed(() => streakDayPhrase(navMotivationStreak.value))

const navStreakAria = computed(() => `Activity streak: ${navStreakLabel.value}`)

const showInsightsLink = computed(() => {
  if (!isSignedIn.value) return false
  return settings.value.insightsEnabled !== false
})

function onSignOut() {
  logout()
  void router.push({ name: 'home' })
}

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
        <div class="brand-row">
          <RouterLink to="/" class="brand" aria-label="BiteBud home">
            <span class="brand-text">BiteBud</span>
          </RouterLink>
        </div>
        <nav v-if="isSignedIn" class="primary-nav" aria-label="Primary">
          <RouterLink to="/">Home</RouterLink>
          <RouterLink :to="{ name: 'aboutUs' }">Learn more</RouterLink>

          <details ref="eatDetailsRef" class="nav-dropdown" @toggle="onEatNavToggle">
            <summary class="nav-dropdown__summary">Let's eat</summary>
            <div class="nav-dropdown__panel" role="group" aria-label="Let's eat">
              <RouterLink class="nav-dropdown__link" to="/search" @click="closeNavDropdowns">
                Let's start cooking
              </RouterLink>
              <RouterLink class="nav-dropdown__link" to="/restaurants/search" @click="closeNavDropdowns">
                Let's dine out
              </RouterLink>
            </div>
          </details>

          <details ref="profileDetailsRef" class="nav-dropdown" @toggle="onProfileNavToggle">
            <summary class="nav-dropdown__summary">My profile</summary>
            <div class="nav-dropdown__panel" role="group" aria-label="My profile">
              <RouterLink class="nav-dropdown__link" :to="sensoryRoute" @click="closeNavDropdowns">
                Update my food preferences
              </RouterLink>
              <RouterLink class="nav-dropdown__link" to="/progress" @click="closeNavDropdowns">
                See my activity
              </RouterLink>
              <RouterLink
                v-if="showInsightsLink"
                class="nav-dropdown__link"
                to="/insights"
                @click="closeNavDropdowns"
              >
                See my patterns
              </RouterLink>
            </div>
          </details>

          <button v-if="hasProfile" type="button" class="nav-signout" @click="onSignOut">Sign out</button>
          <RouterLink to="/settings">Settings</RouterLink>
          <div class="nav-user-cluster">
            <div class="avatar" :title="`Signed in as ${userId}`" aria-hidden="true">
              <span class="avatar-text">{{ userId }}</span>
            </div>
            <RouterLink
              v-if="showNavStreakPill"
              to="/progress"
              class="nav-streak-pill"
              :aria-label="navStreakAria"
            >
              <span class="nav-streak-pill__icon" aria-hidden="true">&#128293;</span>
              <span class="nav-streak-pill__label">{{ navStreakLabel }}</span>
            </RouterLink>
          </div>
        </nav>
      </div>
    </header>
    <main id="main-content" class="main" tabindex="-1">
      <RouterView />
    </main>

    <div
      class="gentle-toast"
      :class="[{ 'gentle-toast--visible': toast.state.value.visible }, { 'gentle-toast--no-motion': toast.noMotion.value }]"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span class="gentle-toast__glyph" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M7 14c5-1 8-5 9-10 2 6-1 14-7 16-3 1-6 0-8-2 2 0 4-1 6-4Z"
            fill="currentColor"
          />
        </svg>
      </span>
      <span class="gentle-toast__text">{{ toast.state.value.message }}</span>
    </div>
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
  background: var(--bb-surface-highest);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}
.top-inner {
  max-width: var(--bb-content-max, 72rem);
  margin: 0 auto;
  padding: 0.85rem var(--bb-gutter, 1.25rem);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1rem;
}
.brand-row {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-width: 0;
}
.avatar {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 999px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  background: var(--bb-primary);
  color: #fff;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  font-family: var(--bb-font-headline);
}
.avatar--empty {
  background: transparent;
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--bb-border) 80%, transparent);
}
.avatar-text {
  line-height: 1;
}
.avatar-mark {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  padding: 0.15rem;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  text-decoration: none;
  min-width: 44px;
  color: var(--bb-primary);
}
.brand:visited {
  color: var(--bb-primary);
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
  align-items: center;
  gap: 1.15rem;
  flex-wrap: wrap;
}
.primary-nav > a {
  color: var(--bb-text);
  text-decoration: none;
  font-size: 0.95rem;
}
.primary-nav > a.router-link-active {
  color: var(--bb-accent);
  font-weight: 600;
}
.nav-dropdown {
  position: relative;
}
.nav-dropdown__summary {
  list-style: none;
  cursor: pointer;
  color: var(--bb-text);
  font-size: 0.95rem;
  font-weight: 600;
  padding: 0.2rem 0;
}
.nav-dropdown__summary::-webkit-details-marker {
  display: none;
}
.nav-dropdown__summary::after {
  content: ' ▾';
  font-size: 0.72em;
  opacity: 0.75;
}
.nav-dropdown__panel {
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 13.5rem;
  z-index: 60;
  margin-top: 0.35rem;
  padding: 0.35rem;
  border-radius: 12px;
  border: 1px solid var(--bb-border);
  background: var(--bb-surface-highest);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.nav-dropdown__link {
  display: block;
  padding: 0.45rem 0.65rem;
  border-radius: 8px;
  color: var(--bb-text);
  text-decoration: none;
  font-size: 0.92rem;
  font-weight: 600;
}
.nav-dropdown__link:hover {
  background: var(--bb-surface-low);
  color: var(--bb-accent);
}
.nav-dropdown__link.router-link-active {
  color: var(--bb-accent);
  font-weight: 700;
}
.nav-signout {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-size: 0.95rem;
  color: var(--bb-text);
  cursor: pointer;
}
.nav-signout:hover {
  color: var(--bb-accent);
}
.main {
  flex: 1;
  padding: 0 var(--bb-gutter, 1.25rem);
}

@media (min-width: 1600px) {
  .top-inner {
    max-width: 92rem;
  }
}

@media (max-width: 900px) {
  .top-inner {
    flex-wrap: wrap;
    align-items: flex-start;
  }
  .primary-nav {
    width: 100%;
    flex-wrap: nowrap;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    gap: 0.85rem 1rem;
    padding-bottom: 0.25rem;
  }
  .primary-nav > a,
  .nav-dropdown,
  .nav-signout,
  .nav-user-cluster {
    white-space: nowrap;
    flex: 0 0 auto;
  }
  .nav-dropdown__panel {
    left: auto;
    right: 0;
  }
}

.nav-user-cluster {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}
.nav-streak-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem 0.55rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--bb-border) 85%, var(--bb-text) 15%);
  background: color-mix(in srgb, var(--bb-surface-low) 92%, var(--bb-text) 4%);
  text-decoration: none;
  color: var(--bb-text);
  font-size: 0.88rem;
  font-weight: 800;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.nav-streak-pill:hover {
  border-color: color-mix(in srgb, var(--bb-border) 70%, var(--bb-accent) 30%);
  color: var(--bb-accent);
}
.nav-streak-pill__icon {
  font-size: 0.95rem;
  line-height: 1;
}
.nav-streak-pill__label {
  font-weight: 800;
  white-space: nowrap;
}

.gentle-toast {
  position: fixed;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  max-width: min(520px, calc(100vw - 24px));
  padding: 0.65rem 0.75rem;
  border-radius: 14px;
  border: 1px solid var(--bb-border);
  background: color-mix(in srgb, var(--bb-surface-highest) 94%, #22c55e 6%);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.18);
  display: flex;
  gap: 0.5rem;
  align-items: center;
  opacity: 0;
  pointer-events: none;
  transition: opacity 200ms ease;
  z-index: 80;
}
.gentle-toast--visible {
  opacity: 1;
}
.gentle-toast--no-motion {
  transition: none;
}
.gentle-toast__glyph {
  color: #1f7a4a;
  flex: 0 0 auto;
}
.gentle-toast__text {
  color: var(--bb-text);
  font-size: 0.95rem;
  line-height: 1.3;
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
  .primary-nav > a,
  .nav-dropdown__summary {
    font-size: 0.95rem;
    padding: 0.35rem 0;
  }
}
</style>
