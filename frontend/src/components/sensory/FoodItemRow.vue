<script setup lang="ts">
import { ref, watch } from 'vue'
import type { SensoryFoodItemDTO, SensoryFoodStatus } from '../../types/sensory'

const props = defineProps<{ item: SensoryFoodItemDTO }>()
const emit = defineEmits<{
  delete: [id: string]
  patch: [item: SensoryFoodItemDTO, patch: Partial<{ name: string; status: SensoryFoodStatus; notes: SensoryFoodItemDTO['notes'] }>]
}>()

const open = ref(false)
const editName = ref('')
const editStatus = ref<SensoryFoodStatus>('SAFE')
const nTex = ref('')
const nSmell = ref('')
const nTemp = ref('')

watch(
  () => props.item,
  (i) => {
    editName.value = i.name
    editStatus.value = i.status
    nTex.value = i.notes.texture ?? ''
    nSmell.value = i.notes.smell ?? ''
    nTemp.value = i.notes.temperature ?? ''
  },
  { immediate: true },
)

function save() {
  const notes: SensoryFoodItemDTO['notes'] = {}
  if (nTex.value.trim()) notes.texture = nTex.value.trim()
  if (nSmell.value.trim()) notes.smell = nSmell.value.trim()
  if (nTemp.value.trim()) notes.temperature = nTemp.value.trim()
  emit('patch', props.item, {
    name: editName.value.trim(),
    status: editStatus.value,
    notes,
  })
}
</script>

<template>
  <div class="food-row">
    <div class="food-head">
      <button type="button" class="exp" :aria-expanded="open" @click="open = !open">
        {{ open ? '▼' : '▶' }}
      </button>
      <span class="food-name">{{ item.name }}</span>
      <span class="badge">{{ item.status }}</span>
      <button type="button" class="bb-btn bb-btn--ghost danger" @click="emit('delete', item.id)">Remove</button>
    </div>
    <div v-show="open" class="food-edit">
      <input v-model="editName" class="input" aria-label="Food name" />
      <select v-model="editStatus" class="select" aria-label="Status">
        <option value="SAFE">Safe</option>
        <option value="UNSURE">Unsure</option>
        <option value="UNSAFE">Unsafe</option>
      </select>
      <input v-model="nTex" class="input" placeholder="Contains ingredients that are" />
      <input v-model="nSmell" class="input" placeholder="Smell note" />
      <input v-model="nTemp" class="input" placeholder="Temperature note" />
      <button type="button" class="bb-btn bb-btn--primary" @click="save">Save changes</button>
    </div>
  </div>
</template>

<style scoped>
.food-row {
  border: 1px solid var(--bb-border);
  border-radius: 8px;
  padding: 0.35rem 0.5rem;
  margin-bottom: 0.35rem;
  background: var(--bb-bg);
}
.food-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}
.exp {
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0.15rem;
  color: var(--bb-muted);
}
.food-name {
  font-weight: 600;
  flex: 1;
  min-width: 6rem;
}
.badge {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.15rem 0.35rem;
  border-radius: 4px;
  background: var(--bb-border);
}
.food-edit {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px dashed var(--bb-border);
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.input {
  font: inherit;
  padding: 0.45rem;
  border: 1px solid var(--bb-border);
  border-radius: 8px;
}
.select {
  font: inherit;
  padding: 0.45rem;
  border-radius: 8px;
  border: 1px solid var(--bb-border);
}
.danger {
  color: #b91c1c;
}
</style>
