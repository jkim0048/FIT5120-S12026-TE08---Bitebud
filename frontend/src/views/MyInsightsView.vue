<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { getBiteBudUserId } from '../composables/useUserId'
import { fetchMotivationInsights, type MotivationInsightsPayload } from '../lib/motivationApi'

const router = useRouter()
const loading = ref(true)
const err = ref('')
const data = ref<MotivationInsightsPayload | null>(null)

onMounted(async () => {
  const uid = getBiteBudUserId()
  if (!uid) {
    void router.replace({ name: 'auth', query: { redirect: '/insights' } })
    return
  }
  try {
    data.value = await fetchMotivationInsights()
  } catch (e) {
    err.value = e instanceof Error ? e.message : 'Could not load insights'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <main class="page">
    <header class="head">
      <h1 class="h1">My Insights</h1>
      <p class="lead">Patterns we noticed about you.</p>
    </header>

    <p v-if="loading && !data" class="hint">Loading…</p>
    <p v-else-if="err" class="err">{{ err }}</p>

    <template v-else-if="data">
      <template v-if="!data.ok">
        <section class="threshold panel-soft">
          <p class="panel-copy">
            When you have a little more history in BiteBud—at least 6 supported actions in total, including 3 finished recipes
            and 3 saved restaurant reviews—this page will show two gentle insight cards.
          </p>
          <p class="hint hint--dark">
            So far: {{ data.recordsAnalyzed.total }} total ({{ data.recordsAnalyzed.recipes }} recipes,
            {{ data.recordsAnalyzed.reviews }} reviews).
          </p>
        </section>
      </template>

      <template v-else>
        <div class="summary-banner" role="status">
          <span class="summary-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7zm2.85 11.1l-.85.6V16h-4v-2.3l-.85-.6A4.997 4.997 0 017 9c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.63-.8 3.16-2.15 4.1z"
              />
            </svg>
          </span>
          <p class="summary-text">
            You have logged <strong>{{ data.recordsAnalyzed.total }}</strong> experiences. Here is what we noticed.
          </p>
        </div>

        <section v-if="data.cookingCard" class="pattern-block">
          <h2 class="pattern-head">Cooking patterns</h2>
          <article class="insight-card">
            <div class="insight-icon" aria-hidden="true">
              <svg class="ico" viewBox="0 0 24 24" width="26" height="26">
                <path
                  fill="currentColor"
                  d="M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61l1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42A8.962 8.962 0 0012 4c-4.97 0-9 4.03-9 9s4.02 9 9 9c4.97 0 9-4.03 9-9 0-2.74-1.23-5.18-3.17-6.83zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"
                />
              </svg>
            </div>
            <div class="insight-main">
              <h3 class="insight-title">{{ data.cookingCard.title }}</h3>
              <p class="insight-body">{{ data.cookingCard.body }}</p>
              <span class="data-chip">{{ data.recordsAnalyzed.recipes }} recipes analysed.</span>
            </div>
          </article>
        </section>

        <section v-if="data.diningCard" class="pattern-block">
          <h2 class="pattern-head">Dining patterns</h2>
          <article class="insight-card">
            <div class="insight-icon insight-icon--stroke" aria-hidden="true">
              <svg class="ico" viewBox="0 0 24 24" width="26" height="26" fill="none">
                <path
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"
                />
              </svg>
            </div>
            <div class="insight-main">
              <h3 class="insight-title">{{ data.diningCard.title }}</h3>
              <p class="insight-body">{{ data.diningCard.body }}</p>
              <span class="data-chip">{{ data.recordsAnalyzed.reviews }} restaurants analysed.</span>
            </div>
          </article>
        </section>

        <p class="foot-note"><em>Insights update as you log more experiences.</em></p>
      </template>
    </template>

    <p class="back">
      <RouterLink to="/">Back to home</RouterLink>
    </p>
  </main>
</template>

<style scoped>
.page {
  --in-bg: #f9f7f2;
  --in-teal: #66999b;
  --in-text: #4a5568;
  --in-banner: #dbeafe;
  --in-banner-text: #334155;
  --in-icon-bg: #bfdbfe;
  --in-chip: #e0f2fe;
  --in-chip-text: #0369a1;
  --in-border: rgba(74, 85, 104, 0.14);

  max-width: 26rem;
  margin: 0 auto;
  padding: 1.25rem 1rem 2.5rem;
  background: var(--in-bg);
  min-height: 100vh;
  box-sizing: border-box;
}

.head {
  margin-bottom: 1.15rem;
}

.h1 {
  margin: 0 0 0.35rem;
  font-family: var(--bb-font-headline, system-ui, sans-serif);
  font-size: clamp(1.6rem, 4.5vw, 2rem);
  font-weight: 800;
  color: var(--in-teal);
  letter-spacing: -0.02em;
}

.lead {
  margin: 0;
  color: var(--in-text);
  font-weight: 500;
  font-size: 0.95rem;
  opacity: 0.92;
}

.hint {
  margin: 0 0 0.75rem;
  color: var(--in-text);
  font-size: 0.88rem;
  opacity: 0.85;
}

.hint--dark {
  opacity: 1;
}

.err {
  color: #b42318;
}

.threshold {
  border-radius: 16px;
  padding: 1rem 1.05rem;
  margin-bottom: 1rem;
}

.panel-soft {
  background: color-mix(in srgb, var(--in-teal) 10%, white);
  border: 1px solid var(--in-border);
}

.panel-copy {
  margin: 0 0 0.65rem;
  line-height: 1.55;
  color: var(--in-text);
  font-size: 0.92rem;
}

.summary-banner {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  padding: 0.85rem 1rem;
  margin-bottom: 1.35rem;
  border-radius: 14px;
  background: var(--in-banner);
  color: var(--in-banner-text);
}

.summary-icon {
  flex-shrink: 0;
  margin-top: 0.1rem;
  color: #0284c7;
  opacity: 0.95;
}

.summary-text {
  margin: 0;
  font-size: 0.92rem;
  line-height: 1.45;
}

.summary-text strong {
  font-weight: 800;
}

.pattern-block {
  margin-bottom: 1.35rem;
}

.pattern-head {
  margin: 0 0 0.55rem;
  font-size: 1rem;
  font-weight: 800;
  color: var(--in-teal);
}

.insight-card {
  display: flex;
  gap: 0.85rem;
  align-items: flex-start;
  padding: 1rem 1rem 1.05rem;
  border-radius: 16px;
  border: 1px solid var(--in-border);
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.insight-icon {
  flex-shrink: 0;
  width: 3rem;
  height: 3rem;
  border-radius: 12px;
  background: var(--in-icon-bg);
  color: #0369a1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.insight-icon--stroke {
  color: #0369a1;
}

.ico {
  display: block;
}

.insight-main {
  min-width: 0;
  flex: 1;
}

.insight-title {
  margin: 0 0 0.4rem;
  font-size: 1rem;
  font-weight: 800;
  color: var(--in-text);
}

.insight-body {
  margin: 0 0 0.65rem;
  font-size: 0.9rem;
  line-height: 1.55;
  color: var(--in-text);
}

.data-chip {
  display: inline-block;
  padding: 0.28rem 0.65rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  background: var(--in-chip);
  color: var(--in-chip-text);
}

.foot-note {
  margin: 1.5rem 0 0;
  text-align: center;
  font-size: 0.82rem;
  color: var(--in-text);
  opacity: 0.72;
}

.back {
  margin-top: 1.25rem;
}

.back a {
  color: var(--in-teal);
  font-weight: 600;
  text-decoration: none;
}

.back a:hover {
  text-decoration: underline;
}
</style>
