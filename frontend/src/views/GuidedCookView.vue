<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { biteBudUserIdHeader, getBiteBudUserId } from '../composables/useUserId'
import { useSettings } from '../composables/useSettings'
import { apiFetch, apiUrl } from '../lib/api'
import { getOrderedRecipeSteps } from '../lib/recipeSteps'
import { downloadShoppingListPdf } from '../lib/shoppingListPdf'
import { findTtsVoiceByName } from '../lib/ttsVoices'
import type { RecipeGraph } from '../types/recipe'
import type { SensoryConflictResponse } from '../types/sensory'

type JourneyPhase = 'getReady' | 'ingredients' | 'roadmap' | 'step' | 'timer'
type TimerState = 'idle' | 'running' | 'paused'
type FlavorKey = 'sweet' | 'salty' | 'sour' | 'bitter' | 'spicy'
type FlavorItem = { key: FlavorKey; label: string; ingredientIds: string[] }

const brokenImageSrcs = ref<Set<string>>(new Set())
function isBrokenImageSrc(src: string | null | undefined): boolean {
  if (!src) return false
  return brokenImageSrcs.value.has(src)
}
function markBrokenImageSrc(src: string | null | undefined) {
  if (!src) return
  brokenImageSrcs.value.add(src)
}

function markBrokenFromImgEvent(e: Event) {
  const el = e.target as HTMLImageElement | null
  const src = el?.currentSrc || el?.src
  if (src) markBrokenImageSrc(src)
}

function ingredientVisualSrc(item: { imageUrl?: string | null; icon?: string | null }): string | null {
  const img = typeof item.imageUrl === 'string' ? item.imageUrl.trim() : ''
  if (img && !isBrokenImageSrc(img)) return img
  const icon = typeof item.icon === 'string' ? item.icon.trim() : ''
  if (icon) {
    const src = apiUrl(`/api/icons/wicked/${icon}`)
    if (!isBrokenImageSrc(src)) return src
  }
  return null
}

const EQUIPMENT_CATALOG = [
  'pan',
  'pot',
  'knife',
  'cutting board',
  'spoon',
  'spatula',
  'whisk',
  'bowl',
  'oven',
  'air fryer',
  'grater',
  'strainer',
  'blender',
  'processor',
  'tray',
]
const TOOL_ICON_HINTS: Array<{ match: RegExp; icon: string }> = [
  { match: /knife/i, icon: '🔪' },
  { match: /(cutting board|board)/i, icon: '🪵' },
  { match: /(spoon|ladle)/i, icon: '🥄' },
  { match: /(bowl|mix)/i, icon: '🥣' },
  { match: /(pan|pot)/i, icon: '🍳' },
  { match: /(oven|air fryer)/i, icon: '🔥' },
  { match: /(whisk|blender|processor)/i, icon: '🌀' },
]

const route = useRoute()
const router = useRouter()
const { settings } = useSettings()

const graph = ref<RecipeGraph | null>(null)
const err = ref<string | null>(null)
const pageLoading = ref(true)
const index = ref(0)
const conflicts = ref<SensoryConflictResponse | null>(null)
const completed = ref<string[]>([])
const loadingDone = ref(false)
const sessionStartMs = ref<number>(Date.now())

const journeyPhase = ref<JourneyPhase>('getReady')
const getReadyChecks = ref<Record<string, boolean>>({})
const ingredientChecks = ref<Record<string, boolean>>({})

type ChecklistConfirmContext = 'getReadyToIngredients' | 'ingredientsToSteps'
const checklistConfirmOpen = ref(false)
const checklistConfirmContext = ref<ChecklistConfirmContext>('getReadyToIngredients')

const allReadyChecked = computed(() => {
  const values = Object.values(getReadyChecks.value)
  return values.length === 0 || values.every(Boolean)
})
const allIngredientsChecked = computed(() => {
  const values = Object.values(ingredientChecks.value)
  return values.length === 0 || values.every(Boolean)
})

function setAllGetReadyChecks(checked: boolean) {
  const next: Record<string, boolean> = {}
  for (const k of Object.keys(getReadyChecks.value)) next[k] = checked
  getReadyChecks.value = next
}

function setAllIngredientChecks(checked: boolean) {
  const next: Record<string, boolean> = {}
  for (const k of Object.keys(ingredientChecks.value)) next[k] = checked
  ingredientChecks.value = next
}

const checklistConfirmTitle = computed(() => 'Not everything is checked')
const checklistConfirmBody = computed(() =>
  checklistConfirmContext.value === 'getReadyToIngredients'
    ? "You haven't checked all equipment items. You can go back to finish, or proceed anyway."
    : "You haven't checked all ingredients. Any unchecked items will be added to your shopping list. You can go back to update the checklist, or proceed to cooking steps.",
)

const checklistConfirmHasShoppingList = computed(
  () => checklistConfirmContext.value === 'ingredientsToSteps' && uncheckedIngredientCount.value > 0,
)

const shoppingListOpen = ref(false)

const timerState = ref<TimerState>('idle')
const remaining = ref<number | null>(null)
const totalSeconds = ref<number | null>(null)
const timer = ref<number | null>(null)

const recipeId = computed(() => route.params.id as string)
const selectedServings = ref<number | null>(null)
const baseServings = ref<number | null>(null)
const flavorAdjustments = ref<Record<FlavorKey, number>>({
  sweet: 0,
  salty: 0,
  sour: 0,
  bitter: 0,
  spicy: 0,
})
const flavorItems = ref<FlavorItem[]>([])
const steps = computed(() => (graph.value ? getOrderedRecipeSteps(graph.value) : []))
const current = computed(() => steps.value[index.value] ?? null)
const instructionTitle = computed(() => {
  const c = current.value
  if (!c) return ''
  const label = (c.label ?? '').trim()
  const fallback = (c.detail ?? '').trim()
  const stepLabel = label || fallback
  if (!stepLabel) return ''
  return `Step ${index.value + 1} — ${stepLabel}`
})
const instructionSubtitle = computed(() => {
  const c = current.value
  if (!c) return ''
  return (c.detail ?? '').trim()
})
const instructionText = computed(() => instructionSubtitle.value || instructionTitle.value)

const speechSupported = typeof window !== 'undefined' && typeof speechSynthesis !== 'undefined'

const hasConflictWarnings = computed(() => {
  const c = conflicts.value
  if (!c?.hasProfile) return false
  return c.sensory.length + c.dietary.length > 0
})

const estimatedMinutes = computed(() => {
  const m = Number(current.value?.timeMinutes ?? 0)
  return Number.isFinite(m) && m > 0 ? m : null
})

const ingredientNodeById = computed(() => {
  const map = new Map<string, { label: string; emoji?: string; icon?: string; imageUrl?: string }>()
  for (const node of graph.value?.nodes ?? []) {
    map.set(node.id, {
      label: node.label,
      emoji: node.emoji,
      icon: node.icon,
      imageUrl: node.imageUrl ?? undefined,
    })
  }
  return map
})

const currentIngredientVisuals = computed(() => {
  if (!current.value?.ingredientIds?.length) return []
  return current.value.ingredientIds
    .map((id) => ingredientNodeById.value.get(id))
    .filter((v): v is { label: string; emoji?: string; icon?: string; imageUrl?: string } => Boolean(v))
})

const allIngredientLabels = computed(() => {
  if (!graph.value) return []
  return graph.value.nodes
    .filter((n) => n.type === 'ingredient')
    .map((n) => n.label.trim())
    .filter(Boolean)
})

/** BBC/source lines often prefix `For the crust: …` — split so headings can show once above each group. */
function splitForTheSection(detail: string): { section: string | null; body: string } {
  const d = detail.trim()
  const m = d.match(/^((?:for\s+the\s+)[^:]+):\s*(.*)$/i)
  if (!m) return { section: null, body: d }
  const body = (m[2] ?? '').trim()
  return body ? { section: (m[1] ?? '').trim(), body } : { section: null, body: d }
}

function formatSectionHeading(section: string): string {
  const t = section.trim()
  const m = t.match(/^(for the )(.+)$/i)
  if (!m) return t
  const words = m[2].trim().split(/\s+/).filter(Boolean)
  const pretty = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
  return `For the ${pretty}`
}

/** Remove trailing duplicate ingredient name from qty line when the title already shows it (e.g. "5 thinly sliced Onion" → "5 thinly sliced"). */
function qtyDetailWithoutTrailingLabel(detail: string, label: string): string {
  const d = detail.trim()
  const lab = label.trim()
  if (!lab || !d) return d
  const escaped = lab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const trimmed = d.replace(new RegExp(`\\s+${escaped}\\s*$`, 'i'), '').trim()
  return trimmed.length >= 2 ? trimmed : d
}

/** Strip `For the …:` accidentally stored on the ingredient label (section already shown above). */
function stripLeadingForTheFromLabel(label: string): string {
  return label.replace(/^((?:for\s+the\s+)[^:]+):\s*/i, '').trim()
}

/**
 * One checklist line: prefer scaled `detail` (servings + flavors). Prepend cleaned `label` only when
 * `detail` is measure-only and does not already name the ingredient.
 */
function ingredientChecklistSingleLine(label: string, detail: string): string {
  const lab = stripLeadingForTheFromLabel(label).trim() || label.trim()
  const d = detail.trim()
  if (!d) return lab
  if (!lab) return d
  const dLo = d.toLowerCase()
  const tokens = lab
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 4)
  if (tokens.some((t) => dLo.includes(t))) return d
  return `${lab} ${d}`
}

type IngredientChecklistRow = {
  id: string
  label: string
  detail: string
  icon: string | null
  emoji: string | null
  imageUrl: string | null
}

type IngredientChecklistGroup = {
  sectionKey: string
  sectionTitle: string | null
  items: IngredientChecklistRow[]
}

const ingredientChecklistGroups = computed((): IngredientChecklistGroup[] => {
  if (!graph.value) return []
  const selected = selectedServings.value
  const base = baseServings.value ?? parsePositiveInt(graph.value.servings)
  const servingsFactor = selected && base ? selected / base : 1
  const flavorFactorByIngredient = new Map<string, number>()
  for (const ing of graph.value.nodes.filter((n) => n.type === 'ingredient')) {
    const factors: number[] = []
    for (const f of flavorItems.value) {
      if (!f.ingredientIds.includes(String(ing.id))) continue
      factors.push(flavorValueToFactor(Number(flavorAdjustments.value[f.key] ?? 0)))
    }
    const avg = factors.length
      ? factors.reduce((a, b) => a + b, 0) / factors.length
      : flavorFallbackFactor({ label: String(ing.label ?? ''), detail: String(ing.detail ?? '') })
    flavorFactorByIngredient.set(String(ing.id), avg)
  }

  const rows: Array<IngredientChecklistRow & { section: string | null }> = graph.value.nodes
    .filter((n) => n.type === 'ingredient')
    .map((n) => {
      const rawDetail = String(n.detail ?? '').trim()
      const { section, body } = splitForTheSection(rawDetail)
      const factor = servingsFactor * (flavorFactorByIngredient.get(String(n.id)) ?? 1)
      const scaledBody = scaleIngredientDetail(body, factor)
      let detail = scaledBody && scaledBody !== String(n.label ?? '').trim() ? scaledBody : ''
      const lab = String(n.label ?? '').trim()
      if (detail) detail = qtyDetailWithoutTrailingLabel(detail, lab)
      return {
        id: String(n.id),
        label: String(n.label ?? '').trim(),
        section,
        detail,
        icon: typeof n.icon === 'string' ? n.icon : null,
        emoji: typeof n.emoji === 'string' ? n.emoji : null,
        imageUrl: typeof n.imageUrl === 'string' ? n.imageUrl : null,
      }
    })
    .filter((x) => Boolean(x.label))

  const groups: IngredientChecklistGroup[] = []
  for (const row of rows) {
    const key = row.section ?? ''
    const last = groups[groups.length - 1]
    const { section, ...item } = row
    if (last && last.sectionKey === key) {
      last.items.push(item)
    } else {
      groups.push({
        sectionKey: key,
        sectionTitle: section,
        items: [item],
      })
    }
  }
  return groups
})

const uncheckedIngredientChecklistGroups = computed((): IngredientChecklistGroup[] => {
  const out: IngredientChecklistGroup[] = []
  for (const g of ingredientChecklistGroups.value) {
    const items = g.items.filter((it) => ingredientChecks.value[it.id] !== true)
    if (!items.length) continue
    out.push({ sectionKey: g.sectionKey, sectionTitle: g.sectionTitle, items })
  }
  return out
})

const uncheckedIngredientCount = computed(() =>
  uncheckedIngredientChecklistGroups.value.reduce((sum, g) => sum + g.items.length, 0),
)

function openShoppingList() {
  shoppingListOpen.value = true
}
function closeShoppingList() {
  shoppingListOpen.value = false
}

async function exportShoppingListPdf() {
  if (!graph.value) return
  if (uncheckedIngredientCount.value === 0) return
  const checkedIngredientChecklistGroups = ingredientChecklistGroups.value
    .map((g) => ({
      sectionKey: g.sectionKey,
      sectionTitle: g.sectionTitle,
      items: g.items.filter((it) => ingredientChecks.value[it.id] === true),
    }))
    .filter((g) => g.items.length > 0)

  await downloadShoppingListPdf({
    recipeTitle: graph.value.title,
    servingsLabel:
      selectedServings.value != null && baseServings.value != null
        ? `${selectedServings.value} servings`
        : selectedServings.value != null
          ? `${selectedServings.value} servings`
          : null,
    buyGroups: uncheckedIngredientChecklistGroups.value.map((g) => ({
      title: g.sectionTitle ? formatSectionHeading(g.sectionTitle) : null,
      lines: g.items.map((it) => ingredientChecklistSingleLine(it.label, it.detail)),
    })),
    pantryGroups: checkedIngredientChecklistGroups.map((g) => ({
      title: g.sectionTitle ? formatSectionHeading(g.sectionTitle) : null,
      lines: g.items.map((it) => ingredientChecklistSingleLine(it.label, it.detail)),
    })),
  })
}

const equipmentItems = computed(() => {
  const textBlob = steps.value.map((s) => `${s.label} ${s.detail}`.toLowerCase()).join(' ')
  const fromKeywords = EQUIPMENT_CATALOG.filter((item) => textBlob.includes(item)).map((item) => toTitleCase(item))
  if (fromKeywords.length) return fromKeywords.slice(0, 8)
  return [...new Set(allIngredientLabels.value)].slice(0, 8)
})
const readyItems = computed(() =>
  equipmentItems.value.map((label) => ({
    label,
    icon: toolIconFor(label),
  })),
)
const recipeMetaLabel = computed(() => {
  const time = graph.value?.totalTimeMinutes
  const timeLabel = time && time > 0 ? `~${time} min` : 'time unknown'
  return `${steps.value.length} steps - ${timeLabel}`
})

/** Segmented top progress reflects actual number of steps */
const segmentCount = computed(() => Math.max(1, steps.value.length))

/** Large hero visuals: step emoji + ingredient thumbs/emojis */
const stepVisualSlots = computed(() => {
  // Reference `brokenImageSrcs` so this recomputes after any <img> error.
  void brokenImageSrcs.value
  const out: Array<{ kind: 'img'; src: string; alt: string } | { kind: 'emoji'; s: string }> = []
  const c = current.value
  if (c?.emoji?.trim()) out.push({ kind: 'emoji', s: c.emoji.trim() })
  for (const ing of currentIngredientVisuals.value.slice(0, 4)) {
    const src = ingredientVisualSrc({ imageUrl: ing.imageUrl, icon: ing.icon })
    if (src) out.push({ kind: 'img', src, alt: ing.label })
    else out.push({ kind: 'emoji', s: ingredientVisualToken(ing) })
  }
  if (out.length === 0) out.push({ kind: 'emoji', s: '👩‍🍳' })
  return out.slice(0, 4)
})

function toTitleCase(v: string): string {
  return v.replace(/\b\w/g, (m) => m.toUpperCase())
}
function toolIconFor(label: string): string {
  const hit = TOOL_ICON_HINTS.find((hint) => hint.match.test(label))
  return hit?.icon ?? '🍽️'
}
function ingredientVisualToken(item: { label: string; emoji?: string; icon?: string }): string {
  if (item.icon && item.icon.trim()) return item.icon.trim().slice(0, 2)
  if (item.emoji && item.emoji.trim()) return item.emoji.trim().slice(0, 2)
  const short = item.label.trim().slice(0, 2)
  return short ? short.toUpperCase() : '•'
}

function servingsStorageKey(id: string): string {
  return `bitebud:servings:${id}`
}
function flavorKeyStorage(id: string): string {
  return `bitebud:flavors:${id}`
}
function flavorMapStorage(id: string): string {
  return `bitebud:flavor-map:${id}`
}

function parsePositiveInt(v: unknown): number | null {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const i = Math.round(n)
  return i > 0 ? i : null
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y) {
    const t = y
    y = x % y
    x = t
  }
  return x || 1
}

function toFractionString(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  const whole = Math.floor(abs)
  const frac = abs - whole
  if (frac < 0.01) return `${sign}${whole}`
  const denom = 8
  let num = Math.round(frac * denom)
  if (num === 0) return `${sign}${whole}`
  if (num === denom) return `${sign}${whole + 1}`
  const d = gcd(num, denom)
  num /= d
  const den = denom / d
  if (whole === 0) return `${sign}${num}/${den}`
  return `${sign}${whole} ${num}/${den}`
}

function toSpokenFractionString(value: number): string {
  const compact = toFractionString(value)
  const mixed = compact.match(/^(-?\d+)\s+(\d+)\/(\d+)$/)
  if (mixed) return `${mixed[1]} and ${mixed[2]}/${mixed[3]}`
  return compact
}

function parseQuantityToken(token: string): number | null {
  const t = token.trim()
  const spokenMixed = t.match(/^(\d+)\s+and\s+(\d+)\/(\d+)$/i)
  if (spokenMixed) {
    const whole = Number(spokenMixed[1])
    const num = Number(spokenMixed[2])
    const den = Number(spokenMixed[3])
    if (den > 0) return whole + num / den
  }
  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/)
  if (mixed) {
    const whole = Number(mixed[1])
    const num = Number(mixed[2])
    const den = Number(mixed[3])
    if (den > 0) return whole + num / den
  }
  const fraction = t.match(/^(\d+)\/(\d+)$/)
  if (fraction) {
    const num = Number(fraction[1])
    const den = Number(fraction[2])
    if (den > 0) return num / den
  }
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function isMetricMassVolumeUnit(unit: string): boolean {
  const u = unit.toLowerCase()
  return /^(g|gram|grams|kg|kilogram|kilograms|ml|millilitre|milliliter|milliliters|millilitres|l|liter|litre|litres|liters)$/.test(
    u,
  )
}

function normalizeUnicodeFractions(s: string): string {
  return s
    .replace(/½/g, "1/2")
    .replace(/⅓/g, "1/3")
    .replace(/⅔/g, "2/3")
    .replace(/¼/g, "1/4")
    .replace(/¾/g, "3/4")
    .replace(/⅛/g, "1/8")
    .replace(/⅜/g, "3/8")
    .replace(/⅝/g, "5/8")
    .replace(/⅞/g, "7/8")
}

function scaleIngredientDetail(detail: string, factor: number): string {
  if (!detail || !Number.isFinite(factor) || factor <= 0 || Math.abs(factor - 1) < 0.001) return detail
  const source = normalizeUnicodeFractions(detail)
  const leadRe = /^\s*(\d+\s+and\s+\d+\/\d+|\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*([a-zA-Z]+)?(\b[\s\S]*)?$/
  const lead = source.match(leadRe)
  if (lead) {
    const baseQty = parseQuantityToken(lead[1])
    const unitRaw = (lead[2] ?? '').trim()
    const rest = lead[3] ?? ''
    if (baseQty != null) {
      const scaled = Number((baseQty * factor).toFixed(3))
      const unit = unitRaw.toLowerCase()
      if (unit === 'kg' && scaled > 0 && scaled < 1) {
        const grams = Math.max(1, Math.round(scaled * 1000))
        return `${grams} grams${rest}`
      }
      let qtyText: string
      if (unitRaw && isMetricMassVolumeUnit(unitRaw)) qtyText = String(Math.round(scaled))
      else qtyText = unitRaw ? toFractionString(scaled) : toSpokenFractionString(scaled)
      return `${qtyText}${unitRaw ? ` ${unitRaw}` : ''}${rest}`
    }
  }
  const quantityRe = /\b\d+\s+and\s+\d+\/\d+|\b\d+\s+\d+\/\d+|\b\d+\/\d+|\b\d+(?:\.\d+)?\b/g
  return source.replace(quantityRe, (token, offset) => {
    const parsed = parseQuantityToken(token)
    if (parsed == null) return token
    const scaled = parsed * factor
    if (!Number.isFinite(scaled) || scaled <= 0) return token
    const after = source.slice(offset + token.length).replace(/^\s*/, '')
    const unitMatch = /^([a-zA-Z]{1,20})\b/.exec(after)
    const unitWord = unitMatch?.[1] ?? ''
    if (unitWord && isMetricMassVolumeUnit(unitWord))
      return String(Math.round(Number(scaled.toFixed(5))))
    return toFractionString(Number(scaled.toFixed(3)))
  })
}

function flavorValueToFactor(v: number): number {
  if (v <= -100) return 0
  if (v <= -50) return 0.5
  if (v <= -25) return 0.75
  if (v >= 100) return 2
  if (v >= 50) return 1.5
  if (v >= 25) return 1.25
  return 1
}

function flavorFallbackFactor(ingredient: { label: string; detail?: string | null }): number {
  const text = `${ingredient.label} ${ingredient.detail ?? ''}`.toLowerCase()
  const factors: number[] = []
  if (/(sugar|honey|jaggery|syrup|sweetener|molasses|maple|dates?|raisins?)/.test(text)) {
    factors.push(flavorValueToFactor(flavorAdjustments.value.sweet))
  }
  if (/(salt|soy sauce|brine|stock cube|bouillon|fish sauce|anchovy|miso)/.test(text)) {
    factors.push(flavorValueToFactor(flavorAdjustments.value.salty))
  }
  if (
    /(lemon|lime|vinegar|tamarind|sumac|yogurt|curd|citric|sour(?:ed)?\s+cream|cr[eè]me\s+fra[iî]che|buttermilk|cream of tartar)/.test(
      text,
    )
  ) {
    factors.push(flavorValueToFactor(flavorAdjustments.value.sour))
  }
  if (/(coffee|cocoa|dark chocolate|kale|fenugreek|radicchio|bitter gourd|turmeric)/.test(text)) {
    factors.push(flavorValueToFactor(flavorAdjustments.value.bitter))
  }
  if (/(chilli|chili|pepper|jalape|serrano|cayenne|paprika|hot sauce|wasabi|mustard)/.test(text)) {
    factors.push(flavorValueToFactor(flavorAdjustments.value.spicy))
  }
  if (!factors.length) return 1
  return factors.reduce((a, b) => a + b, 0) / factors.length
}
const timerPct = computed(() => {
  if (remaining.value == null || totalSeconds.value == null || totalSeconds.value <= 0) return 0
  return Math.max(0, Math.min(1, remaining.value / totalSeconds.value))
})
const RING_DASH_ARRAY = 754
const ringDashOffset = computed(() => Math.round((1 - timerPct.value) * RING_DASH_ARRAY))

function speak(text: string) {
  if (!speechSupported) return
  if (typeof speechSynthesis === 'undefined') return
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.volume = settings.value.volume
  u.rate = settings.value.rate
  const match = findTtsVoiceByName(settings.value.voice)
  if (match) u.voice = match
  speechSynthesis.speak(u)
}

function clearTick() {
  if (!timer.value) return
  clearInterval(timer.value)
  timer.value = null
}

function stopTimer() {
  clearTick()
  timerState.value = 'idle'
  remaining.value = null
  totalSeconds.value = null
}

function pauseTimer() {
  clearTick()
  if (remaining.value == null) return
  timerState.value = 'paused'
}

function startTimer() {
  clearTick()
  const seed = remaining.value ?? Math.max(1, Number(current.value?.timeMinutes ?? 1)) * 60
  remaining.value = seed
  if (totalSeconds.value == null) totalSeconds.value = seed
  timerState.value = 'running'
  timer.value = window.setInterval(() => {
    if (remaining.value == null) return
    remaining.value -= 1
    if (remaining.value <= 0) stopTimer()
  }, 1000)
}

function enterRoadmapPhase() {
  journeyPhase.value = 'roadmap'
}

function enterGetReadyPhase() {
  stopTimer()
  journeyPhase.value = 'getReady'
}

function enterIngredientsPhase() {
  journeyPhase.value = 'ingredients'
}

function closeChecklistConfirm() {
  checklistConfirmOpen.value = false
}

function proceedChecklistConfirm() {
  const ctx = checklistConfirmContext.value
  checklistConfirmOpen.value = false
  if (ctx === 'getReadyToIngredients') enterIngredientsPhase()
  else enterRoadmapPhase()
}

function viewShoppingListFromConfirm() {
  checklistConfirmOpen.value = false
  openShoppingList()
}

function requestEnterIngredientsPhase() {
  if (allReadyChecked.value) {
    enterIngredientsPhase()
    return
  }
  checklistConfirmContext.value = 'getReadyToIngredients'
  checklistConfirmOpen.value = true
}

function requestEnterRoadmapPhase() {
  if (allIngredientsChecked.value) {
    enterRoadmapPhase()
    return
  }
  checklistConfirmContext.value = 'ingredientsToSteps'
  checklistConfirmOpen.value = true
}

function backFromGetReady() {
  void router.push({
    name: 'guidedFlavors',
    params: { id: recipeId.value },
    query: {
      servings: String(selectedServings.value ?? 2),
      baseServings: String(baseServings.value ?? selectedServings.value ?? 2),
    },
  })
}

function enterStepPhase(stepIdx?: number) {
  if (typeof stepIdx === 'number' && stepIdx >= 0 && stepIdx < steps.value.length) index.value = stepIdx
  journeyPhase.value = 'step'
}

function openTimerPhase() {
  if (timerState.value === 'idle') startTimer()
  journeyPhase.value = 'timer'
}

function skipStepFromTimer() {
  next()
  stopTimer()
  journeyPhase.value = 'step'
}

async function loadProgress() {
  const uid = getBiteBudUserId()
  if (!uid) {
    completed.value = []
    return
  }
  try {
    const data = await apiFetch<{ completedNodeIds: string[] }>(`/api/recipes/${recipeId.value}/progress`, {
      headers: { 'X-User-Id': uid },
    })
    completed.value = data.completedNodeIds ?? []
  } catch {
    completed.value = []
  }
}

async function saveProgress(next: string[]) {
  const uid = getBiteBudUserId()
  if (!uid) return
  await apiFetch(`/api/recipes/${recipeId.value}/progress`, {
    method: 'POST',
    body: JSON.stringify({ completedNodeIds: next }),
    headers: { 'X-User-Id': uid },
  })
}

async function markRecipeCompleted(): Promise<void> {
  const uid = getBiteBudUserId()
  if (!uid) return
  try {
    await apiFetch(`/api/recipes/${recipeId.value}/complete`, {
      method: 'POST',
      headers: { 'X-User-Id': uid },
    })
  } catch {
    // Completion should never block the user finishing the flow.
  }
}

async function loadRecipe() {
  pageLoading.value = true
  err.value = null
  try {
    const data = await apiFetch<{ graph: RecipeGraph }>(`/api/recipes/${recipeId.value}`, {
      headers: biteBudUserIdHeader(),
    })
    graph.value = data.graph
    const baseFromQuery = parsePositiveInt(route.query.baseServings)
    const selectedFromQuery = parsePositiveInt(route.query.servings)
    const baseFromGraph = parsePositiveInt(data.graph.servings)
    baseServings.value = baseFromQuery ?? baseFromGraph ?? 2
    selectedServings.value = selectedFromQuery ?? null
    if (selectedServings.value == null) {
      try {
        selectedServings.value = parsePositiveInt(sessionStorage.getItem(servingsStorageKey(recipeId.value)))
      } catch {
        selectedServings.value = null
      }
    }
    if (selectedServings.value == null) selectedServings.value = baseServings.value
    flavorItems.value = []
    try {
      const fromApi = await apiFetch<{ flavors: FlavorItem[] }>(`/api/recipes/${recipeId.value}/flavors`, {
        headers: biteBudUserIdHeader(),
      })
      flavorItems.value = fromApi.flavors ?? []
    } catch {
      flavorItems.value = []
    }
    try {
      const raw = sessionStorage.getItem(flavorKeyStorage(recipeId.value))
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>
        for (const k of ['sweet', 'salty', 'sour', 'bitter', 'spicy'] as const) {
          const n = Number(parsed[k])
          if (Number.isFinite(n)) flavorAdjustments.value[k] = n
        }
      }
    } catch {
      // ignore
    }
    try {
      const rawMap = sessionStorage.getItem(flavorMapStorage(recipeId.value))
      if (rawMap) {
        const parsed = JSON.parse(rawMap) as FlavorItem[]
        if (Array.isArray(parsed) && parsed.length) flavorItems.value = parsed
      }
    } catch {
      // ignore
    }
    await loadProgress()

    const uid = getBiteBudUserId()
    if (uid) {
      try {
        conflicts.value = await apiFetch<SensoryConflictResponse>(`/api/recipes/${recipeId.value}/sensory-conflicts`, {
          headers: { 'X-User-Id': uid },
        })
      } catch {
        conflicts.value = null
      }
    } else {
      conflicts.value = null
    }
  } catch (e) {
    err.value = e instanceof Error ? e.message : 'Load failed'
    graph.value = null
  } finally {
    pageLoading.value = false
  }
}

watch(
  recipeId,
  async () => {
    journeyPhase.value = 'getReady'
    graph.value = null
    index.value = 0
    conflicts.value = null
    completed.value = []
    getReadyChecks.value = {}
    ingredientChecks.value = {}
    sessionStartMs.value = Date.now()
    stopTimer()
    await loadRecipe()
  },
  { immediate: true },
)

watch(
  equipmentItems,
  (items) => {
    const prev = getReadyChecks.value
    getReadyChecks.value = Object.fromEntries(items.map((item) => [item, prev[item] ?? false]))
  },
  { immediate: true },
)

watch(
  ingredientChecklistGroups,
  (groups) => {
    const flat = groups.flatMap((g) => g.items)
    const prev = ingredientChecks.value
    ingredientChecks.value = Object.fromEntries(flat.map((item) => [item.id, prev[item.id] ?? false]))
  },
  { immediate: true },
)

onUnmounted(() => {
  clearTick()
})

watch(
  () => current.value?.id,
  () => {
    if (!current.value) return
    stopTimer()
  },
)

function next() {
  if (index.value < steps.value.length - 1) index.value += 1
}

function prev() {
  if (index.value > 0) index.value -= 1
}

function formatClock(sec: number | null): string {
  if (sec == null) return '--:--'
  const mm = Math.floor(sec / 60)
  const ss = sec % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

async function markStepDoneAndNext() {
  if (!current.value || loadingDone.value) return
  loadingDone.value = true
  try {
    const set = new Set(completed.value)
    set.add(current.value.id)
    const nextCompleted = [...set]
    await saveProgress(nextCompleted)
    completed.value = nextCompleted

    const atLastStep = index.value >= steps.value.length - 1
    if (atLastStep) {
      const elapsedMin = Math.max(1, Math.round((Date.now() - sessionStartMs.value) / 60000))
      await markRecipeCompleted()
      await router.push({
        name: 'recipeComplete',
        params: { id: recipeId.value },
        query: {
          title: graph.value?.title ?? 'Recipe',
          steps: String(steps.value.length),
          minutes: String(elapsedMin),
        },
      })
      return
    }

    index.value += 1
  } finally {
    loadingDone.value = false
  }
}
</script>

<template>
  <div class="page">
    <p v-if="err" class="err">{{ err }}</p>
    <div
      v-else-if="pageLoading && !graph"
      class="load-screen"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div class="load-screen__inner">
        <div class="spinner" aria-hidden="true" />
        <h1 class="load-screen__title">Loading guided cooking</h1>
        <p class="load-screen__text">Preparing your steps and kitchen-friendly view. This usually takes a moment.</p>
      </div>
    </div>
    <template v-else-if="graph && current">
      <div
        v-if="checklistConfirmOpen"
        class="checklist-confirm-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Checklist warning"
        @click="closeChecklistConfirm"
      >
        <aside class="checklist-confirm" @click.stop>
          <h3 class="checklist-confirm__title">{{ checklistConfirmTitle }}</h3>
          <p class="checklist-confirm__body">{{ checklistConfirmBody }}</p>
          <div class="checklist-confirm__actions" :class="{ 'checklist-confirm__actions--stack': checklistConfirmHasShoppingList }">
            <button type="button" class="bb-btn bb-btn--secondary" @click="closeChecklistConfirm">Go back</button>
            <button
              v-if="checklistConfirmHasShoppingList"
              type="button"
              class="bb-btn bb-btn--secondary"
              @click="viewShoppingListFromConfirm"
            >
              View shopping list
            </button>
            <button type="button" class="bb-btn bb-btn--primary" @click="proceedChecklistConfirm">Proceed anyway</button>
          </div>
        </aside>
      </div>

      <div
        v-if="shoppingListOpen"
        class="shopping-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Shopping list"
        @click="closeShoppingList"
      >
        <aside class="shopping-modal" @click.stop>
          <header class="shopping-modal__head">
            <div>
              <h3 class="shopping-modal__title">Shopping list</h3>
              <p class="shopping-modal__sub">
                <span v-if="uncheckedIngredientCount > 0">
                  {{ uncheckedIngredientCount }} item{{ uncheckedIngredientCount === 1 ? '' : 's' }} missing
                </span>
                <span v-else>All ingredients are checked.</span>
              </p>
            </div>
            <button type="button" class="shopping-modal__close" @click="closeShoppingList" aria-label="Close shopping list">✕</button>
          </header>

          <div class="shopping-modal__body">
            <template v-if="uncheckedIngredientCount > 0">
              <ul class="shopping-list">
                <template v-for="(group, gi) in uncheckedIngredientChecklistGroups" :key="`${group.sectionKey}-${gi}`">
                  <li v-if="group.sectionTitle" class="shopping-section" role="presentation">
                    <span class="shopping-section__title">{{ formatSectionHeading(group.sectionTitle) }}</span>
                  </li>
                  <li v-for="item in group.items" :key="item.id" class="shopping-row">
                    {{ ingredientChecklistSingleLine(item.label, item.detail) }}
                  </li>
                </template>
              </ul>
            </template>
            <p v-else class="muted">Nothing to buy for this recipe.</p>
          </div>

          <div class="shopping-modal__actions">
            <button type="button" class="bb-btn bb-btn--secondary" @click="closeShoppingList">Close</button>
            <button type="button" class="bb-btn bb-btn--primary" :disabled="uncheckedIngredientCount === 0" @click="exportShoppingListPdf">
              Export to PDF
            </button>
          </div>
        </aside>
      </div>

      <section v-if="journeyPhase === 'getReady'" class="ready-shell">
        <aside class="ready-rail">
          <h2>{{ graph.title }}</h2>
          <p class="ready-rail-meta">{{ recipeMetaLabel }}</p>
          <p class="ready-rail-copy">You'll start cooking after confirming your equipment.</p>
        </aside>

        <article class="card ready">
          <h1 class="ready-title">Get Ready</h1>
          <p class="ready-sub">Gather your tools and equipment before you start cooking. Check each item off when you have it.</p>
          <div class="ready-controls" aria-label="Equipment checklist controls">
            <span class="ready-controls__spacer" />
            <button type="button" class="bb-btn bb-btn--secondary ready-controls__btn" @click="setAllGetReadyChecks(true)">Select all</button>
            <button type="button" class="bb-btn bb-btn--secondary ready-controls__btn" @click="setAllGetReadyChecks(false)">Clear</button>
          </div>
          <ul class="ready-list">
            <li v-for="item in readyItems" :key="item.label">
              <label class="ready-item">
                <span class="ready-item-left">
                  <span class="ready-item-icon" aria-hidden="true">{{ item.icon }}</span>
                  <span>{{ item.label }}</span>
                </span>
                <input v-model="getReadyChecks[item.label]" class="ready-check" type="checkbox" :aria-label="`Ready: ${item.label}`" />
              </label>
            </li>
          </ul>
          <div class="ready-actions">
            <button type="button" class="bb-btn bb-btn--primary guided-btn ready-back-btn" @click="backFromGetReady">Back</button>
            <button type="button" class="bb-btn bb-btn--primary guided-btn ready-main-btn" @click="requestEnterIngredientsPhase">
              Next: Ingredients
            </button>
          </div>
        </article>
      </section>

      <section v-else-if="journeyPhase === 'ingredients'" class="ready-shell">
        <aside class="ready-rail">
          <h2>{{ graph.title }}</h2>
          <p class="ready-rail-meta">{{ recipeMetaLabel }}</p>
          <p class="ready-rail-copy">Quick ingredient check before you start cooking.</p>
        </aside>

        <article class="card ready">
          <h1 class="ready-title">Ingredients Checklist</h1>
          <p class="ready-sub">Check off what you have on hand. This is session-only and won’t be saved.</p>
          <div class="ready-controls" aria-label="Ingredient checklist controls">
            <span class="ready-controls__spacer" />
            <button type="button" class="bb-btn bb-btn--secondary ready-controls__btn" @click="setAllIngredientChecks(true)">Select all</button>
            <button type="button" class="bb-btn bb-btn--secondary ready-controls__btn" @click="setAllIngredientChecks(false)">Clear</button>
          </div>
          <ul class="ready-list">
            <template v-for="(group, gi) in ingredientChecklistGroups" :key="`${group.sectionKey}-${gi}`">
              <li v-if="group.sectionTitle" class="ready-ingredient-section" role="presentation">
                <span class="ready-ingredient-section-title">{{ formatSectionHeading(group.sectionTitle) }}</span>
              </li>
              <li v-for="item in group.items" :key="item.id">
                <label class="ready-item">
                  <span class="ready-item-left">
                    <span class="ready-item-icon ready-item-icon--img" aria-hidden="true">
                      <img
                        v-if="ingredientVisualSrc(item)"
                        class="ready-item-img"
                      :src="ingredientVisualSrc(item)!"
                      :alt="ingredientChecklistSingleLine(item.label, item.detail)"
                      loading="lazy"
                        @error="markBrokenFromImgEvent"
                      />
                      <span v-else>{{ ingredientVisualToken({ label: item.label, emoji: item.emoji ?? undefined, icon: item.icon ?? undefined }) }}</span>
                    </span>
                    <span class="ready-item-copy ready-item-copy--single">
                      <span class="ready-item-line">{{ ingredientChecklistSingleLine(item.label, item.detail) }}</span>
                    </span>
                  </span>
                  <input
                    v-model="ingredientChecks[item.id]"
                    class="ready-check"
                    type="checkbox"
                    :aria-label="`Have ingredient: ${ingredientChecklistSingleLine(item.label, item.detail)}`"
                  />
                </label>
              </li>
            </template>
          </ul>
          <div class="ready-actions">
            <button type="button" class="bb-btn bb-btn--primary guided-btn ready-back-btn" @click="enterGetReadyPhase">Back</button>
            <button
              type="button"
              class="bb-btn bb-btn--secondary guided-btn ready-shop-btn"
              :disabled="uncheckedIngredientCount === 0"
              :aria-disabled="uncheckedIngredientCount === 0 ? 'true' : 'false'"
              @click="uncheckedIngredientCount === 0 ? undefined : openShoppingList()"
            >
              Shopping list{{ uncheckedIngredientCount > 0 ? ` (${uncheckedIngredientCount})` : '' }}
            </button>
            <button type="button" class="bb-btn bb-btn--primary guided-btn ready-main-btn" @click="requestEnterRoadmapPhase">
              Cooking Steps
            </button>
          </div>
        </article>
      </section>

      <section v-else-if="journeyPhase === 'roadmap'" class="card roadmap">
        <h1 class="roadmap-title">Cooking Steps</h1>
        <p class="roadmap-sub">Here is your cooking roadmap.</p>
        <ol class="roadmap-list">
          <li v-for="(step, idx) in steps" :key="step.id" :class="{ active: idx === index }">
            <button type="button" class="roadmap-row" @click="enterStepPhase(idx)">
              <span class="roadmap-index">{{ idx + 1 }}</span>
              <span class="roadmap-label">{{ step.label }}</span>
              <span class="roadmap-icon" aria-hidden="true">{{ step.emoji ?? '•' }}</span>
            </button>
          </li>
        </ol>
        <div class="roadmap-actions">
          <button type="button" class="bb-btn bb-btn--primary guided-btn roadmap-back-btn" @click="enterGetReadyPhase">Back</button>
          <button type="button" class="bb-btn bb-btn--primary guided-btn roadmap-continue-btn" @click="enterStepPhase(index)">Let's start cooking!</button>
        </div>
      </section>

      <section v-else-if="journeyPhase === 'timer'" class="card timer-screen">
        <p class="timer-screen-kicker">Step {{ index + 1 }} of {{ steps.length }}</p>
        <h1 class="timer-screen-title">{{ instructionTitle }}</h1>
        <div class="ring-wrap" role="timer" aria-live="polite">
          <svg viewBox="0 0 280 280" class="ring">
            <circle class="ring-bg" cx="140" cy="140" r="120" />
            <circle class="ring-fg" cx="140" cy="140" r="120" :stroke-dasharray="RING_DASH_ARRAY" :stroke-dashoffset="ringDashOffset" />
          </svg>
          <div class="ring-center">
            <p class="timer-screen-clock">{{ formatClock(remaining) }}</p>
            <p class="timer-screen-remaining">remaining</p>
          </div>
        </div>
        <nav class="timer-screen-actions" aria-label="Timer actions">
          <button
            type="button"
            class="bb-btn bb-btn--primary guided-btn timer-pill-btn"
            @click="timerState === 'running' ? pauseTimer() : startTimer()"
          >
            <span class="timer-pill-ico" aria-hidden="true">⏸</span>
            {{ timerState === 'running' ? 'Pause' : 'Resume' }}
          </button>
          <button type="button" class="bb-btn bb-btn--primary guided-btn timer-pill-btn" @click="skipStepFromTimer">
            <span class="timer-pill-ico" aria-hidden="true">⏭</span>
            Done, let's go to the next step
          </button>
        </nav>
        <button type="button" class="timer-back-link" @click="enterStepPhase(index)">Return to the Step list</button>
      </section>

      <div v-else class="journey journey--focus">
        <article class="card step-card step-card--mockup">
          <div class="seg-progress" role="progressbar" :aria-valuenow="index + 1" :aria-valuemax="steps.length" aria-label="Recipe progress">
            <span
              v-for="i in segmentCount"
              :key="i"
              class="seg-progress__bar"
              :class="{ 'seg-progress__bar--done': i - 1 <= index }"
            />
          </div>
          <header class="step-top-bar">
            <div class="step-kicker-links">
              <button type="button" class="step-kicker-text-link" @click="enterRoadmapPhase">View All Steps</button>
            </div>
            <p class="step-kicker">Step {{ index + 1 }} of {{ steps.length }}</p>
          </header>

          <div class="step-hero" aria-hidden="true">
            <template v-for="(slot, si) in stepVisualSlots" :key="si">
              <span v-if="slot.kind === 'emoji'" class="step-hero__emoji">{{ slot.s }}</span>
              <img v-else class="step-hero__img" :src="slot.src" :alt="slot.alt" loading="lazy" @error="markBrokenFromImgEvent" />
            </template>
          </div>

          <h1 class="step-title step-title--mockup">{{ instructionTitle }}</h1>
          <p v-if="instructionSubtitle" class="step-sub step-sub--mockup">{{ instructionSubtitle }}</p>

          <p class="step-est">
            <span class="step-est__ico" aria-hidden="true">⏱</span>
            Est. time: {{ estimatedMinutes != null ? `${estimatedMinutes} min` : '—' }}
          </p>

          <div class="step-mock-footer">
            <button type="button" class="bb-btn bb-btn--primary guided-btn step-read-btn" @click="speak(instructionText)">
              <span class="step-read-ico" aria-hidden="true">🔊</span>
              Read Aloud
            </button>
            <button type="button" class="bb-btn bb-btn--primary guided-btn step-timer-btn" @click="openTimerPhase">
              Set Timer
              <span class="step-timer-ico" aria-hidden="true">⏱</span>
            </button>
          </div>

          <div v-if="hasConflictWarnings && conflicts" class="warn" role="alert">
            Ingredient checks detected for your profile. Review before continuing.
          </div>
        </article>

        <div class="step-secondary">
          <div class="step-secondary-actions">
            <button type="button" class="bb-btn bb-btn--primary guided-btn step-prev-btn" :disabled="index === 0 || loadingDone" @click="prev">
              Previous Step
            </button>
            <button type="button" class="step-done-bar bb-btn bb-btn--primary guided-btn" :disabled="loadingDone" @click="markStepDoneAndNext">
              {{ loadingDone ? 'Saving…' : (index >= steps.length - 1 ? 'Finish Recipe' : 'Next Step') }}
            </button>
          </div>
        </div>
      </div>
    </template>
    <p v-else-if="graph && !current" class="muted page-muted">This recipe has no steps to guide yet.</p>
    <p v-else-if="!err" class="muted page-muted">Loading…</p>
  </div>
</template>

<style scoped>
.page {
  max-width: 70rem;
  margin: 0 auto;
  padding: 1rem 1.25rem 2rem;
}
.checklist-confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 400;
  display: grid;
  place-items: center;
  padding: 1.25rem;
  background: color-mix(in srgb, var(--bb-bg) 78%, #000 22%);
  backdrop-filter: blur(6px);
}
.checklist-confirm {
  width: min(26rem, 100%);
  background: var(--bb-surface-low);
  border: 1px solid color-mix(in srgb, var(--bb-primary) 14%, transparent);
  border-radius: 18px;
  padding: 1.05rem 1.05rem 0.95rem;
  box-shadow: 0 20px 50px rgba(26, 28, 25, 0.12);
}
.checklist-confirm__title {
  margin: 0;
  font-family: var(--bb-font-headline);
  font-size: 1.05rem;
  font-weight: 900;
  letter-spacing: -0.02em;
  color: var(--bb-text);
}
.checklist-confirm__body {
  margin: 0.5rem 0 0;
  color: var(--bb-muted);
  line-height: 1.55;
  font-size: 0.92rem;
}
.checklist-confirm__actions {
  margin-top: 0.85rem;
  display: flex;
  gap: 0.6rem;
  justify-content: flex-end;
  flex-wrap: nowrap;
}
.checklist-confirm__actions .bb-btn {
  flex: 1 1 0;
  min-width: 0;
  white-space: nowrap;
}
.checklist-confirm__actions--stack {
  flex-direction: column;
  align-items: stretch;
  flex-wrap: nowrap;
}
.checklist-confirm__actions--stack .bb-btn {
  width: 100%;
  flex: 0 0 auto;
  white-space: normal;
}
.ready-controls {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin: 0.75rem 0 0.75rem;
}
.ready-controls__btn {
  padding: 0.55rem 0.75rem;
}
.ready-controls__spacer {
  flex: 1 1 auto;
}
.shopping-overlay {
  position: fixed;
  inset: 0;
  z-index: 410;
  display: grid;
  place-items: center;
  padding: 1.25rem;
  background: color-mix(in srgb, var(--bb-bg) 78%, #000 22%);
  backdrop-filter: blur(6px);
}
.shopping-modal {
  width: min(34rem, 100%);
  background: var(--bb-surface-low);
  border: 1px solid color-mix(in srgb, var(--bb-primary) 14%, transparent);
  border-radius: 18px;
  padding: 1.05rem 1.05rem 0.95rem;
  box-shadow: 0 20px 50px rgba(26, 28, 25, 0.12);
  max-height: min(80vh, 46rem);
  display: flex;
  flex-direction: column;
}
.shopping-modal__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}
.shopping-modal__title {
  margin: 0;
  font-family: var(--bb-font-headline);
  font-size: 1.05rem;
  font-weight: 900;
  letter-spacing: -0.02em;
  color: var(--bb-text);
}
.shopping-modal__sub {
  margin: 0.35rem 0 0;
  color: var(--bb-muted);
  line-height: 1.45;
  font-size: 0.92rem;
}
.shopping-modal__close {
  border: none;
  background: transparent;
  color: var(--bb-muted);
  font-size: 1.1rem;
  line-height: 1;
  padding: 0.25rem;
  cursor: pointer;
}
.shopping-modal__body {
  margin-top: 0.75rem;
  overflow: auto;
  padding-right: 0.25rem;
}
.shopping-modal__actions {
  margin-top: 0.85rem;
  display: flex;
  gap: 0.6rem;
  justify-content: flex-end;
  flex-wrap: nowrap;
}
.shopping-modal__actions .bb-btn {
  flex: 1 1 0;
  min-width: 0;
  white-space: nowrap;
}
.shopping-list {
  margin: 0;
  padding-left: 1.15rem;
}
.shopping-section {
  list-style: none;
  margin: 0.9rem 0 0.35rem;
  padding: 0;
}
.shopping-section__title {
  display: inline-block;
  font-weight: 800;
  color: var(--bb-text);
}
.shopping-row {
  margin: 0.35rem 0;
  color: var(--bb-text);
}
.err {
  color: #b91c1c;
}
.muted {
  color: var(--bb-muted);
}
.page-muted {
  text-align: center;
  padding: 2rem 1rem;
}
.load-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 50vh;
  padding: 2rem 1rem;
}
.load-screen__inner {
  max-width: 22rem;
  text-align: center;
}
.load-screen__title {
  margin: 1rem 0 0;
  font-family: var(--bb-font-headline);
  font-size: 1.35rem;
  font-weight: 900;
  color: var(--bb-text);
}
.load-screen__text {
  margin: 0.5rem 0 0;
  font-size: 0.95rem;
  line-height: 1.55;
  color: var(--bb-muted);
}
.spinner {
  width: 44px;
  height: 44px;
  margin: 0 auto;
  border: 3px solid color-mix(in srgb, var(--bb-muted) 25%, transparent);
  border-top-color: var(--bb-primary);
  border-radius: 50%;
  animation: guided-spin 0.75s linear infinite;
}
@keyframes guided-spin {
  to {
    transform: rotate(360deg);
  }
}
.journey {
  display: grid;
  gap: 1rem;
}
.journey--focus {
  max-width: 28rem;
  margin: 0 auto;
}
/* Same surface + border as global .bb-btn; same corner radius across guided CTAs */
.guided-btn {
  border-radius: 12px;
}
.card {
  background: var(--bb-surface-low);
  border: 1px solid var(--bb-border);
  border-radius: 16px;
  box-shadow: 0 12px 30px rgba(26, 28, 25, 0.04);
}
.step-card {
  padding: 1rem;
}
.step-card--mockup {
  padding: 1.15rem 1.1rem 1.25rem;
}
.seg-progress {
  display: flex;
  gap: 0.35rem;
  margin: 0 0 0.75rem;
}
.seg-progress__bar {
  flex: 1;
  height: 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bb-muted) 18%, var(--bb-border));
}
.seg-progress__bar--done {
  background: #16a34a;
}
.step-top-bar {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.85rem;
  min-height: 2.5rem;
}
.step-kicker {
  margin: 0;
  min-width: 0;
  justify-self: center;
  white-space: nowrap;
  text-align: center;
  color: #16a34a;
  font-weight: 700;
  font-size: 0.92rem;
}
.step-kicker-links {
  flex: none;
  display: flex;
  flex-wrap: nowrap;
  gap: 0.4rem;
  justify-content: flex-start;
}
.step-kicker-text-link {
  flex: none;
  margin: 0;
  padding: 0.2rem 0;
  border: none;
  background: none;
  color: var(--bb-muted);
  font-size: 0.86rem;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 0.15em;
  cursor: pointer;
}
.step-kicker-text-link:hover {
  color: var(--bb-text);
}
.step-hero {
  min-height: 176px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--bb-muted) 10%, var(--bb-surface-high));
  border: 1px solid var(--bb-border);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.65rem;
  flex-wrap: wrap;
  padding: 1rem;
  margin: 0 0 1rem;
}
.step-hero__emoji {
  font-size: 3rem;
  line-height: 1;
}
.step-hero__img {
  width: 88px;
  height: 88px;
  border-radius: 12px;
  object-fit: cover;
  background: var(--bb-surface-lowest);
}
.step-title {
  margin: 0;
  font-family: var(--bb-font-headline);
  font-size: clamp(1.7rem, 3.2vw, 2.6rem);
  line-height: 1.2;
}
.step-title--mockup {
  color: var(--bb-text);
  font-size: clamp(1.45rem, 4vw, 2rem);
}
.step-sub {
  margin: 0.4rem 0 0;
  color: var(--bb-muted);
  font-size: 1.05rem;
}
.step-sub--mockup {
  margin-top: 0.5rem;
  color: color-mix(in srgb, var(--bb-text) 75%, var(--bb-muted));
  font-size: 1rem;
  line-height: 1.45;
}
.step-est {
  margin: 1rem 0 0;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--bb-muted);
  font-size: 0.88rem;
}
.step-est__ico {
  opacity: 0.85;
  font-size: 0.95rem;
}
.step-mock-footer {
  margin-top: 1.35rem;
  display: flex;
  gap: 0.65rem;
  align-items: stretch;
}
.step-read-btn {
  flex: 0 0 auto;
  min-width: 5.5rem;
  padding: 0.65rem 0.95rem;
  font-weight: 600;
  font-size: 0.95rem;
}
.step-timer-btn {
  flex: 0 0 auto;
  min-width: 8.2rem;
  padding: 0.62rem 0.85rem;
  font-weight: 700;
  font-size: 0.92rem;
}
.step-timer-ico {
  font-size: 0.95rem;
  opacity: 0.95;
}
.step-secondary {
  padding: 0.35rem 0.15rem 0.5rem;
  display: grid;
  gap: 0.65rem;
}
.step-secondary-actions {
  display: flex;
  gap: 0.6rem;
  align-items: center;
}
.step-prev-btn {
  flex: 0 0 auto;
  min-width: 8.5rem;
  justify-content: center;
  padding: 0.82rem 1rem;
  font-weight: 700;
  font-size: 0.96rem;
}
.step-done-bar {
  flex: 1;
  min-width: 10rem;
  justify-content: center;
  padding: 0.82rem 1rem;
  font-weight: 800;
  font-size: 1.02rem;
}
.warn {
  margin-top: 0.7rem;
  border-radius: 10px;
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #991b1b;
  font-size: 0.85rem;
  padding: 0.55rem 0.7rem;
}
.ready,
.paused {
  padding: 1rem;
}
.ready-shell {
  display: grid;
  grid-template-columns: 230px 1fr;
  gap: 1rem;
  max-width: 58rem;
  margin: 0 auto;
}
.ready-rail {
  background: color-mix(in srgb, var(--bb-surface-low) 72%, #f4f4f5);
  border: 1px solid var(--bb-border);
  border-radius: 14px;
  padding: 0.95rem 0.85rem;
}
.ready-rail h2 {
  margin: 0;
  font-family: var(--bb-font-headline);
  font-size: 1.25rem;
}
.ready-rail-meta {
  margin: 0.2rem 0 0;
  color: var(--bb-muted);
  font-size: 0.86rem;
}
.ready-rail-copy {
  margin: 1.2rem 0 0;
  color: var(--bb-muted);
  font-size: 0.88rem;
  line-height: 1.5;
}
.ready-title,
.paused-title {
  margin: 0;
  font-family: var(--bb-font-headline);
  font-size: 2rem;
}
.ready-sub,
.paused-copy {
  margin: 0.6rem 0 0;
  color: var(--bb-muted);
}
.ready-list {
  list-style: none;
  margin: 1rem 0 0;
  padding: 0;
  display: grid;
  gap: 0.6rem;
}
.ready-ingredient-section {
  list-style: none;
  margin: 0;
  padding: 0.85rem 0 0.15rem;
  grid-column: 1 / -1;
}
.ready-ingredient-section:first-child {
  padding-top: 0;
}
.ready-ingredient-section-title {
  display: block;
  font-family: var(--bb-font-headline);
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--bb-text, inherit);
  letter-spacing: 0.01em;
}
.ready-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 1px solid var(--bb-border);
  border-radius: 12px;
  padding: 0.72rem 0.78rem;
  background: var(--bb-surface-lowest);
}
.ready-item-left {
  display: inline-flex;
  align-items: center;
  gap: 0.52rem;
  font-weight: 600;
}
.ready-item-copy {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}
.ready-item-copy--single {
  gap: 0;
}
.ready-item-line {
  min-width: 0;
  overflow-wrap: anywhere;
  font-weight: 600;
  font-size: 0.92rem;
  line-height: 1.35;
  color: var(--bb-text, inherit);
}
.ready-item-title {
  min-width: 0;
  overflow-wrap: anywhere;
}
.ready-item-detail {
  font-weight: 500;
  font-size: 0.82rem;
  color: var(--bb-muted);
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.ready-item-icon {
  width: 42px;
  height: 42px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--bb-muted) 14%, var(--bb-surface-high));
  font-size: 1.05rem;
}
.ready-item-icon--img {
  overflow: hidden;
}
.ready-item-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.ready-check {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  accent-color: #3fbf7f;
}
.ready-actions,
.paused-actions {
  margin-top: 1rem;
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  align-items: center;
}
.ready-back-btn {
  min-width: 5.5rem;
  font-weight: 700;
}
.ready-shop-btn {
  min-width: 10rem;
  font-weight: 800;
  flex: 1 1 10rem;
}
.ready-main-btn {
  min-width: 10rem;
  font-weight: 800;
  flex: 1 1 12rem;
}
.roadmap {
  padding: 1rem 1.1rem;
}
.roadmap-title {
  margin: 0;
  font-family: var(--bb-font-headline);
  font-size: clamp(1.8rem, 3vw, 2.4rem);
}
.roadmap-sub {
  margin: 0.45rem 0 0;
  color: var(--bb-muted);
}
.roadmap-list {
  margin: 1rem 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0.5rem;
}
.roadmap-row {
  width: 100%;
  border: none;
  background: transparent;
  padding: 0.45rem 0.2rem;
  display: flex;
  align-items: center;
  gap: 0.8rem;
  cursor: pointer;
  border-radius: 10px;
  color: var(--bb-text);
}
.roadmap-row:hover {
  background: color-mix(in srgb, var(--bb-primary) 10%, transparent);
}
.roadmap-row:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--bb-surface), 0 0 0 4px var(--bb-focus-ring);
}
.roadmap-list li.active .roadmap-row {
  background: color-mix(in srgb, var(--bb-primary) 12%, transparent);
}
.roadmap-index {
  width: 34px;
  height: 34px;
  border-radius: 999px;
  border: 2px solid color-mix(in srgb, var(--bb-muted) 30%, transparent);
  display: grid;
  place-items: center;
  font-weight: 700;
  color: var(--bb-muted);
}
.roadmap-list li.active .roadmap-index {
  border-color: var(--bb-primary);
  background: var(--bb-primary);
  color: #fff;
}
.roadmap-label {
  flex: 1;
  text-align: left;
  font-size: 1.02rem;
  font-weight: 700;
}
.roadmap-icon {
  font-size: 1.45rem;
}
.roadmap-actions {
  margin-top: 1rem;
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  align-items: center;
}
.roadmap-back-btn {
  min-width: 5.5rem;
  font-weight: 700;
}
.roadmap-continue-btn {
  min-width: 160px;
  font-weight: 800;
  flex: 1 1 12rem;
}
.timer-screen {
  padding: 1.25rem 1rem 1.5rem;
  text-align: center;
  max-width: 28rem;
  margin: 0 auto;
}
.timer-screen-kicker {
  margin: 0;
  color: var(--bb-muted);
  font-size: 0.88rem;
  font-weight: 600;
}
.timer-screen-title {
  margin: 0.5rem 0 1.25rem;
  font-family: var(--bb-font-headline);
  font-size: clamp(1.7rem, 3vw, 2.5rem);
  color: var(--bb-text);
}
.ring-wrap {
  position: relative;
  width: 280px;
  height: 280px;
  margin: 0 auto;
}
.ring {
  width: 280px;
  height: 280px;
}
.ring-bg,
.ring-fg {
  fill: none;
  stroke-width: 10;
}
.ring-bg {
  stroke: color-mix(in srgb, var(--bb-muted) 20%, transparent);
}
.ring-fg {
  stroke: #16a34a;
  stroke-linecap: round;
  transform: rotate(-90deg);
  transform-origin: 50% 50%;
  transition: stroke-dashoffset 0.35s linear;
}
.ring-center {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
}
.timer-screen-clock {
  margin: 0;
  font-family: var(--bb-font-headline);
  font-size: clamp(2rem, 6vw, 3.2rem);
  font-weight: 800;
  color: var(--bb-text);
}
.timer-screen-remaining {
  margin: 0.35rem 0 0;
  color: var(--bb-muted);
  font-size: 0.92rem;
}
.timer-screen-actions {
  margin-top: 1.35rem;
  display: flex;
  justify-content: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.timer-pill-btn {
  gap: 0.45rem;
  padding: 0.85rem 1.15rem;
  font-weight: 700;
  font-size: 0.95rem;
  min-width: 7.5rem;
}
.timer-pill-ico {
  font-size: 0.85rem;
  opacity: 0.9;
}
.timer-back-link {
  margin-top: 1rem;
  background: none;
  border: none;
  color: var(--bb-muted);
  font-size: 0.86rem;
  text-decoration: underline;
  cursor: pointer;
}
.timer-back-link:hover {
  color: var(--bb-text);
}
@media (max-width: 840px) {
  .ready-shell {
    grid-template-columns: 1fr;
    gap: 0.3rem;
  }
  .step-kicker {
    justify-self: center;
  }
  .step-kicker-links {
    justify-self: start;
    gap: 0.4rem 0.75rem;
  }
  .step-secondary-actions {
    flex-direction: column;
  }
  .step-prev-btn,
  .step-done-bar {
    width: 100%;
  }
}
@media (min-width: 768px) and (max-width: 1023px) {
  .journey--focus {
    max-width: 34rem;
  }
  .timer-screen {
    max-width: 34rem;
  }
  .ready-shell {
    max-width: 62rem;
    grid-template-columns: 240px 1fr;
    gap: 1.1rem;
  }
}
@media (min-width: 1024px) {
  .journey--focus {
    max-width: 40rem;
  }
  .step-top-bar {
    grid-template-columns: 1fr;
    gap: 0.3rem;
  }
  .step-kicker {
    justify-self: center;
  }
  .step-kicker-links {
    justify-self: start;
    gap: 0.4rem 0.75rem;
  }
  .step-secondary-actions {
    flex-direction: column;
  }
  .step-prev-btn,
  .step-done-bar {
    width: 100%;
  }
}
@media (min-width: 768px) and (max-width: 1023px) {
  .journey--focus {
    max-width: 34rem;
  }
  .timer-screen {
    max-width: 34rem;
  }
  .ready-shell {
    max-width: 62rem;
    grid-template-columns: 240px 1fr;
    gap: 1.1rem;
  }
}
@media (min-width: 1024px) {
  .journey--focus {
    max-width: 40rem;
  }
  .timer-screen {
    max-width: 40rem;
  }
  .ready-shell {
    max-width: 66rem;
    grid-template-columns: 260px 1fr;
    gap: 1.2rem;
  }
}
</style>

