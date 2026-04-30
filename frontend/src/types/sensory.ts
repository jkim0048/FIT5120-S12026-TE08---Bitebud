export type SensoryFoodStatus = 'SAFE' | 'UNSURE' | 'UNSAFE'

export type SensoryFoodNotes = {
  texture?: string
  smell?: string
  temperature?: string
  /** Set when the item was chosen from `ingredient_icon_map` (legacy). */
  ingredientKey?: string
  /** Set when the item was chosen from `wicked_icons` (Wicked picker). */
  wickedIconId?: string
}

export type SensoryFoodItemDTO = {
  id: string
  name: string
  status: SensoryFoodStatus
  notes: SensoryFoodNotes
}

export type SensoryProfileFields = {
  texturePrefs: string[]
  dietaryNeeds: string[]
  culturalRequirements: string[]
  /** Derived from foodItems when present, else legacy JSON arrays. */
  safeFoods: string[]
  unsafeFoods: string[]
  sometimesFoods: string[]
  foodItems: SensoryFoodItemDTO[]
}

export type SensoryConflictResponse = {
  hasProfile: boolean
  sensory: Array<{
    nodeId: string
    label: string
    kind: 'unsafe' | 'unsure'
    matchedFood: string
  }>
  dietary: Array<{
    nodeId: string
    label: string
    constraint: string
    kind: 'dietary' | 'cultural'
  }>
  disclaimer?: string
}
