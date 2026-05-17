import { computed, ref } from 'vue'
import { useSettings } from './useSettings'

export type GentleToastTemplate = 'recipe-saved' | 'review-saved' | 'recipe-rated'

export type GentleToastPlacement = 'bottom' | 'center'

type ToastState = {
  visible: boolean
  message: string
  placement: GentleToastPlacement
}

export type ShowPlainOptions = {
  durationMs?: number
  placement?: GentleToastPlacement
}

const state = ref<ToastState>({ visible: false, message: '', placement: 'bottom' })
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
    const ordinalCount = typeof data.n === 'number' ? Math.max(1, Math.floor(data.n)) : 1
    return `Recipe saved. That's your ${ordinal(ordinalCount)} this week.`
  }
  if (template === 'review-saved') {
    return 'Review added — your notes will be there next time.'
  }
  return "Thanks for the rating. It'll show up in your Insights."
}

/** Composable returning a small toast queue used for in-app encouragement messages. */
export function useGentleToast() {
  const { settings } = useSettings()
  const enabled = computed(() => settings.value.motivationEnabled !== false)

  function show(template: GentleToastTemplate, data: Record<string, unknown>) {
    if (!enabled.value) return
    showPlain(templateMessage(template, data), { durationMs: 2000, placement: 'bottom' })
  }

  /** Short confirmation (e.g. preferences saved); always shown, not gated by motivation setting. */
  function showPlain(message: string, options?: number | ShowPlainOptions) {
    const opts: ShowPlainOptions =
      typeof options === 'number' ? { durationMs: options } : (options ?? {})
    const durationMs = opts.durationMs ?? 2000
    const placement = opts.placement ?? 'bottom'
    if (hideTimer) window.clearTimeout(hideTimer)
    state.value = { visible: true, message, placement }
    hideTimer = window.setTimeout(() => {
      state.value = { ...state.value, visible: false }
      hideTimer = null
    }, durationMs)
  }

  function dismiss() {
    if (hideTimer) {
      window.clearTimeout(hideTimer)
      hideTimer = null
    }
    state.value = { ...state.value, visible: false }
  }

  const noMotion = computed(() => prefersReducedMotion())

  return { state, show, showPlain, dismiss, noMotion }
}

