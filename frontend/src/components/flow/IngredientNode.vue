<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { apiUrl } from '../../lib/api'

defineProps<{
  data: {
    label: string
    emoji: string
    iconId?: string
    imageUrl?: string
  }
}>()
</script>

<template>
  <div class="ingredient-card">
    <Handle type="target" :position="Position.Top" />
    <img
      v-if="data.imageUrl || data.iconId"
      :src="data.imageUrl || apiUrl(`/api/icons/wicked/${data.iconId}`)"
      :alt="data.label"
      class="icon"
    />
    <span v-else class="emo">{{ data.emoji }}</span>
    <span class="lbl">{{ data.label }}</span>
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>

<style scoped>
.ingredient-card {
  min-width: 160px;
  max-width: 220px;
  padding: 0.5rem 0.65rem;
  border-radius: 12px;
  background: var(--bb-accent-soft);
  border: 1px solid #fed7aa;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
}
.emo {
  font-size: 1.35rem;
  line-height: 1;
}
.icon {
  width: 24px;
  height: 24px;
  object-fit: cover;
  border-radius: 6px;
}
.lbl {
  font-weight: 600;
}
</style>
