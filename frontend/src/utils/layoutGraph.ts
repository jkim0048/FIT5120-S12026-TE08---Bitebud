import dagre from 'dagre'
import type { Edge, Node } from '@vue-flow/core'
import type { RecipeGraph } from '../types/recipe'

const NODE_W = 200
const NODE_H = 72

export function graphToFlowElements(
  graph: RecipeGraph,
  completed: Set<string>,
  activeLane?: string | null,
): { nodes: Node[]; edges: Edge[] } {
  const lanes = [
    ...new Set(
      graph.nodes
        .filter((n) => n.type !== 'ingredient' && n.lane)
        .map((n) => n.lane as string),
    ),
  ]
  const laneX = new Map<string, number>(lanes.map((l, i) => [l, i + 1]))
  const nodes: Node[] = graph.nodes.map((n) => {
    const isIngredient = n.type === 'ingredient'
    const vfType = isIngredient ? 'ingredient' : 'step'
    const laneIndex =
      n.type === 'ingredient' ? 0 : laneX.get(n.lane ?? '') ?? 1
    const muted =
      Boolean(activeLane) &&
      n.type !== 'ingredient' &&
      (n.lane ?? 'No lane') !== activeLane
    return {
      id: n.id,
      type: vfType,
      position: { x: 0, y: 0 },
      data: {
        label: n.label,
        detail: n.detail,
        emoji: n.emoji ?? '•',
        timeMinutes: n.timeMinutes,
        lane: n.lane,
        laneIndex,
        stepType: n.type,
        iconId: n.icon,
        muted,
        completed: completed.has(n.id) && !isIngredient,
      },
    }
  })

  const edges: Edge[] = graph.edges.map((e, i) => ({
    id: `e-${e.source}-${e.target}-${i}`,
    source: e.source,
    target: e.target,
    label: e.type === 'uses' ? 'uses' : undefined,
    animated: e.type === 'requires',
    style: { stroke: e.type === 'uses' ? '#94a3b8' : '#57534e' },
  }))

  layoutWithDagre(nodes, edges, laneX)
  return { nodes, edges }
}

function layoutWithDagre(
  nodes: Node[],
  edges: Edge[],
  laneX: Map<string, number>,
): void {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 56, marginx: 20, marginy: 20 })
  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_W, height: NODE_H })
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target)
  }
  dagre.layout(g)
  for (const n of nodes) {
    const p = g.node(n.id)
    if (p) {
      const lane = (n.data?.lane as string | undefined) ?? ''
      const laneIndex =
        n.type === 'ingredient' ? 0 : laneX.get(lane) ?? 1
      n.position = {
        x: laneIndex * 280 + (p.x % 20) - NODE_W / 2,
        y: p.y - NODE_H / 2,
      }
    }
  }
}
