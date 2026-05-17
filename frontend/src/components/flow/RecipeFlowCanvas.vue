<script setup lang="ts">
import { computed, markRaw } from 'vue'
import type { NodeMouseEvent, NodeTypesObject } from '@vue-flow/core'
import { VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import IngredientNode from './IngredientNode.vue'
import StepNode from './StepNode.vue'
import type { RecipeGraph } from '../../types/recipe'
import { graphToFlowElements } from '../../utils/layoutGraph'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

const props = defineProps<{
  graph: RecipeGraph
  completedNodeIds: string[]
  activeLane?: string | null
}>()

const emit = defineEmits<{
  selectStep: [payload: { id: string; label: string; detail: string; ingredientLabels: string[] }]
}>()

const nodeTypes = {
  ingredient: markRaw(IngredientNode),
  step: markRaw(StepNode),
} as unknown as NodeTypesObject

const completedSet = computed(
  () => new Set(props.completedNodeIds),
)

const layout = computed(() =>
  graphToFlowElements(props.graph, completedSet.value, props.activeLane),
)
const nodes = computed(() => layout.value.nodes)
const edges = computed(() => layout.value.edges)

function onNodeClick(ev: NodeMouseEvent) {
  const node = ev.node
  if (node.type !== 'step') return
  const step = props.graph.nodes.find((n) => n.id === node.id)
  if (!step) return
  const ids = step.ingredientIds ?? []
  const labels = ids
    .map((id) => props.graph.nodes.find((n) => n.id === id)?.label)
    .filter(Boolean) as string[]
  emit('selectStep', {
    id: node.id,
    label: step.label,
    detail: step.detail,
    ingredientLabels: labels,
  })
}
</script>

<template>
  <div class="canvas-wrap">
    <VueFlow
      :key="graph.id ?? graph.title"
      :nodes="nodes"
      :edges="edges"
      :node-types="nodeTypes"
      fit-view-on-init
      :min-zoom="0.4"
      :max-zoom="1.4"
      class="flow"
      @node-click="onNodeClick"
    >
      <Background pattern-color="#e7e5e4" :gap="16" />
      <Controls />
    </VueFlow>
  </div>
</template>

<style scoped>
.canvas-wrap {
  height: min(72vh, 820px);
  width: 100%;
  border: 1px solid var(--bb-border);
  border-radius: 12px;
  overflow: hidden;
  background: #fafafa;
}
.flow {
  width: 100%;
  height: 100%;
}
</style>
