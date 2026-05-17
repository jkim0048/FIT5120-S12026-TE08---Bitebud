/** Maps server toast keys to calm, short copy (Epic 7). */
export function motivationToastText(key: string | null): string {
  if (!key) return ''
  switch (key) {
    case 'recipe_done':
      return 'You cooked something today. That matters.'
    case 'review_helpful':
      return 'Your review helps you find comfortable places next time.'
    case 'streak_three':
      return 'Three days in a row. You are building something.'
    default:
      return ''
  }
}
