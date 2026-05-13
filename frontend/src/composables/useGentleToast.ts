import { computed, ref } from 'vue'
import { useSettings } from './useSettings'

export type GentleToastTemplate = 'recipe-saved' | 'review-saved' | 'recipe-rated'

type ToastState = {
  visible: boolean
  message: string
}

const state = ref<ToastState>({ visible: false, message: '' })
let hideTimer: number | null = null

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
  } catch {
    return false
  }
}

function ordinal(n: number): string {
  if (n === 1) return 'first'
  if (n === 2) return 'second'
  if (n === 3) return 'third'
  return `${n}th`
}

function templateMessage(template: GentleToastTemplate, data: Record<string, unknown>): string {
  if (template === 'recipe-saved') {
    const n = typeof data.n === 'number' ? Math.max(1, Math.floor(data.n)) : 1
    return `Recipe saved. That's your ${ordinal(n)} this week.`
  }
  if (template === 'review-saved') {
    return 'Review added — your notes will be there next time.'
  }
  return "Thanks for the rating. It'll show up in your Insights."
}

export function useGentleToast() {
  const { settings } = useSettings()
  const enabled = computed(() => settings.value.motivationEnabled !== false)

  function show(template: GentleToastTemplate, data: Record<string, unknown>) {
    if (!enabled.value) return
    if (hideTimer) window.clearTimeout(hideTimer)
    state.value = { visible: true, message: templateMessage(template, data) }
    hideTimer = window.setTimeout(() => {
      state.value = { ...state.value, visible: false }
    }, 2000)
  }

  const noMotion = computed(() => prefersReducedMotion())

  return { state, show, noMotion }
}

