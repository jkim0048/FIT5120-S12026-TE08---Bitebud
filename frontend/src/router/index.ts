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
import RestaurantEntryView from '../views/RestaurantEntryView.vue'
import RestaurantSearchView from '../views/RestaurantSearchView.vue'
import RestaurantReviewDetailView from '../views/RestaurantReviewDetailView.vue'
import RestaurantRateView from '../views/RestaurantRateView.vue'
import RestaurantBestTimeView from '../views/RestaurantBestTimeView.vue'
import RestaurantSavedConfirmView from '../views/RestaurantSavedConfirmView.vue'
import RestaurantMyReviewsView from '../views/RestaurantMyReviewsView.vue'

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior(_to, _from, savedPosition) {
    if (savedPosition) return savedPosition
    return { left: 0, top: 0 }
  },
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
    { path: '/restaurants', name: 'restaurantEntry', component: RestaurantEntryView },
    { path: '/restaurants/search', name: 'restaurantSearch', component: RestaurantSearchView },
    { path: '/restaurants/my-reviews', name: 'restaurantMyReviews', component: RestaurantMyReviewsView },
    { path: '/restaurants/:id', name: 'restaurantReviewDetail', component: RestaurantReviewDetailView },
    { path: '/restaurants/:id/rate', name: 'restaurantRate', component: RestaurantRateView },
    { path: '/restaurants/:id/best-time', name: 'restaurantBestTime', component: RestaurantBestTimeView },
    { path: '/restaurants/:id/saved', name: 'restaurantSavedConfirm', component: RestaurantSavedConfirmView },
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
