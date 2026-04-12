<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSettings, type BackgroundTint, type TextSize } from '../composables/useSettings'

const router = useRouter()
const { settings } = useSettings()

const textSizes: Array<{ id: TextSize; label: string }> = [
  { id: 'small', label: 'A' },
  { id: 'medium', label: 'A' },
  { id: 'large', label: 'A' },
]

const voices = computed(() => {
  const list = typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices() : []
  const uniq = Array.from(new Set(list.map((v) => v.name))).filter(Boolean)
  // keep saved voice at top even if not in list yet
  const saved = settings.value.voice
  const merged = saved && !uniq.includes(saved) ? [saved, ...uniq] : uniq
  return merged.length ? merged : [saved || 'Default']
})

function setTextSize(v: TextSize) {
  settings.value.textSize = v
}

function setTint(v: BackgroundTint) {
  settings.value.backgroundTint = v
}
</script>

<template>
  <div class="page">
    <div class="title">⚙️ Settings</div>

    <section class="card">
      <div class="section-label">FONT SIZE</div>
      <div class="row">
        <div class="row-left">
          <div class="row-title">Text size</div>
        </div>
        <div class="row-right">
          <div class="size-pills" role="group" aria-label="Text size">
            <button
              v-for="(s, idx) in textSizes"
              :key="s.id"
              type="button"
              class="size-pill"
              :class="{ active: settings.textSize === s.id, small: idx === 0, medium: idx === 1, large: idx === 2 }"
              @click="setTextSize(s.id)"
            >
              {{ s.label }}
            </button>
          </div>
        </div>
      </div>

      <div class="section-label">VOICE &amp; SOUND</div>

      <div class="row">
        <div class="row-left">
          <div class="row-title">Read aloud (TTS)</div>
          <div class="row-sub">Speak each word</div>
        </div>
        <div class="row-right">
          <label class="switch">
            <input type="checkbox" v-model="settings.readAloud" />
            <span class="slider" />
          </label>
        </div>
      </div>

      <div class="row">
        <div class="row-left">
          <div class="row-title">Step chime</div>
          <div class="row-sub">Bell on step complete</div>
        </div>
        <div class="row-right">
          <label class="switch">
            <input type="checkbox" v-model="settings.stepChime" />
            <span class="slider" />
          </label>
        </div>
      </div>

      <div class="row">
        <div class="row-left">
          <div class="row-title">Volume</div>
        </div>
        <div class="row-right wide">
          <input v-model.number="settings.volume" type="range" min="0" max="1" step="0.01" class="range" />
          <div class="range-val">{{ Math.round(settings.volume * 100) }}%</div>
        </div>
      </div>

      <div class="row">
        <div class="row-left">
          <div class="row-title">Rate</div>
        </div>
        <div class="row-right wide">
          <input v-model.number="settings.rate" type="range" min="0.5" max="2" step="0.05" class="range" />
          <div class="range-val">{{ settings.rate.toFixed(2) }}×</div>
        </div>
      </div>

      <div class="row">
        <div class="row-left">
          <div class="row-title">Voice</div>
        </div>
        <div class="row-right">
          <select v-model="settings.voice" class="select">
            <option v-for="v in voices" :key="v" :value="v">{{ v }}</option>
          </select>
        </div>
      </div>

      <div class="section-label">APPEARANCE</div>

      <div class="row">
        <div class="row-left">
          <div class="row-title">Dark mode</div>
        </div>
        <div class="row-right">
          <label class="switch">
            <input type="checkbox" v-model="settings.darkMode" />
            <span class="slider" />
          </label>
        </div>
      </div>

      <div class="row">
        <div class="row-left">
          <div class="row-title">Background tint</div>
          <div class="row-sub">Reduce visual glare</div>
        </div>
        <div class="row-right">
          <div class="tints" role="group" aria-label="Background tint">
            <button type="button" class="tint none" :class="{ active: settings.backgroundTint === 'none' }" @click="setTint('none')" />
            <button
              type="button"
              class="tint yellow"
              :class="{ active: settings.backgroundTint === 'yellow' }"
              @click="setTint('yellow')"
            />
            <button type="button" class="tint blue" :class="{ active: settings.backgroundTint === 'blue' }" @click="setTint('blue')" />
            <button
              type="button"
              class="tint green"
              :class="{ active: settings.backgroundTint === 'green' }"
              @click="setTint('green')"
            />
            <button
              type="button"
              class="tint peach"
              :class="{ active: settings.backgroundTint === 'peach' }"
              @click="setTint('peach')"
            />
          </div>
        </div>
      </div>
    </section>

    <button type="button" class="done" @click="router.back()">Done</button>
  </div>
</template>

<style scoped>
.page {
  max-width: 640px;
  margin: 0 auto;
  padding: 1.25rem 1.25rem 3rem;
}
.title {
  font-size: 1.65rem;
  font-weight: 900;
  margin: 0.4rem 0 1rem;
}
.card {
  background: var(--bb-surface);
  border: 1px solid var(--bb-border);
  border-radius: 18px;
  padding: 1.1rem 1.1rem;
}
.section-label {
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  color: var(--bb-muted);
  font-weight: 900;
  margin: 1.05rem 0 0.6rem;
}
.section-label:first-of-type {
  margin-top: 0;
}
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 0.85rem 0;
  border-top: 1px solid var(--bb-border);
}
.row:first-of-type {
  border-top: none;
}
.row-left {
  min-width: 12rem;
}
.row-title {
  font-weight: 900;
}
.row-sub {
  color: var(--bb-muted);
  font-size: 0.85rem;
  margin-top: 0.25rem;
}
.row-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
}
.row-right.wide {
  flex: 1;
}

.size-pills {
  display: flex;
  gap: 0.6rem;
  align-items: center;
}
.size-pill {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  border: 1px solid var(--bb-border);
  background: var(--bb-surface);
  color: var(--bb-text);
  font-weight: 900;
  cursor: pointer;
}
.size-pill.small {
  font-size: 0.95rem;
}
.size-pill.medium {
  font-size: 1.1rem;
}
.size-pill.large {
  font-size: 1.3rem;
}
.size-pill.active {
  border-color: #ea580c;
  box-shadow: 0 0 0 2px rgba(234, 88, 12, 0.15);
}

.switch {
  position: relative;
  width: 52px;
  height: 30px;
}
.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.slider {
  position: absolute;
  inset: 0;
  background: #e7e5e4;
  border-radius: 999px;
  transition: 0.18s ease;
}
.slider:before {
  content: '';
  position: absolute;
  width: 24px;
  height: 24px;
  left: 3px;
  top: 3px;
  background: #fff;
  border-radius: 999px;
  transition: 0.18s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}
.switch input:checked + .slider {
  background: #22c55e;
}
.switch input:checked + .slider:before {
  transform: translateX(22px);
}

.range {
  width: 100%;
}
.range-val {
  width: 3.3rem;
  text-align: right;
  color: var(--bb-muted);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.select {
  border: 1px solid var(--bb-border);
  border-radius: 12px;
  padding: 0.55rem 0.75rem;
  background: var(--bb-bg);
  color: var(--bb-text);
  font: inherit;
  min-width: 14rem;
}

.tints {
  display: flex;
  gap: 0.55rem;
  align-items: center;
}
.tint {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  border: 2px solid var(--bb-border);
  background: #fff;
}
.tint.active {
  border-color: #c2410c;
}
.tint.none {
  background: #fff;
}
.tint.yellow {
  background: #fef9c3;
}
.tint.blue {
  background: #dbeafe;
}
.tint.green {
  background: #dcfce7;
}
.tint.peach {
  background: #ffedd5;
}

.done {
  width: 100%;
  margin-top: 1rem;
  border: 1px solid var(--bb-border);
  background: var(--bb-surface);
  color: var(--bb-text);
  font-weight: 900;
  border-radius: 14px;
  padding: 0.85rem 1rem;
  cursor: pointer;
}
</style>

