<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ProgressRangePreset } from '../composables/useProgressRange'
import { useProgressRange } from '../composables/useProgressRange'

const props = withDefaults(
  defineProps<{
    disabled?: boolean
  }>(),
  { disabled: false },
)

const range = useProgressRange()

const customFromInput = ref('')
const customToInput = ref('')
let debounceTimer: number | null = null
const rangeMsg = ref('')

const MELBOURNE_CALENDAR = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Australia/Melbourne',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function isoToday(): string {
  return MELBOURNE_CALENDAR.format(new Date())
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function setPreset(p: Exclude<ProgressRangePreset, 'custom'>) {
  if (props.disabled) return
  range.setPreset(p)
  syncCustomInputsFromRange()
}

function selectCustom() {
  if (props.disabled) return
  range.preset.value = 'custom'
  syncCustomInputsFromRange()
}

function validateCustom(fromIso: string, toIsoStr: string): { ok: boolean; msg: string } {
  if (!fromIso || !toIsoStr) return { ok: false, msg: 'Choose both dates.' }
  if (fromIso > toIsoStr) return { ok: false, msg: 'From cannot be after To.' }
  if (toIsoStr > isoToday()) return { ok: false, msg: 'To cannot be in the future.' }
  return { ok: true, msg: '' }
}

function applyCustomDebounced() {
  if (debounceTimer) window.clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(() => {
    if (range.preset.value !== 'custom') return
    const v = validateCustom(customFromInput.value, customToInput.value)
    rangeMsg.value = v.msg
    if (!v.ok) return
    range.setCustom(
      new Date(`${customFromInput.value}T00:00:00.000Z`),
      new Date(`${customToInput.value}T00:00:00.000Z`),
    )
  }, 250)
}

function syncCustomInputsFromRange() {
  customFromInput.value = toIso(range.from.value)
  customToInput.value = toIso(range.to.value)
  rangeMsg.value = ''
}

syncCustomInputsFromRange()

watch(
  () => [range.preset.value, range.from.value.getTime(), range.to.value.getTime()],
  () => {
    if (range.preset.value !== 'custom') syncCustomInputsFromRange()
  },
)
</script>

<template>
  <section class="range-picker" :class="{ 'range-picker--disabled': disabled }" aria-label="Activity time window for this page">
    <div class="range-picker__head">
      <div class="range-picker__title">Show data from</div>
      <div class="range-picker__sub">
        Only affects this page. Pattern insights use your full recorded history.
      </div>
    </div>
    <div class="range-picker__chips" role="group" aria-label="Progress time window">
      <button type="button" class="range-picker__chip" :disabled="disabled" :class="{ active: range.preset.value === '7d' }" @click="setPreset('7d')">
        Last 7 days
      </button>
      <button type="button" class="range-picker__chip" :disabled="disabled" :class="{ active: range.preset.value === '30d' }" @click="setPreset('30d')">
        Last 30 days
      </button>
      <button type="button" class="range-picker__chip" :class="{ active: range.preset.value === '90d' }" @click="setPreset('90d')">
        Last 90 days
      </button>
      <button type="button" class="range-picker__chip" :disabled="disabled" :class="{ active: range.preset.value === '12m' }" @click="setPreset('12m')">
        Last 12 months
      </button>
      <button type="button" class="range-picker__chip" :class="{ active: range.preset.value === 'custom' }" @click="selectCustom()">
        Custom
      </button>
    </div>

    <div v-if="range.preset.value === 'custom'" class="range-picker__custom">
      <label class="range-picker__field">
        <span>From</span>
        <input v-model="customFromInput" type="date" :disabled="disabled" :max="customToInput || isoToday()" @input="applyCustomDebounced" />
      </label>
      <label class="range-picker__field">
        <span>To</span>
        <input v-model="customToInput" type="date" :disabled="disabled" :max="isoToday()" @input="applyCustomDebounced" />
      </label>
      <p v-if="rangeMsg.trim().length > 0" class="range-picker__msg" role="status">{{ rangeMsg }}</p>
    </div>
  </section>
</template>

<style scoped>
.range-picker {
  border: 1px solid var(--bb-border);
  border-radius: 16px;
  background: var(--bb-surface-low);
  padding: 1rem;
  display: grid;
  gap: 0.75rem;
}
.range-picker__title {
  font-family: var(--bb-font-headline);
  font-weight: 900;
  font-size: 1.05rem;
}
.range-picker__sub {
  color: color-mix(in srgb, var(--bb-text) 70%, var(--bb-muted));
  margin-top: 0.2rem;
}
.range-picker__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}
.range-picker__chip {
  border: 1px solid var(--bb-border);
  border-radius: 999px;
  background: var(--bb-surface-lowest);
  padding: 0.35rem 0.7rem;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  color: var(--bb-text);
}
.range-picker__chip.active {
  border-color: var(--bb-accent);
  background: color-mix(in srgb, var(--bb-accent) 14%, var(--bb-surface-lowest));
}
.range-picker--disabled .range-picker__chip,
.range-picker--disabled .range-picker__field input {
  opacity: 0.55;
  cursor: not-allowed;
}
.range-picker__custom {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  align-items: end;
}
.range-picker__field {
  display: grid;
  gap: 0.3rem;
  font-weight: 800;
}
.range-picker__field span {
  font-size: 0.9rem;
}
.range-picker__field input {
  border: 1px solid var(--bb-border);
  border-radius: 12px;
  padding: 0.55rem 0.7rem;
  background: var(--bb-surface-lowest);
  font: inherit;
  color: #000;
  -webkit-text-fill-color: #000;
}
.range-picker__msg {
  grid-column: 1 / -1;
  margin: 0;
  color: color-mix(in srgb, var(--bb-text) 70%, var(--bb-muted));
}

@media (max-width: 900px) {
  .range-picker__custom {
    grid-template-columns: 1fr;
  }
}
</style>
