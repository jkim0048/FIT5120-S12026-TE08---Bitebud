<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'

defineProps<{
  data: {
    label: string
    emoji: string
    timeMinutes?: number | null
    lane?: string | null
    muted?: boolean
    stepType: string
    completed: boolean
  }
}>()
</script>

<template>
  <div class="step-card" :class="{ done: data.completed, muted: data.muted }">
    <Handle type="target" :position="Position.Top" />
    <div class="row">
      <span class="emo">{{ data.emoji }}</span>
      <div class="text">
        <div class="lbl">{{ data.label }}</div>
        <div v-if="data.timeMinutes != null" class="meta">{{ data.timeMinutes }} min</div>
        <div v-if="data.lane" class="lane">{{ data.lane }}</div>
      </div>
      <span v-if="data.completed" class="check" aria-hidden="true">✓</span>
    </div>
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>

<style scoped>
.step-card {
  min-width: 180px;
  max-width: 240px;
  padding: 0.55rem 0.7rem;
  border-radius: 12px;
  background: var(--bb-surface);
  border: 2px solid var(--bb-border);
  font-size: 0.88rem;
}
.step-card.done {
  opacity: 0.65;
  border-color: var(--bb-done);
  background: #f5f5f4;
}
.step-card.muted {
  opacity: 0.35;
}
.row {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
}
.emo {
  font-size: 1.25rem;
  line-height: 1;
}
.text {
  flex: 1;
  min-width: 0;
}
.lbl {
  font-weight: 600;
}
.meta {
  font-size: 0.78rem;
  color: var(--bb-muted);
  margin-top: 0.15rem;
}
.lane {
  font-size: 0.72rem;
  color: var(--bb-accent);
  margin-top: 0.2rem;
}
.check {
  color: #16a34a;
  font-weight: 700;
}
</style>
