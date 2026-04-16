<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  getSiteAccessPassword,
  isSitePasswordConfigured,
  safeUnlockRedirect,
  setSiteUnlocked,
} from '../lib/siteUnlock'

const route = useRoute()
const router = useRouter()

const password = ref('')
const showPassword = ref(false)
const busy = ref(false)
const formError = ref('')

const configured = computed(() => isSitePasswordConfigured())

function onSubmit(): void {
  formError.value = ''
  if (!configured.value) {
    formError.value =
      'Site access password is not configured. Set VITE_SITE_ACCESS_PASSWORD in frontend/.env.'
    return
  }
  const expected = getSiteAccessPassword()
  if (password.value.trim() !== expected) {
    formError.value = 'Incorrect access code. Try again.'
    return
  }
  busy.value = true
  try {
    setSiteUnlocked()
    const dest = safeUnlockRedirect(route.query.redirect)
    void router.replace(dest)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="unlock-page">
    <div class="unlock-card">
      <p class="brand">BiteBud</p>
      <h1 class="h1">Enter access code</h1>
      <p class="sub">This preview is password protected.</p>

      <form class="form" @submit.prevent="onSubmit">
        <label class="lbl" for="unlock-pass">Password</label>
        <input
          id="unlock-pass"
          v-model="password"
          class="input"
          :type="showPassword ? 'text' : 'password'"
          autocomplete="current-password"
          placeholder="Enter access code"
          :disabled="!configured"
        />
        <label class="check">
          <input v-model="showPassword" type="checkbox" />
          Show password
        </label>
        <p v-if="!configured" class="warn" role="alert">
          Site access password is not configured. Set VITE_SITE_ACCESS_PASSWORD in frontend/.env.
        </p>
        <p v-else-if="formError" class="err" role="alert">{{ formError }}</p>
        <button type="submit" class="bb-btn bb-btn--primary unlock-btn" :disabled="busy || !configured">
          {{ busy ? 'Unlocking…' : 'Unlock BiteBud' }}
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.unlock-page {
  min-height: calc(100vh - 6rem);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem 1rem 3rem;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--bb-bg) 92%, #fde68a) 0%,
    color-mix(in srgb, var(--bb-bg) 88%, #fdba74) 100%
  );
}
.unlock-card {
  width: 100%;
  max-width: 22rem;
  background: var(--bb-surface-lowest);
  border-radius: 24px;
  padding: 1.75rem 1.5rem 1.6rem;
  box-shadow: 0 24px 48px rgba(26, 28, 25, 0.12);
  border: 1px solid var(--bb-border);
}
.brand {
  margin: 0 0 0.5rem;
  font-family: var(--bb-font-headline);
  font-weight: 800;
  font-size: 1.15rem;
  color: var(--bb-primary);
}
.h1 {
  margin: 0 0 0.35rem;
  font-family: var(--bb-font-headline);
  font-size: 1.45rem;
  color: var(--bb-text);
}
.sub {
  margin: 0 0 1.25rem;
  color: var(--bb-muted);
  font-size: 0.92rem;
  line-height: 1.45;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.lbl {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--bb-muted);
}
.input {
  border: 1px solid color-mix(in srgb, var(--bb-primary) 35%, var(--bb-border));
  border-radius: 10px;
  padding: 0.65rem 0.8rem;
  font: inherit;
  background: var(--bb-surface-low);
  color: var(--bb-text);
}
.input:disabled {
  opacity: 0.65;
}
.check {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.88rem;
  color: var(--bb-text);
  margin-top: 0.15rem;
}
.err,
.warn {
  margin: 0.25rem 0 0;
  font-size: 0.88rem;
  font-weight: 600;
}
.err {
  color: var(--bb-error);
}
.warn {
  color: var(--bb-muted);
}
.unlock-btn {
  margin-top: 0.75rem;
  width: 100%;
  padding: 0.65rem 1rem;
}
</style>
