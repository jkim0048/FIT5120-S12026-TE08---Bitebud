<script setup lang="ts">
import { RouterLink, useRouter } from 'vue-router'

const router = useRouter()

function goCook(): void {
  void router.push({ name: 'search' })
}

function goDine(): void {
  void router.push({ name: 'restaurantSearch' })
}
</script>

<template>
  <main class="page">
    <header class="head">
      <h1 class="h1">How would you like to eat today?</h1>
      <p class="lede">
        Cook at home with guided recipes, or find somewhere sensory-friendly to dine out — switch whenever you like.
      </p>
    </header>

    <div class="choices" role="group" aria-label="Cook at home or dine out">
      <button type="button" class="choice bb-btn bb-btn--primary" @click="goCook">Let's start cooking</button>
      <button type="button" class="choice choice--secondary bb-btn bb-btn--secondary" @click="goDine">
        Let's dine out
      </button>
    </div>

    <RouterLink class="sensory-link" :to="{ name: 'sensorySetup' }">Update sensory profile</RouterLink>

    <p class="footer-nav">
      <RouterLink to="/" class="muted-link">Back to home</RouterLink>
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
  cursor: pointer;
}
.choice--secondary {
  border-width: 2px;
}
.sensory-link {
  margin-top: 1.5rem;
  text-align: center;
  font-weight: 700;
  font-size: 0.95rem;
  color: var(--bb-accent);
  text-decoration: none;
}
.sensory-link:hover {
  text-decoration: underline;
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
