import { ref, watch } from 'vue'
import { apiFetch } from '../lib/api'
import { useSession } from './useSession'

export type ActivitySummary = {
  dayStreak: number
  activitiesThisMonth: number
  hasAny: boolean
}

const activity = ref<ActivitySummary | null>(null)
let loadedForUser: string | null = null
let loading: Promise<void> | null = null

/** Composable that lazily loads the activity-chip summary (streak + month total) for the active user. */
export function useActivityChip() {
  const { userId, isSignedIn } = useSession()

  async function refresh(): Promise<void> {
    if (!isSignedIn.value) {
      activity.value = null
      loadedForUser = null
      return
    }
    const currentUserId = userId.value
    if (!currentUserId) return
    if (loading) return loading
    loading = (async () => {
      try {
        const response = await apiFetch<ActivitySummary>('/api/me/activity', {
          headers: { 'X-User-Id': currentUserId },
        })
        activity.value = response
        loadedForUser = currentUserId
      } finally {
        loading = null
      }
    })()
    return loading
  }

  watch(
    () => isSignedIn.value,
    (signedIn) => {
      if (!signedIn) {
        activity.value = null
        loadedForUser = null
      }
    },
  )

  watch(
    () => userId.value,
    (currentUserId) => {
      if (!currentUserId) return
      if (!isSignedIn.value) return
      if (loadedForUser === currentUserId) return
      void refresh()
    },
  )

  if (isSignedIn.value && loadedForUser !== userId.value) {
    void refresh()
  }

  return { activity, refresh }
}

