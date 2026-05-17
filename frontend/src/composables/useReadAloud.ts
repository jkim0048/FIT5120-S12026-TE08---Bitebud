import { ref } from 'vue'
import { findTtsVoiceByName } from '../lib/ttsVoices'

const isSpeaking = ref(false)

export function speechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && typeof speechSynthesis !== 'undefined'
}

/** Stop any in-progress read-aloud (safe to call from route changes and unmount). */
export function stopReadAloud(): void {
  if (!speechSynthesisSupported()) {
    isSpeaking.value = false
    return
  }
  speechSynthesis.cancel()
  isSpeaking.value = false
}

export type ReadAloudOptions = {
  volume: number
  rate: number
  voice: string
}

/** Speak `text` with the given TTS settings; replaces any current utterance. */
export function speakReadAloud(text: string, options: ReadAloudOptions): void {
  const trimmed = text.trim()
  if (!trimmed || !speechSynthesisSupported()) return

  stopReadAloud()

  const utterance = new SpeechSynthesisUtterance(trimmed)
  utterance.volume = options.volume
  utterance.rate = options.rate
  const match = findTtsVoiceByName(options.voice)
  if (match) utterance.voice = match

  const finish = () => {
    isSpeaking.value = false
  }
  utterance.onend = finish
  utterance.onerror = finish

  isSpeaking.value = true
  speechSynthesis.speak(utterance)
}

export function useReadAloud() {
  return {
    isSpeaking,
    speak: speakReadAloud,
    stop: stopReadAloud,
    supported: speechSynthesisSupported(),
  }
}
