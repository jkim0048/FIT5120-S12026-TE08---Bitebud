<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { apiFetch } from '../lib/api'
import { persistSensoryCode } from '../composables/useSensoryProfile'
import { normalizeBiteBudUserId, setBiteBudUserId } from '../composables/useUserId'

const router = useRouter()
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
      error.value = 'No sensory profile found for this user ID.'
      return
    }
    setBiteBudUserId(id)
    persistSensoryCode(id)
    router.push({ name: 'sensorySetup' })
  } catch {
    error.value = 'Could not load your profile. Check your ID and try again.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="top-nav">
      <a class="link" href="#" @click.prevent="router.back()">← Back</a>
      <span class="link-placeholder" />
    </div>

    <h1 class="h1">Update sensory profile</h1>
    <p class="sub">Enter your user ID to load and edit your saved preferences.</p>

    <section class="card">
      <label class="lbl" for="uid">User ID (3 characters)</label>
      <input
        id="uid"
        :value="rawInput"
        class="input"
        maxlength="3"
        autocapitalize="characters"
        autocomplete="off"
        spellcheck="false"
        placeholder="e.g. A7K"
        @input="onInput"
        @keydown.enter.prevent="onSubmit"
      />
      <p v-if="error" class="err" role="alert">{{ error }}</p>

      <div class="actions-row">
        <button type="button" class="bb-btn bb-btn--secondary" @click="router.push({ name: 'home' })">
          Skip for now
        </button>
        <button type="button" class="btn-primary" :disabled="loading" @click="onSubmit">
          {{ loading ? 'Loading…' : 'Continue' }}
        </button>
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
  padding: 1.25rem 1.25rem 1.1rem;
}
.lbl {
  display: block;
  font-weight: 800;
  color: var(--bb-muted);
  font-size: 0.9rem;
  margin: 0 0 0.35rem;
}
.input {
  width: 100%;
  border: 1px solid var(--bb-border);
  border-radius: 10px;
  padding: 0.75rem 0.9rem;
  font: inherit;
  font-size: 1.35rem;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}
.err {
  color: #b91c1c;
  font-size: 0.9rem;
  margin: 0.65rem 0 0;
  font-weight: 600;
}
.actions-row {
  display: flex;
  justify-content: space-between;
  gap: 0.8rem;
  margin-top: 1.1rem;
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
.btn-primary:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}
</style>
