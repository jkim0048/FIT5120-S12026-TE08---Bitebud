export type RecipeNodeType =
  | 'ingredient'
  | 'prep'
  | 'cook'
  | 'wait'
  | 'assemble'
  | 'serve'

export type RecipeEdgeType = 'requires' | 'uses'

export interface RecipeNode {
  id: string
  type: RecipeNodeType
  label: string
  detail: string
  emoji?: string
  lane?: string | null
  timeMinutes?: number | null
  ingredientIds?: string[]
  icon?: string
  imageUrl?: string
}

export interface RecipeEdge {
  source: string
  target: string
  type: RecipeEdgeType
}

export interface RecipeGraph {
  id?: string
  title: string
  sourceUrl?: string | null
  heroImageUrl?: string | null
  totalTimeMinutes?: number | null
  servings?: number | null
  nodes: RecipeNode[]
  edges: RecipeEdge[]
}
