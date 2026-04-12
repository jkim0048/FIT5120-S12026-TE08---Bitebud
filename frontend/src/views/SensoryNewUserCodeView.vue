<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { generateBiteBudUserId } from '../lib/biteBudUserId'
import { persistSensoryCode } from '../composables/useSensoryProfile'
import { setBiteBudUserId } from '../composables/useUserId'

const router = useRouter()
const generatedCode = ref('')

onMounted(() => {
  generatedCode.value = generateBiteBudUserId()
})

function onContinue() {
  setBiteBudUserId(generatedCode.value)
  persistSensoryCode(generatedCode.value)
  router.push({ name: 'sensorySetup' })
}

function onSkip() {
  router.push({ name: 'home' })
}
</script>

<template>
  <div class="page">
    <div class="top-nav">
      <a class="link" href="#" @click.prevent="router.back()">← Back</a>
      <span class="link-placeholder" />
    </div>

    <h1 class="h1">Your user ID</h1>
    <p class="sub">Save this code — it identifies your sensory profile.</p>

    <section class="card">
      <div class="code-display" aria-live="polite">{{ generatedCode }}</div>
      <p class="reminder">
        Please remember this Code as your user ID. And write it down into your dairy
      </p>

      <div class="actions-row">
        <button type="button" class="bb-btn bb-btn--secondary" @click="onSkip">Skip for now</button>
        <button type="button" class="btn-primary" @click="onContinue">Continue</button>
      </div>
    </section>
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
  margin: 0 0 1.25rem;
  color: var(--bb-muted);
}
.card {
  background: #fff;
  border: 1px solid var(--bb-border);
  border-radius: 14px;
  padding: 1.35rem 1.35rem 1.15rem;
}
.code-display {
  font-size: 3.25rem;
  font-weight: 900;
  letter-spacing: 0.35em;
  text-align: center;
  margin: 0.5rem 0 1.25rem;
  font-variant-numeric: tabular-nums;
  color: var(--bb-text);
}
.reminder {
  margin: 0 0 1.35rem;
  color: var(--bb-muted);
  font-size: 1.02rem;
  line-height: 1.45;
  text-align: center;
}
.actions-row {
  display: flex;
  justify-content: space-between;
  gap: 0.8rem;
  flex-wrap: wrap;
}
.btn-primary {
  border: none;
  background: #0ea5a4;
  color: #fff;
  font-weight: 900;
  border-radius: 10px;
  padding: 0.7rem 1.1rem;
  cursor: pointer;
  flex: 1;
  min-width: 8rem;
}
</style>
