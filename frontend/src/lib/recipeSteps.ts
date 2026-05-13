import type { RecipeGraph, RecipeNode } from '../types/recipe'

const STEP_HEADING_RX = /^step\s*\d+$/i

function isStepNode(node: RecipeNode): boolean {
  return node.type !== 'ingredient'
}

const TRIVIAL_HEADING_DETAIL_MAX_LENGTH = 12

function isTrivialStepHeading(node: RecipeNode): boolean {
  const label = node.label.trim()
  if (!STEP_HEADING_RX.test(label)) return false
  const detail = node.detail.trim()
  if (detail === label) return true
  if (detail.length === 0) return true
  if (detail.length <= TRIVIAL_HEADING_DETAIL_MAX_LENGTH && STEP_HEADING_RX.test(detail)) return true
  return false
}

function nodeIndexOrder(graph: RecipeGraph): Map<string, number> {
  const indexById = new Map<string, number>()
  graph.nodes.forEach((node, nodeIndex) => indexById.set(node.id, nodeIndex))
  return indexById
}

/**
 * Cook-order step list: topological sort on `requires` edges among non-ingredient nodes,
 * then drop LLM-style "Step 1" heading-only nodes. Falls back to graph node order.
 */
export function getOrderedRecipeSteps(graph: RecipeGraph): RecipeNode[] {
  const stepNodes = graph.nodes.filter(isStepNode)
  if (!stepNodes.length) return []

  const stepIds = new Set(stepNodes.map((node) => node.id))
  const indexOrder = nodeIndexOrder(graph)

  const adjacency = new Map<string, string[]>()
  const inDegree = new Map<string, number>()
  for (const stepId of stepIds) {
    adjacency.set(stepId, [])
    inDegree.set(stepId, 0)
  }
  for (const edge of graph.edges) {
    if (edge.type !== 'requires') continue
    if (!stepIds.has(edge.source) || !stepIds.has(edge.target)) continue
    adjacency.get(edge.source)!.push(edge.target)
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
  }

  const ready = [...stepIds].filter((stepId) => inDegree.get(stepId) === 0)
  ready.sort((leftId, rightId) => (indexOrder.get(leftId) ?? 0) - (indexOrder.get(rightId) ?? 0))

  const orderedIds: string[] = []
  while (ready.length) {
    const currentId = ready.shift()!
    orderedIds.push(currentId)
    for (const neighbourId of adjacency.get(currentId) ?? []) {
      const remaining = (inDegree.get(neighbourId) ?? 0) - 1
      inDegree.set(neighbourId, remaining)
      if (remaining === 0) {
        ready.push(neighbourId)
        ready.sort((leftId, rightId) => (indexOrder.get(leftId) ?? 0) - (indexOrder.get(rightId) ?? 0))
      }
    }
  }

  const nodeById = new Map(stepNodes.map((node) => [node.id, node]))
  let sequence: RecipeNode[]
  if (orderedIds.length === stepIds.size) {
    sequence = orderedIds.map((stepId) => nodeById.get(stepId)!).filter(Boolean)
  } else {
    sequence = [...stepNodes].sort(
      (leftNode, rightNode) =>
        (indexOrder.get(leftNode.id) ?? 0) - (indexOrder.get(rightNode.id) ?? 0),
    )
  }

  return sequence.filter((node) => !isTrivialStepHeading(node))
}
