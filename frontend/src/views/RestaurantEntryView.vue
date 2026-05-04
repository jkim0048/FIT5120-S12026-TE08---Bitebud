<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()

function toSearch() {
  void router.push({ name: 'restaurantSearch' })
}

function toRatePath() {
  void router.push({ name: 'restaurantSearch', query: { intent: 'rate' } })
}
</script>

<template>
  <section class="page">
    <header class="hero">
      <h1>Help me decide what to eat</h1>
      <p>Choose whether you want to review existing sensory info or rate a place you visited.</p>
    </header>
    <button type="button" class="choice-card" @click="toSearch">
      <strong>Restaurant sensory reviews</strong>
      <span>See reviews on noise, music, light, crowds, and smells.</span>
    </button>
    <button type="button" class="choice-card" @click="toRatePath">
      <strong>Rate a restaurant</strong>
      <span>Record your sensory experience and save useful tags.</span>
    </button>
    <article class="note-card">
      <h2>What this helps with</h2>
      <p>Quickly choose a place that is likely to feel comfortable before you go.</p>
    </article>
  </section>
</template>

<style scoped>
.page { max-width: 26rem; margin: 0 auto; padding: 1rem; display: grid; gap: 0.7rem; }
.hero h1 { margin: 0; color: var(--bb-primary); font-family: var(--bb-font-headline); font-size: 1.55rem; }
.hero p { margin: 0.38rem 0 0; color: var(--bb-muted); font-size: 0.9rem; }
.choice-card {
  border: 2px solid color-mix(in srgb, var(--bb-accent) 35%, var(--bb-border));
  border-radius: 14px;
  background: var(--bb-surface-low);
  padding: 0.85rem;
  text-align: left;
  display: grid;
  gap: 0.3rem;
  cursor: pointer;
}
.choice-card strong { font-size: 0.98rem; color: var(--bb-primary); font-family: var(--bb-font-headline); }
.choice-card span { font-size: 0.85rem; color: var(--bb-muted); }
.note-card { border: 1px solid var(--bb-border); border-radius: 14px; background: var(--bb-surface-low); padding: 0.75rem; }
.note-card h2 { margin: 0; font-size: 0.9rem; color: var(--bb-primary); }
.note-card p { margin: 0.35rem 0 0; color: var(--bb-muted); font-size: 0.84rem; }
</style>
