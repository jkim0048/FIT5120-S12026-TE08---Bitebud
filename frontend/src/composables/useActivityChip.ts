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

export function useActivityChip() {
  const { userId, isSignedIn } = useSession()

  async function refresh(): Promise<void> {
    if (!isSignedIn.value) {
      activity.value = null
      loadedForUser = null
      return
    }
    const uid = userId.value
    if (!uid) return
    if (loading) return loading
    loading = (async () => {
      try {
        const res = await apiFetch<ActivitySummary>('/api/me/activity', {
          headers: { 'X-User-Id': uid },
        })
        activity.value = res
        loadedForUser = uid
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
    (uid) => {
      if (!uid) return
      if (!isSignedIn.value) return
      if (loadedForUser === uid) return
      void refresh()
    },
  )

  if (isSignedIn.value && loadedForUser !== userId.value) {
    void refresh()
  }

  return { activity, refresh }
}

