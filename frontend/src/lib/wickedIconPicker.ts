import { apiFetch } from './api'

export type WickedPickerItem = {
  wickedIconId: string
  label: string
  hint: string
  /** CDN URL from DB; prefer `/api/icons/wicked/${wickedIconId}` in UI so the backend can proxy or serve `asset`. */
  imageUrl: string | null
}

/** All `wicked_icons` for Food Safety Tags; backend fills/updates rows from food.getwicked.app when needed. */
export async function fetchWickedPickerItems(): Promise<WickedPickerItem[]> {
  const res = await apiFetch<{ items: WickedPickerItem[] }>('/api/icons/wicked-picker')
  return res.items ?? []
}
