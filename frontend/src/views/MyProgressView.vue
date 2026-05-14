<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { getBiteBudUserId } from '../composables/useUserId'
import { fetchMotivationProgress, type MotivationProgressPayload } from '../lib/motivationApi'
import InsightsActivityRangeSection from '../components/InsightsActivityRangeSection.vue'

const router = useRouter()
const route = useRoute()
const loading = ref(true)
const err = ref('')
const data = ref<MotivationProgressPayload | null>(null)

const MIN = 3

const showUnlockHint = computed(() => (data.value?.eligibleTotal ?? 0) < MIN)

async function loadProgress() {
  const uid = getBiteBudUserId()
  if (!uid) {
    void router.replace({ name: 'auth', query: { redirect: '/progress' } })
    return
  }
  const firstLoad = !data.value
  if (firstLoad) loading.value = true
  err.value = ''
  try {
    data.value = await fetchMotivationProgress()
  } catch (e) {
    err.value = e instanceof Error ? e.message : 'Could not load progress'
  } finally {
    if (firstLoad) loading.value = false
  }
}

function scrollToRangeActivity() {
  if (route.hash !== '#range-activity') return
  void nextTick(() => {
    document.getElementById('range-activity')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

onMounted(() => {
  void loadProgress()
  scrollToRangeActivity()
})

watch(() => route.hash, scrollToRangeActivity)
</script>

<template>
  <main class="page">
    <header class="head">
      <h1 class="h1">My Progress</h1>
    </header>

    <p v-if="loading && !data" class="hint">Loading…</p>
    <p v-else-if="err" class="err">{{ err }}</p>

    <section id="range-activity" class="range-activity" tabindex="-1">
      <h2 class="h2-range">Activity in a range</h2>
      <p class="range-lead">
        Your rhythm reflects overall streaks.  
      </p>

      <template v-if="data">
        <p v-if="showUnlockHint" class="unlock-hint">
          Log a few more cooking or dining moments to unlock richer insights elsewhere. You have
          {{ data.eligibleTotal }} recorded (we suggest at least {{ MIN }}).
        </p>

        <h3 class="h3-rhythm">Your rhythm</h3>
        <div class="rhythm rhythm--in-range">
          <div class="rhythm-card">
            <span class="rhythm-num">{{ data.currentStreak }}</span>
            <span class="rhythm-label">Current streak</span>
          </div>
          <div class="rhythm-card">
            <span class="rhythm-num">{{ data.longestStreak }}</span>
            <span class="rhythm-label">Best run so far</span>
          </div>
          <div class="rhythm-card">
            <span class="rhythm-num">{{ data.totalActiveDays }}</span>
            <span class="rhythm-label">Total active days</span>
          </div>
        </div>
      </template>

      <InsightsActivityRangeSection />
    </section>

    <p class="back">
      <RouterLink to="/">Back to home</RouterLink>
    </p>
  </main>
</template>

<style scoped>
.page {
  --mp-bg: #f9f7f2;
  --mp-teal: #66999b;
  --mp-text: #4a5568;
  --mp-card: #e2e8f0;
  --mp-border: rgba(74, 85, 104, 0.18);

  max-width: min(72rem, 100%);
  margin: 0 auto;
  padding: 1.25rem 1rem 2.5rem;
  background: var(--mp-bg);
  min-height: 100vh;
  box-sizing: border-box;
}

.head {
  margin-bottom: 1.25rem;
}

.h1 {
  margin: 0;
  font-family: var(--bb-font-headline, system-ui, sans-serif);
  font-size: clamp(1.6rem, 4.5vw, 2rem);
  font-weight: 800;
  color: var(--mp-teal);
  letter-spacing: -0.02em;
}

.hint {
  margin: 0 0 0.75rem;
  color: var(--mp-text);
  font-size: 0.88rem;
  opacity: 0.8;
}

.err {
  color: #b42318;
  margin: 0 0 1rem;
}

.unlock-hint {
  margin: 0 0 1rem;
  padding: 0.75rem 0.9rem;
  border-radius: 14px;
  background: color-mix(in srgb, var(--mp-teal) 12%, white);
  color: var(--mp-text);
  font-size: 0.88rem;
  line-height: 1.45;
}

.range-activity {
  color: var(--bb-text, var(--mp-text));
}

.h2-range {
  margin: 0 0 0.5rem;
  font-size: 1.05rem;
  font-weight: 800;
  font-family: var(--bb-font-headline, system-ui, sans-serif);
  color: var(--mp-teal);
}

.range-lead {
  margin: 0 0 1.25rem;
  font-size: 0.88rem;
  line-height: 1.45;
  color: var(--mp-text);
  opacity: 0.9;
  max-width: 40rem;
}

.h3-rhythm {
  margin: 0 0 0.65rem;
  font-size: 1rem;
  font-weight: 700;
  color: var(--mp-text);
}

.rhythm {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
}

.rhythm--in-range {
  margin-bottom: 1.5rem;
  max-width: 42rem;
}

.rhythm-card {
  background: var(--mp-card);
  border-radius: 16px;
  padding: 0.9rem 0.5rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
}

.rhythm-num {
  font-size: 1.65rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--mp-text);
  line-height: 1.1;
}

.rhythm-label {
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--mp-text);
  opacity: 0.85;
  line-height: 1.25;
}

.back {
  margin-top: 1.5rem;
}

.back a {
  color: var(--mp-teal);
  font-weight: 600;
  text-decoration: none;
}

.back a:hover {
  text-decoration: underline;
}

@media (max-width: 520px) {
  .rhythm {
    grid-template-columns: 1fr;
  }
}
</style>
