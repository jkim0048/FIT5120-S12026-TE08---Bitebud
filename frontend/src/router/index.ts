import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import RecipeSearchView from '../views/RecipeSearchView.vue'
import RecipeFlowPage from '../views/RecipeFlowPage.vue'
import GuidedCookView from '../views/GuidedCookView.vue'
import RecipeCompleteView from '../views/RecipeCompleteView.vue'
import SensoryEntryChoiceView from '../views/SensoryEntryChoiceView.vue'
import SensoryNewUserCodeView from '../views/SensoryNewUserCodeView.vue'
import SensoryExistingUserView from '../views/SensoryExistingUserView.vue'
import SensorySetupView from '../views/SensorySetupView.vue'
import SensoryTextureSetupView from '../views/SensoryTextureSetupView.vue'
import SensoryTemperatureSetupView from '../views/SensoryTemperatureSetupView.vue'
import SensoryDietaryCulturalSetupView from '../views/SensoryDietaryCulturalSetupView.vue'
import SensoryFoodSafetySetupView from '../views/SensoryFoodSafetySetupView.vue'
import SensorySummaryCompactView from '../views/SensorySummaryCompactView.vue'
import SensoryMyProfileView from '../views/SensoryMyProfileView.vue'
import SettingsView from '../views/SettingsView.vue'

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior(_to, _from, savedPosition) {
    if (savedPosition) return savedPosition
    return { left: 0, top: 0 }
  },
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/search', name: 'search', component: RecipeSearchView },
    { path: '/recipe/:id', name: 'recipe', component: RecipeFlowPage },
    { path: '/recipe/:id/cook', name: 'guided', component: GuidedCookView },
    { path: '/recipe/:id/complete', name: 'recipeComplete', component: RecipeCompleteView },
    {
      path: '/sensory',
      name: 'sensory',
      component: SensoryEntryChoiceView,
    },
    {
      path: '/sensory/new',
      name: 'sensoryNew',
      component: SensoryNewUserCodeView,
    },
    {
      path: '/sensory/existing',
      name: 'sensoryExisting',
      component: SensoryExistingUserView,
    },
    {
      path: '/sensory/setup',
      name: 'sensorySetup',
      component: SensorySetupView,
    },
    {
      path: '/sensory/setup/texture',
      name: 'sensorySetupTexture',
      component: SensoryTextureSetupView,
    },
    {
      path: '/sensory/setup/temperature',
      name: 'sensorySetupTemperature',
      component: SensoryTemperatureSetupView,
    },
    {
      path: '/sensory/setup/dietary-cultural',
      name: 'sensorySetupDietaryCultural',
      component: SensoryDietaryCulturalSetupView,
    },
    {
      path: '/sensory/setup/food-safety',
      name: 'sensorySetupFoodSafety',
      component: SensoryFoodSafetySetupView,
    },
    {
      path: '/sensory/summary',
      name: 'sensorySummary',
      component: SensorySummaryCompactView,
    },
    {
      path: '/sensory/my-profile',
      name: 'sensoryMyProfile',
      component: SensoryMyProfileView,
    },
    {
      path: '/settings',
      name: 'settings',
      component: SettingsView,
    },
  ],
})
