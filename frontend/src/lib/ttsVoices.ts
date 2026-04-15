import { readonly, shallowRef } from 'vue'

const availableVoices = shallowRef<SpeechSynthesisVoice[]>([])
let initialized = false

function loadVoices() {
  if (typeof window === 'undefined' || typeof speechSynthesis === 'undefined') {
    availableVoices.value = []
    return
  }
  availableVoices.value = speechSynthesis.getVoices()
}

/** Preload voices once at app startup so TTS is ready before guided cooking. */
export function initTtsVoicesPreload() {
  if (initialized) return
  initialized = true
  if (typeof window === 'undefined' || typeof speechSynthesis === 'undefined') return

  loadVoices()
  speechSynthesis.addEventListener('voiceschanged', loadVoices)

  // Some browsers populate voices asynchronously after first tick.
  if (!availableVoices.value.length) {
    window.setTimeout(loadVoices, 0)
    window.setTimeout(loadVoices, 250)
  }
}

export function useTtsVoices() {
  return readonly(availableVoices)
}

export function findTtsVoiceByName(name: string): SpeechSynthesisVoice | null {
  return availableVoices.value.find((v) => v.name === name) ?? null
}
