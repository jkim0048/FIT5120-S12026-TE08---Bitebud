import dagre from 'dagre'
import type { Edge, Node } from '@vue-flow/core'
import type { RecipeGraph } from '../types/recipe'

const NODE_W = 200
const NODE_H = 72
const LANE_X_SPACING = 280

/**
 * Convert a parsed `RecipeGraph` into Vue Flow nodes and edges with computed positions.
 *
 * Highlights any `activeLane` selection by muting non-matching step nodes, and marks completed
 * step nodes using the `completed` set. Ingredient nodes are placed in the leftmost lane (column 0).
 */
export function graphToFlowElements(
  graph: RecipeGraph,
  completed: Set<string>,
  activeLane?: string | null,
): { nodes: Node[]; edges: Edge[] } {
  const lanes = [
    ...new Set(
      graph.nodes
        .filter((node) => node.type !== 'ingredient' && node.lane)
        .map((node) => node.lane as string),
    ),
  ]
  const laneX = new Map<string, number>(lanes.map((laneName, laneIndex) => [laneName, laneIndex + 1]))
  const nodes: Node[] = graph.nodes.map((node) => {
    const isIngredient = node.type === 'ingredient'
    const vfType = isIngredient ? 'ingredient' : 'step'
    const laneIndex =
      node.type === 'ingredient' ? 0 : laneX.get(node.lane ?? '') ?? 1
    const muted =
      Boolean(activeLane) &&
      node.type !== 'ingredient' &&
      (node.lane ?? 'No lane') !== activeLane
    return {
      id: node.id,
      type: vfType,
      position: { x: 0, y: 0 },
      data: {
        label: node.label,
        detail: node.detail,
        emoji: node.emoji ?? '•',
        timeMinutes: node.timeMinutes,
        lane: node.lane,
        laneIndex,
        stepType: node.type,
        iconId: node.icon,
        muted,
        completed: completed.has(node.id) && !isIngredient,
      },
    }
  })

  const edges: Edge[] = graph.edges.map((edge, edgeIndex) => ({
    id: `e-${edge.source}-${edge.target}-${edgeIndex}`,
    source: edge.source,
    target: edge.target,
    label: edge.type === 'uses' ? 'uses' : undefined,
    animated: edge.type === 'requires',
    style: { stroke: edge.type === 'uses' ? '#94a3b8' : '#57534e' },
  }))

  layoutWithDagre(nodes, edges, laneX)
  return { nodes, edges }
}

function layoutWithDagre(
  nodes: Node[],
  edges: Edge[],
  laneX: Map<string, number>,
): void {
  const graphLayout = new dagre.graphlib.Graph()
  graphLayout.setDefaultEdgeLabel(() => ({}))
  graphLayout.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 56, marginx: 20, marginy: 20 })
  for (const node of nodes) {
    graphLayout.setNode(node.id, { width: NODE_W, height: NODE_H })
  }
  for (const edge of edges) {
    graphLayout.setEdge(edge.source, edge.target)
  }
  dagre.layout(graphLayout)
  for (const node of nodes) {
    const position = graphLayout.node(node.id)
    if (position) {
      const lane = (node.data?.lane as string | undefined) ?? ''
      const laneIndex =
        node.type === 'ingredient' ? 0 : laneX.get(lane) ?? 1
      node.position = {
        x: laneIndex * LANE_X_SPACING + (position.x % 20) - NODE_W / 2,
        y: position.y - NODE_H / 2,
      }
    }
  }
}
