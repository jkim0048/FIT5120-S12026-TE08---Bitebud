import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import RecipeSearchView from '../views/RecipeSearchView.vue'
import RecipeFlowPage from '../views/RecipeFlowPage.vue'
import GuidedCookView from '../views/GuidedCookView.vue'
import RecipeCompleteView from '../views/RecipeCompleteView.vue'
import { getBiteBudUserId } from '../composables/useUserId'
import SensorySetupView from '../views/SensorySetupView.vue'
import SensorySummaryCompactView from '../views/SensorySummaryCompactView.vue'
import SettingsView from '../views/SettingsView.vue'
import AuthView from '../views/AuthView.vue'
import AuthNewUserView from '../views/AuthNewUserView.vue'
import UnlockView from '../views/UnlockView.vue'
import { isSiteUnlocked, safeUnlockRedirect } from '../lib/siteUnlock'

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/unlock', name: 'unlock', component: UnlockView },
    { path: '/', name: 'home', component: HomeView },
    { path: '/auth', name: 'auth', component: AuthView },
    { path: '/auth/new-user', name: 'authNewUser', component: AuthNewUserView },
    { path: '/search', name: 'search', component: RecipeSearchView },
    { path: '/recipe/:id', name: 'recipe', component: RecipeFlowPage },
    { path: '/recipe/:id/cook', name: 'guided', component: GuidedCookView },
    { path: '/recipe/:id/complete', name: 'recipeComplete', component: RecipeCompleteView },
    {
      path: '/sensory',
      name: 'sensory',
      redirect: () => (getBiteBudUserId() ? { name: 'sensorySetup' } : { name: 'auth' }),
    },
    {
      path: '/sensory/setup',
      name: 'sensorySetup',
      component: SensorySetupView,
    },
    {
      path: '/sensory/summary',
      name: 'sensorySummary',
      component: SensorySummaryCompactView,
    },
    {
      path: '/settings',
      name: 'settings',
      component: SettingsView,
    },
  ],
})

router.beforeEach((to) => {
  if (to.name === 'unlock') {
    if (isSiteUnlocked()) {
      const dest = safeUnlockRedirect(to.query.redirect)
      return { path: dest, replace: true }
    }
    return true
  }
  if (!isSiteUnlocked()) {
    return { name: 'unlock', query: { redirect: to.fullPath } }
  }
  return true
})
