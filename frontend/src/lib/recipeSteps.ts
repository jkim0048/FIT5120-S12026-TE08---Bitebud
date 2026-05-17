import type { RecipeGraph, RecipeNode } from '../types/recipe'

const STEP_HEADING_RX = /^step\s*\d+$/i

function isStepNode(n: RecipeNode): boolean {
  return n.type !== 'ingredient'
}

function isTrivialStepHeading(n: RecipeNode): boolean {
  const lab = n.label.trim()
  if (!STEP_HEADING_RX.test(lab)) return false
  const det = n.detail.trim()
  if (det === lab) return true
  if (det.length === 0) return true
  if (det.length <= 12 && STEP_HEADING_RX.test(det)) return true
  return false
}

function nodeIndexOrder(graph: RecipeGraph): Map<string, number> {
  const m = new Map<string, number>()
  graph.nodes.forEach((n, i) => m.set(n.id, i))
  return m
}

/**
 * Cook-order step list: topological sort on `requires` edges among non-ingredient nodes,
 * then drop LLM-style "Step 1" heading-only nodes. Falls back to graph node order.
 */
export function getOrderedRecipeSteps(graph: RecipeGraph): RecipeNode[] {
  const stepNodes = graph.nodes.filter(isStepNode)
  if (!stepNodes.length) return []

  const stepIds = new Set(stepNodes.map((n) => n.id))
  const indexOrder = nodeIndexOrder(graph)

  const adj = new Map<string, string[]>()
  const inDeg = new Map<string, number>()
  for (const id of stepIds) {
    adj.set(id, [])
    inDeg.set(id, 0)
  }
  for (const e of graph.edges) {
    if (e.type !== 'requires') continue
    if (!stepIds.has(e.source) || !stepIds.has(e.target)) continue
    adj.get(e.source)!.push(e.target)
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1)
  }

  const ready = [...stepIds].filter((id) => inDeg.get(id) === 0)
  ready.sort((a, b) => (indexOrder.get(a) ?? 0) - (indexOrder.get(b) ?? 0))

  const ordered: string[] = []
  while (ready.length) {
    const u = ready.shift()!
    ordered.push(u)
    for (const v of adj.get(u) ?? []) {
      const next = (inDeg.get(v) ?? 0) - 1
      inDeg.set(v, next)
      if (next === 0) {
        ready.push(v)
        ready.sort((a, b) => (indexOrder.get(a) ?? 0) - (indexOrder.get(b) ?? 0))
      }
    }
  }

  const byId = new Map(stepNodes.map((n) => [n.id, n]))
  let sequence: RecipeNode[]
  if (ordered.length === stepIds.size) {
    sequence = ordered.map((id) => byId.get(id)!).filter(Boolean)
  } else {
    sequence = [...stepNodes].sort((a, b) => (indexOrder.get(a.id) ?? 0) - (indexOrder.get(b.id) ?? 0))
  }

  return sequence.filter((n) => !isTrivialStepHeading(n))
}
