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
      <p class="account-lede">
        Start by setting up your food preferences, or sign in below if you already have a BiteBud user ID.
      </p>

      <button type="button" class="bb-btn bb-btn--secondary setup-btn" @click="goSignUp">
        Set up food preferences
      </button>

      <div class="sign-in-section" aria-labelledby="sign-in-heading">
        <p id="sign-in-heading" class="sign-in-label">Already have a user ID?</p>
        <SignInPanel embedded class="auth-panel" @success="onSignInSuccess" />
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
.setup-btn {
  margin-top: 0.25rem;
  border-radius: 999px;
  padding: 1rem 1.25rem;
  font-weight: 800;
  font-family: var(--bb-font-headline);
  font-size: 1.05rem;
  width: 100%;
  justify-content: center;
}
.sign-in-section {
  margin-top: 1.35rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--bb-border);
  width: 100%;
  align-self: stretch;
  display: grid;
  gap: 0.65rem;
  justify-items: stretch;
}
.sign-in-label {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--bb-muted);
  text-align: center;
}
</style>
