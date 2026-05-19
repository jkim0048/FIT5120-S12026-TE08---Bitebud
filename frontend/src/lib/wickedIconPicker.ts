import { apiFetch } from './api'

export type WickedPickerItem = {
  wickedIconId: string
  label: string
  hint: string
  /** CDN URL from DB; prefer `/api/icons/wicked/${wickedIconId}` in UI so the backend can proxy or serve `asset`. */
  imageUrl: string | null
}

type WickedPickerApiRow = {
  wickedIconId: string
  label: string
  hint: string
  imageUrl: string | null
}

function normalizePickerRows(items: WickedPickerApiRow[] | undefined): WickedPickerItem[] {
  return (items ?? []).map((row) => ({
    wickedIconId: row.wickedIconId,
    label: row.label,
    hint: row.hint,
    imageUrl: row.imageUrl,
  }))
}

/** Fast typeahead search against wicked_icons (use instead of loading the full catalog). */
export async function searchWickedPickerItems(query: string, limit = 15): Promise<WickedPickerItem[]> {
  const q = query.trim()
  if (!q) return []
  const params = new URLSearchParams({ query: q, limit: String(limit) })
  const res = await apiFetch<{ items: WickedPickerApiRow[] }>(`/api/icons/wicked-picker/search?${params}`)
  return normalizePickerRows(res.items)
}

/** Resolve one icon id to a picker row (primary-key lookup on the server). */
export async function fetchWickedPickerItemById(wickedIconId: string): Promise<WickedPickerItem | null> {
  const id = wickedIconId.trim()
  if (!id) return null
  const items = await searchWickedPickerItems(id, 5)
  return items.find((item) => item.wickedIconId === id) ?? items[0] ?? null
}

/** All `wicked_icons` for Food Safety Tags; prefer `searchWickedPickerItems` for the search box. */
export async function fetchWickedPickerItems(): Promise<WickedPickerItem[]> {
  const res = await apiFetch<{ items: WickedPickerApiRow[] }>('/api/icons/wicked-picker')
  return normalizePickerRows(res.items)
}
