<script setup lang="ts">
import { RouterLink, useRoute, useRouter } from 'vue-router'
import SignInPanel from '../components/auth/SignInPanel.vue'
import { persistSensoryCode } from '../composables/useSensoryProfile'
import { useSession } from '../composables/useSession'
import { safePostAuthRedirect } from '../lib/authRedirect'

const router = useRouter()
const route = useRoute()
const { login } = useSession()

function onSignInSuccess(id: string) {
  login(id)
  persistSensoryCode(id)
  const dest = safePostAuthRedirect(route.query.redirect, '/start')
  void router.push(dest)
}

function goSignUp() {
  void router.push({ name: 'authNewUser' })
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-back">
      <RouterLink to="/" class="back-link">← Back to home</RouterLink>
    </div>

    <div class="auth-card">
      <div class="auth-brand" aria-hidden="true">
        <img class="auth-mark" src="/bitebud-mark.png" alt="" />
      </div>
      <h1 class="account-title">Account</h1>
      <p class="account-lede">Sign in with your BiteBud user ID.</p>

      <SignInPanel embedded class="auth-panel" @success="onSignInSuccess" />

      <div class="create-row">
        <span class="create-label">New here?</span>
        <button type="button" class="bb-btn bb-btn--secondary create-btn" @click="goSignUp">Create Sensory Profile</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  max-width: 26rem;
  margin: 0 auto;
  padding: 1rem 1.25rem 3rem;
  min-height: 70vh;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}
.auth-back {
  width: 100%;
  margin-bottom: 1rem;
}
.back-link {
  color: var(--bb-accent);
  font-weight: 700;
  text-decoration: none;
  font-size: 0.95rem;
}
.auth-card {
  width: 100%;
  border-radius: 24px;
  padding: 2rem 1.5rem 1.75rem;
  box-shadow: 0 24px 48px rgba(26, 28, 25, 0.12);
  background: var(--bb-surface-lowest);
  border: 1px solid var(--bb-border);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.auth-brand {
  margin-bottom: 0.75rem;
}
.auth-mark {
  width: 52px;
  height: 52px;
  object-fit: contain;
  display: block;
  margin: 0 auto;
}
.account-title {
  margin: 0 0 0.35rem;
  font-family: var(--bb-font-headline);
  font-weight: 800;
  font-size: 1.65rem;
  letter-spacing: -0.02em;
  color: var(--bb-primary);
}
.account-lede {
  margin: 0 0 1.25rem;
  font-size: 0.95rem;
  color: var(--bb-muted);
  line-height: 1.5;
  max-width: 18rem;
}
.auth-panel {
  width: 100%;
  align-self: stretch;
  padding-left: 0;
  padding-right: 0;
}
.create-row {
  margin: 0.9rem 0 0;
  font-size: 0.92rem;
  color: var(--bb-muted);
  display: grid;
  justify-items: stretch;
  gap: 0.35rem;
  width: 100%;
  align-self: stretch;
}
.create-label {
  display: block;
  text-align: center;
}
.create-btn {
  border-radius: 999px;
  padding: 0.85rem 1rem;
  font-weight: 800;
  font-family: var(--bb-font-headline);
  font-size: 1rem;
  width: 100%;
  justify-content: center;
}
</style>
