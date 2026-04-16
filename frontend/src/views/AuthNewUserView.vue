<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { generateBiteBudUserId } from '../lib/biteBudUserId'
import { persistMinimalSensoryProfile } from '../lib/persistMinimalSensoryProfile'
import { persistSensoryCode } from '../composables/useSensoryProfile'
import { loginSession, logoutSession } from '../composables/useSession'

const router = useRouter()

const userCode = ref<string>('')
const showModal = ref(false)
const busy = ref(false)
const error = ref('')

onMounted(() => {
  userCode.value = generateBiteBudUserId()
})

function codeChars(): string[] {
  return userCode.value.split('')
}

function goAuth(): void {
  logoutSession()
  void router.push({ name: 'auth' })
}

async function onSkip(): Promise<void> {
  if (busy.value) return
  error.value = ''
  await router.push({ name: 'home' })
}

async function onContinue(): Promise<void> {
  if (!userCode.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    loginSession(userCode.value)
    persistSensoryCode(userCode.value)
    await persistMinimalSensoryProfile(userCode.value)
    showModal.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save. Try again.'
  } finally {
    busy.value = false
  }
}

function closeModal(): void {
  showModal.value = false
}

async function onModalNo(): Promise<void> {
  closeModal()
  await router.push({ name: 'search' })
}

async function onModalYes(): Promise<void> {
  if (busy.value) return
  closeModal()
  await router.push({ name: 'sensorySetup' })
}
</script>

<template>
  <div class="new-user-page">
    <div class="top-bar">
      <button type="button" class="back-btn" @click="goAuth">← Back</button>
    </div>

    <h1 class="h1">Your user ID</h1>
    <p class="lede">Save this code — it identifies your sensory profile.</p>

    <div class="card">
      <div class="code-row" aria-label="Your three letter user code">
        <span v-for="(ch, i) in codeChars()" :key="i" class="code-char">{{ ch }}</span>
      </div>
      <p class="hint">
        Please remember this code as your user ID, and write it down in your diary.
      </p>
      <p v-if="error" class="err" role="alert">{{ error }}</p>
      <div class="actions">
        <button type="button" class="bb-btn bb-btn--secondary btn-skip" :disabled="busy || !userCode" @click="onSkip">
          Skip for now
        </button>
        <button type="button" class="bb-btn bb-btn--primary btn-continue" :disabled="busy || !userCode" @click="onContinue">
          Continue
        </button>
      </div>
    </div>

    <p class="footer-hint">
      Already have an ID?
      <RouterLink to="/auth" class="inline-link">Sign in</RouterLink>
    </p>

    <Teleport to="body">
      <div v-if="showModal" class="modal-root" role="dialog" aria-modal="true" aria-labelledby="new-user-modal-title">
        <div class="modal-backdrop" @click="closeModal" />
        <div class="modal-box">
          <h3 id="new-user-modal-title" class="modal-title">Your User profile has been created.</h3>
          <p class="modal-text">Do you want to set up your sensory profile?</p>
          <div class="modal-actions">
            <button type="button" class="bb-btn bb-btn--secondary" :disabled="busy" @click="onModalNo">No</button>
            <button type="button" class="bb-btn bb-btn--primary" :disabled="busy" @click="onModalYes">Continue</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.new-user-page {
  max-width: 36rem;
  margin: 0 auto;
  padding: 1rem 1.25rem 3rem;
  min-height: 70vh;
}
.top-bar {
  margin-bottom: 0.5rem;
}
.back-btn {
  border: none;
  background: transparent;
  color: var(--bb-primary);
  font-weight: 700;
  font-size: 0.95rem;
  cursor: pointer;
  padding: 0.25rem 0;
  font-family: inherit;
}
.h1 {
  margin: 0.5rem 0 0.35rem;
  font-family: var(--bb-font-headline);
  font-size: 1.75rem;
  color: var(--bb-primary);
}
.lede {
  margin: 0 0 1.25rem;
  color: var(--bb-muted);
  font-size: 0.98rem;
}
.card {
  background: var(--bb-surface-lowest);
  border-radius: 16px;
  padding: 1.75rem 1.25rem;
  box-shadow: 0 12px 32px rgba(26, 28, 25, 0.08);
  border: 1px solid var(--bb-border);
}
.code-row {
  display: flex;
  justify-content: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.code-char {
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  color: var(--bb-text, #1a1c19);
}
.hint {
  margin: 0 0 1rem;
  text-align: center;
  color: var(--bb-muted);
  font-size: 0.92rem;
  line-height: 1.5;
}
.err {
  margin: 0 0 0.75rem;
  color: #b91c1c;
  font-size: 0.9rem;
  text-align: center;
}
.actions {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
  flex-wrap: wrap;
}
.btn-skip {
  flex: 1;
  min-width: 8rem;
  border-radius: 999px;
  font-weight: 800;
  font-family: var(--bb-font-headline);
}
.btn-continue {
  flex: 1.2;
  min-width: 10rem;
  border-radius: 999px;
  font-weight: 800;
  font-family: var(--bb-font-headline);
}
.footer-hint {
  margin-top: 1.5rem;
  text-align: center;
  font-size: 0.9rem;
  color: var(--bb-muted);
}
.inline-link {
  color: var(--bb-accent);
  font-weight: 700;
}

.modal-root {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}
.modal-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
}
.modal-box {
  position: relative;
  background: var(--bb-surface-lowest, #fff);
  border-radius: 16px;
  padding: 1.5rem 1.35rem;
  max-width: 22rem;
  width: 100%;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
}
.modal-title {
  margin: 0 0 0.5rem;
  font-family: var(--bb-font-headline);
  font-size: 1.2rem;
  color: var(--bb-primary);
}
.modal-text {
  margin: 0 0 1.25rem;
  color: var(--bb-muted);
  line-height: 1.5;
}
.modal-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  flex-wrap: wrap;
}
</style>
