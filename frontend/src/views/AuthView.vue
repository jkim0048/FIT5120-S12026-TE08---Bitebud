<script setup lang="ts">
import { RouterLink, useRouter } from 'vue-router'
import SignInPanel from '../components/auth/SignInPanel.vue'
import { persistSensoryCode } from '../composables/useSensoryProfile'
import { useSession } from '../composables/useSession'

const router = useRouter()
const { login } = useSession()

function onSignInSuccess(id: string) {
  login(id)
  persistSensoryCode(id)
  router.push({ name: 'home' })
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
      <div class="auth-col auth-col--signin">
        <SignInPanel @success="onSignInSuccess" />
      </div>
      <div class="auth-col auth-col--signup">
        <div class="signup-inner">
          <h2 class="hello">Hello, Friend!</h2>
          <p class="signup-copy">Fill up information and start journey with us</p>
          <button type="button" class="btn-outline" @click="goSignUp">Sign Up</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  max-width: 56rem;
  margin: 0 auto;
  padding: 1rem 1.25rem 3rem;
  min-height: 70vh;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.auth-back {
  width: 100%;
  max-width: 56rem;
  margin-bottom: 1rem;
}
.back-link {
  color: var(--bb-accent);
  font-weight: 700;
  text-decoration: none;
  font-size: 0.95rem;
}
.auth-card {
  display: grid;
  grid-template-columns: 1fr 1fr;
  width: 100%;
  max-width: 52rem;
  min-height: 420px;
  border-radius: 24px;
  overflow: hidden;
  box-shadow: 0 24px 48px rgba(26, 28, 25, 0.12);
  background: var(--bb-surface-lowest);
  border: 1px solid var(--bb-border);
}
.auth-col--signin {
  background: var(--bb-surface-lowest);
}
.auth-col--signup {
  background: linear-gradient(
    155deg,
    color-mix(in srgb, var(--bb-primary) 92%, #0f172a) 0%,
    var(--bb-primary) 42%,
    var(--bb-primary-container) 100%
  );
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem 1.5rem;
}
.signup-inner {
  text-align: center;
  max-width: 16rem;
}
.hello {
  margin: 0 0 0.75rem;
  font-family: var(--bb-font-headline);
  font-weight: 800;
  font-size: 1.75rem;
  letter-spacing: -0.02em;
}
.signup-copy {
  margin: 0 0 1.5rem;
  line-height: 1.55;
  font-size: 0.95rem;
  opacity: 0.95;
}
.btn-outline {
  display: inline-block;
  padding: 0.75rem 0.5rem;
  min-width: 11rem;
  border: 2px solid #fff;
  border-radius: 999px;
  background: transparent;
  color: #fff;
  font-weight: 800;
  font-size: 1rem;
  font-family: var(--bb-font-headline);
}
.btn-outline:hover {
  background: rgba(255, 255, 255, 0.12);
}

@media (max-width: 720px) {
  .auth-card {
    grid-template-columns: 1fr;
  }
  .auth-col--signup {
    order: -1;
    min-height: 200px;
  }
}
</style>
