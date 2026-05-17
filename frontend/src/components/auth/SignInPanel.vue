<script setup lang="ts">
import { ref } from 'vue'
import { apiFetch } from '../../lib/api'
import { normalizeBiteBudUserId } from '../../composables/useUserId'

withDefaults(
  defineProps<{
    /** Hide chrome when embedded in another page (e.g. sensory/existing). */
    embedded?: boolean
  }>(),
  { embedded: false },
)

const emit = defineEmits<{
  success: [userId: string]
}>()

const rawInput = ref('')
const error = ref('')
const loading = ref(false)

function onInput(e: Event) {
  const t = (e.target as HTMLInputElement).value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3)
  rawInput.value = t
}

async function onSubmit() {
  error.value = ''
  const id = normalizeBiteBudUserId(rawInput.value)
  if (!id) {
    error.value = 'Enter your 3-character user ID (letters A–Z and numbers).'
    return
  }
  loading.value = true
  try {
    const data = await apiFetch<{ hasProfile: boolean }>('/api/sensory/me', {
      headers: { 'X-User-Id': id },
    })
    if (!data.hasProfile) {
      error.value = 'No food preferences found for this user ID.'
      return
    }
    emit('success', id)
  } catch {
    error.value = 'Could not load your profile. Check your ID and try again.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="sign-in-panel">
    <template v-if="!embedded">
      <p class="brand-line">BiteBud</p>
      <h2 class="title">Sign in to Account</h2>
      <p class="divider">Use your user ID</p>
    </template>

    <label class="lbl" :for="embedded ? 'sensory-uid' : 'auth-uid'">User ID</label>
    <input
      :id="embedded ? 'sensory-uid' : 'auth-uid'"
      :value="rawInput"
      class="input"
      maxlength="3"
      autocapitalize="characters"
      autocomplete="username"
      spellcheck="false"
      placeholder="e.g. A7K"
      @input="onInput"
      @keydown.enter.prevent="onSubmit"
    />
    <p v-if="error" class="err" role="alert">{{ error }}</p>

    <button type="button" class="bb-btn bb-btn--primary btn-signin" :disabled="loading" @click="onSubmit">
      {{ loading ? 'Signing in…' : 'Sign In' }}
    </button>

    <p v-if="!embedded" class="footer-links">Privacy Policy · Terms &amp; Conditions</p>
  </div>
</template>

<style scoped>
.sign-in-panel {
  padding: 1.5rem 1.75rem;
  display: flex;
  flex-direction: column;
  min-height: 100%;
}
.brand-line {
  margin: 0 0 0.5rem;
  font-family: var(--bb-font-headline);
  font-weight: 800;
  font-size: 1.1rem;
  color: var(--bb-primary);
}
.title {
  margin: 0 0 0.75rem;
  font-family: var(--bb-font-headline);
  font-weight: 800;
  font-size: 1.5rem;
  color: var(--bb-primary);
  letter-spacing: -0.02em;
}
.divider {
  margin: 0 0 1rem;
  font-size: 0.8rem;
  color: var(--bb-muted);
  text-align: center;
  position: relative;
}
.divider::before,
.divider::after {
  content: '';
  position: absolute;
  top: 50%;
  width: 28%;
  height: 1px;
  background: var(--bb-border);
}
.divider::before {
  left: 0;
}
.divider::after {
  right: 0;
}
.lbl {
  display: block;
  font-weight: 700;
  font-size: 0.8rem;
  color: var(--bb-muted);
  margin-bottom: 0.35rem;
}
.input {
  width: 100%;
  border: 1px solid color-mix(in srgb, var(--bb-primary) 28%, var(--bb-border));
  border-radius: 10px;
  padding: 0.75rem 0.9rem;
  font: inherit;
  font-size: 1.35rem;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  background: var(--bb-surface-low);
  color: var(--bb-text);
}
.err {
  color: var(--bb-error);
  font-size: 0.85rem;
  margin: 0.5rem 0 0;
  font-weight: 600;
}
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 1rem;
  font-size: 0.8rem;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.remember {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--bb-muted);
  cursor: default;
}
.muted {
  color: var(--bb-muted);
  opacity: 0.85;
}
.btn-signin {
  margin-top: 1.25rem;
  width: 100%;
  padding: 0.85rem 1rem;
  border-radius: 999px;
  font-weight: 800;
  font-size: 1rem;
  font-family: var(--bb-font-headline);
}
.footer-links {
  margin-top: auto;
  padding-top: 1.5rem;
  text-align: center;
  font-size: 0.72rem;
  color: var(--bb-muted);
}
</style>
