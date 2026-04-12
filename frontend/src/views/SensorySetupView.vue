<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { getBiteBudUserId } from '../composables/useUserId'
import { useSensorySetupForm } from '../composables/useSensorySetupForm'

const router = useRouter()
const { profileLoading, saveError, saveAndViewSummary, textureDone, temperatureDone, dietaryDone, foodSafetyDone } =
  useSensorySetupForm()

onMounted(() => {
  if (!getBiteBudUserId()) router.replace({ name: 'sensory' })
})
</script>

<template>
  <div class="page">
    <div class="top-nav">
      <a class="link" href="#" @click.prevent="router.push({ name: 'sensory' })">← Back</a>
      <button type="button" class="link link-btn" :disabled="profileLoading" @click="saveAndViewSummary">View Summary →</button>
    </div>

    <h1 class="h1">Set up your Sensory Profile</h1>
    <p class="sub">
      Tell us about your food preferences so we can filter recipes for you. You can update this any time.
    </p>

    <section class="content">
      <div class="cards">
        <button type="button" class="card nav-card" @click="router.push({ name: 'sensorySetupTexture' })">
          <div class="nav-icon" aria-hidden="true">🧤</div>
          <div class="nav-copy">
            <h2 class="card-h2">Unsafe Textures</h2>
            <p class="card-sub">Choose textures that are not safe for you.</p>
          </div>
          <div class="nav-status" :class="{ done: textureDone }">{{ textureDone ? '✓' : '○' }}</div>
        </button>

        <button type="button" class="card nav-card" @click="router.push({ name: 'sensorySetupTemperature' })">
          <div class="nav-icon" aria-hidden="true">🌡️</div>
          <div class="nav-copy">
            <h2 class="card-h2">Unsafe Temperatures</h2>
            <p class="card-sub">Select temperatures to avoid in recipes.</p>
          </div>
          <div class="nav-status" :class="{ done: temperatureDone }">{{ temperatureDone ? '✓' : '○' }}</div>
        </button>

        <button type="button" class="card nav-card" @click="router.push({ name: 'sensorySetupDietaryCultural' })">
          <div class="nav-icon" aria-hidden="true">🧾</div>
          <div class="nav-copy">
            <h2 class="card-h2">Dietary &amp; Cultural Restrictions</h2>
            <p class="card-sub">Mark restrictions that should be treated as unsafe.</p>
          </div>
          <div class="nav-status" :class="{ done: dietaryDone }">{{ dietaryDone ? '✓' : '○' }}</div>
        </button>

        <button type="button" class="card nav-card" @click="router.push({ name: 'sensorySetupFoodSafety' })">
          <div class="nav-icon" aria-hidden="true">⚠️</div>
          <div class="nav-copy">
            <h2 class="card-h2">Food Safety Tags</h2>
            <p class="card-sub">Add foods and tag each one as safe, unsafe, or sometimes.</p>
          </div>
          <div class="nav-status" :class="{ done: foodSafetyDone }">{{ foodSafetyDone ? '✓' : '○' }}</div>
        </button>
      </div>

      <p v-if="saveError" class="save-err" role="alert">{{ saveError }}</p>

      <!-- Footer buttons -->
      <div class="footer">
        <button type="button" class="bb-btn bb-btn--secondary" @click="router.push({ name: 'home' })">Skip for now</button>
        <button type="button" class="btn-primary btn-primary--footer" :disabled="profileLoading" @click="saveAndViewSummary">
          Save &amp; View Profile
        </button>
      </div>
    </section>

  </div>
</template>

<style scoped>
.page {
  max-width: 72rem;
  margin: 0 auto;
  padding: 1.5rem 1.25rem 3.5rem;
}
.top-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}
.link {
  color: var(--bb-primary);
  text-decoration: none;
  font-weight: 700;
  font-size: 0.95rem;
}
.link-btn {
  border: none;
  background: transparent;
  cursor: pointer;
}
.link-placeholder {
  width: 2rem;
}

.h1 {
  font-family: var(--bb-font-headline);
  font-weight: 800;
  letter-spacing: -0.02em;
  font-size: 2.15rem;
  margin: 0 0 0.3rem;
  color: var(--bb-primary);
}
.sub {
  margin: 0 0 1.2rem;
  color: var(--bb-muted);
  max-width: 50rem;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}
.cards {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.card {
  background: var(--bb-surface-low);
  border-radius: 16px;
  padding: 1.15rem 1.25rem;
  box-shadow: 0 12px 32px rgba(26, 28, 25, 0.04);
}
.card-h2 {
  margin: 0;
  font-family: var(--bb-font-headline);
  font-size: 1.1rem;
  letter-spacing: -0.01em;
}
.card-sub {
  margin: 0.35rem 0 1rem;
  color: var(--bb-muted);
  font-size: 0.92rem;
  line-height: 1.4;
}
.nav-card {
  width: 100%;
  border: 1px solid transparent;
  text-align: left;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 0.9rem;
  align-items: center;
  cursor: pointer;
}
.nav-icon {
  font-size: 1.5rem;
  line-height: 1;
}
.nav-copy .card-sub {
  margin: 0.15rem 0 0;
}
.nav-status {
  font-size: 1.25rem;
  color: var(--bb-muted);
  font-weight: 900;
}
.nav-status.done {
  color: #166534;
}
.card--texture,
.card--temp,
.card--diet,
.card--safe {
  background: var(--bb-surface-low);
}

.save-err {
  margin: 0.5rem 0 0;
  color: #b91c1c;
  font-weight: 600;
  font-size: 0.92rem;
}

.footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
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
.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn-primary--footer {
  min-width: 260px;
}

@media (max-width: 720px) {
  .btn-primary--footer {
    min-width: 0;
    width: 100%;
  }
  .footer {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>

