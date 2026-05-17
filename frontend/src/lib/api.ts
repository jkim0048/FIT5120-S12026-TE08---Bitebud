/** Production: set VITE_API_ORIGIN to Cloud Run URL (no trailing slash). Dev: unset → same-origin /api via Vite proxy. */
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN as string | undefined)?.replace(/\/$/, "") ?? "";

export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return API_ORIGIN ? `${API_ORIGIN}${p}` : p;
}

function mergeHeaders(init?: RequestInit): HeadersInit {
  const h = new Headers(init?.headers)
  if (
    init?.body &&
    !h.has('Content-Type')
  ) {
    h.set('Content-Type', 'application/json')
  }
  return h
}

export class ApiError extends Error {
  status: number
  code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: mergeHeaders(init),
  })
  const text = await res.text()
  if (!res.ok) {
    let message = text || `${res.status} ${res.statusText}`
    let code: string | undefined
    try {
      const j = JSON.parse(text) as { error?: string; code?: string }
      if (typeof j.error === 'string' && j.error.trim()) message = j.error
      if (typeof j.code === 'string' && j.code.trim()) code = j.code
    } catch {
      /* plain text body */
    }
    throw new ApiError(message, res.status, code)
  }
  return text ? (JSON.parse(text) as T) : ({} as T)
}
