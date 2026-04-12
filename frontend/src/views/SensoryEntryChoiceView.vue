<script setup lang="ts">
import { RouterLink, useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <div class="page">
    <div class="top-nav">
      <a class="link" href="#" @click.prevent="router.back()">← Back</a>
      <span class="link-placeholder" />
    </div>

    <h1 class="h1">Sensory profile</h1>
    <p class="sub">Choose how you want to continue.</p>

    <div class="stack">
      <button type="button" class="choice primary" @click="router.push({ name: 'sensoryExisting' })">
        Existing user update sensory profile
      </button>
      <button type="button" class="choice secondary" @click="router.push({ name: 'sensoryNew' })">
        New user create your sensory profile
      </button>
      <RouterLink to="/" class="home-link">← Back to home</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: 520px;
  margin: 0 auto;
  padding: 1.25rem 1.25rem 3rem;
}
.top-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}
.link {
  color: var(--bb-accent);
  text-decoration: none;
  font-weight: 700;
  font-size: 0.95rem;
}
.link-placeholder {
  width: 2rem;
}
.h1 {
  font-size: 2rem;
  margin: 0 0 0.3rem;
}
.sub {
  margin: 0 0 1.5rem;
  color: var(--bb-muted);
}
.stack {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.choice {
  width: 100%;
  text-align: center;
  padding: 1rem 1.1rem;
  border-radius: 12px;
  font-weight: 800;
  font-size: 1rem;
  cursor: pointer;
  border: 2px solid var(--bb-border);
  background: #fff;
  color: var(--bb-text);
  line-height: 1.35;
}
.choice.primary {
  background: #0ea5a4;
  color: #fff;
  border-color: #0ea5a4;
}
.choice.secondary {
  background: #f8fafc;
}
.home-link {
  margin-top: 0.5rem;
  text-align: center;
  color: var(--bb-accent);
  font-weight: 700;
  text-decoration: none;
  font-size: 0.95rem;
}
</style>
