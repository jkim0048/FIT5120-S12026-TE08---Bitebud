<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'

const props = defineProps<{ message: string }>()
const emit = defineEmits<{ dismiss: [] }>()

let timer: ReturnType<typeof setTimeout> | null = null

function clearTimer() {
  if (timer != null) {
    clearTimeout(timer)
    timer = null
  }
}

watch(
  () => props.message,
  (msg) => {
    clearTimer()
    if (!msg.trim()) return
    timer = setTimeout(() => {
      emit('dismiss')
    }, 2000)
  },
  { immediate: true },
)

onBeforeUnmount(() => clearTimer())
</script>

<template>
  <Teleport to="body">
    <div v-if="message.trim()" class="motivation-toast" role="status" aria-live="polite">
      {{ message }}
    </div>
  </Teleport>
</template>

<style scoped>
.motivation-toast {
  position: fixed;
  left: 50%;
  bottom: 1.25rem;
  transform: translateX(-50%);
  max-width: min(92vw, 28rem);
  padding: 0.65rem 1rem;
  border-radius: 12px;
  background: color-mix(in srgb, var(--bb-surface-lowest) 92%, var(--bb-primary) 8%);
  border: 1px solid var(--bb-border);
  color: var(--bb-text);
  font-size: 0.95rem;
  line-height: 1.45;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
  z-index: 9999;
}
</style>
