<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watchEffect } from 'vue'
import { RouterLink, RouterView, useRouter } from 'vue-router'
import { useSettings } from './composables/useSettings'
import { useSession } from './composables/useSession'
import { useSensoryProfile } from './composables/useSensoryProfile'

const { settings } = useSettings()
const router = useRouter()
const { userId, isSignedIn, logout } = useSession()
const { hasProfile } = useSensoryProfile()
const restaurantMenuOpen = ref(false)
const restaurantDropdownEl = ref<HTMLElement | null>(null)
let restaurantMenuCloseTimer: ReturnType<typeof setTimeout> | undefined

function onSignOut() {
  logout()
  void router.push({ name: 'home' })
}

function toggleRestaurantMenu() {
  restaurantMenuOpen.value = !restaurantMenuOpen.value
}

function closeRestaurantMenu() {
  restaurantMenuOpen.value = false
  // Prevent `:focus-within` from keeping the menu visible.
  const el = restaurantDropdownEl.value
  const active = document.activeElement as HTMLElement | null
  if (el && active && el.contains(active)) active.blur()
}

function openRestaurantMenu() {
  if (restaurantMenuCloseTimer) {
    clearTimeout(restaurantMenuCloseTimer)
    restaurantMenuCloseTimer = undefined
  }
  restaurantMenuOpen.value = true
}

function scheduleCloseRestaurantMenu() {
  if (restaurantMenuCloseTimer) clearTimeout(restaurantMenuCloseTimer)
  restaurantMenuCloseTimer = setTimeout(() => {
    restaurantMenuCloseTimer = undefined
    closeRestaurantMenu()
  }, 140)
}

function onDocumentPointerDown(e: PointerEvent) {
  if (!restaurantMenuOpen.value) return
  const el = restaurantDropdownEl.value
  if (!el) return
  const target = e.target as Node | null
  if (target && el.contains(target)) return
  closeRestaurantMenu()
}

const stopAfterEach = router.afterEach(() => {
  closeRestaurantMenu()
})

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  stopAfterEach()
  if (restaurantMenuCloseTimer) clearTimeout(restaurantMenuCloseTimer)
})

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
        <nav class="primary-nav" aria-label="Primary">
          <RouterLink to="/">Home</RouterLink>
          <RouterLink to="/search">Let's Start Cooking</RouterLink>
          <div
            class="nav-dropdown"
            :class="{ 'nav-dropdown--open': restaurantMenuOpen }"
            ref="restaurantDropdownEl"
            @mouseenter="openRestaurantMenu"
            @mouseleave="scheduleCloseRestaurantMenu"
          >
            <button
              type="button"
              class="nav-dropdown-btn"
              :aria-expanded="restaurantMenuOpen"
              aria-haspopup="menu"
              @click="toggleRestaurantMenu"
              @keydown.escape="closeRestaurantMenu"
            >
              <span class="nav-dropdown-label">Let's dine out</span>
              <span class="nav-dropdown-caret" aria-hidden="true">▾</span>
            </button>
            <div class="nav-dropdown-menu" role="menu" @click="closeRestaurantMenu">
              <RouterLink role="menuitem" to="/restaurants/search" @click="closeRestaurantMenu">Find a sensory restaurant</RouterLink>
              <RouterLink role="menuitem" to="/restaurants/my-reviews" @click="closeRestaurantMenu">My reviews</RouterLink>
            </div>
          </div>
          <RouterLink v-if="isSignedIn" to="/sensory/setup">Customise sensory profile</RouterLink>
          <RouterLink v-else to="/auth">Customise sensory profile</RouterLink>
          <button v-if="isSignedIn && hasProfile" type="button" class="nav-signout" @click="onSignOut">Sign out</button>
          <RouterLink to="/settings">Settings</RouterLink>
          <div
            class="avatar"
            :class="{ 'avatar--empty': !isSignedIn }"
            :title="isSignedIn ? `Signed in as ${userId}` : 'Not signed in'"
            aria-hidden="true"
          >
            <span v-if="isSignedIn" class="avatar-text">{{ userId }}</span>
            <img
              v-else
              class="avatar-mark"
              src="/bitebud-mark.png"
              alt=""
              aria-hidden="true"
            />
          </div>
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
  background: var(--bb-surface-highest);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
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
.nav-dropdown {
  position: relative;
}
.nav-dropdown-btn {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-size: 0.95rem;
  color: var(--bb-text);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.nav-dropdown-btn:hover {
  color: var(--bb-accent);
}

.nav-dropdown-caret {
  font-size: 0.8em;
  color: color-mix(in srgb, var(--bb-text) 70%, transparent);
  transform: translateY(1px);
  transition: transform 140ms ease, color 140ms ease;
}
.nav-dropdown-btn:hover .nav-dropdown-caret,
.nav-dropdown--open .nav-dropdown-caret {
  color: var(--bb-accent);
  transform: translateY(1px) rotate(180deg);
}
.nav-dropdown-menu {
  display: none;
  position: absolute;
  top: calc(100% + 0.5rem);
  left: 0;
  min-width: 14rem;
  padding: 0.4rem;
  border-radius: 12px;
  border: 1px solid var(--bb-border);
  background: var(--bb-surface-highest);
  box-shadow: 0 10px 30px color-mix(in srgb, #101828 18%, transparent);
  z-index: 60;
}
.nav-dropdown-menu::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: -0.6rem;
  height: 0.6rem;
}
.nav-dropdown:focus-within .nav-dropdown-menu,
.nav-dropdown--open .nav-dropdown-menu {
  display: grid;
  gap: 0.25rem;
}
.nav-dropdown-menu a {
  padding: 0.45rem 0.6rem;
  border-radius: 10px;
  color: var(--bb-text);
  text-decoration: none;
  font-size: 0.95rem;
}
.nav-dropdown-menu a:hover {
  background: color-mix(in srgb, var(--bb-primary) 10%, transparent);
  color: var(--bb-primary);
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
