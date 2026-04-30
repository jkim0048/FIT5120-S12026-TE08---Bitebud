import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { router } from './router'
import { apiUrl } from './lib/api'
import { SENSORY_PROFILE_SNAPSHOT_KEY } from './lib/sensorySnapshot'
import { getBiteBudUserId } from './composables/useUserId'
import { logoutSession } from './composables/useSession'
import { initTtsVoicesPreload } from './lib/ttsVoices'

/** Flush last profile snapshot on tab/window close, then clear client session. */
function registerUnloadProfileFlush(): void {
  window.addEventListener('pagehide', (e: PageTransitionEvent) => {
    if (e.persisted) return
    const uid = getBiteBudUserId()
    if (!uid) return
    let body = '{}'
    try {
      const snap = sessionStorage.getItem(SENSORY_PROFILE_SNAPSHOT_KEY)
      if (snap) body = snap
    } catch {
      /* ignore */
    }
    try {
      void fetch(apiUrl('/api/sensory/profile'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': uid },
        body,
        keepalive: true,
      })
    } catch {
      /* ignore */
    }
    logoutSession()
  })
}

registerUnloadProfileFlush()
initTtsVoicesPreload()

createApp(App).use(router).mount('#app')
