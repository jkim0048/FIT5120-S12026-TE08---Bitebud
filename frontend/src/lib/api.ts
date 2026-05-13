/** Production: set VITE_API_ORIGIN to Cloud Run URL (no trailing slash). Dev: unset → same-origin /api via Vite proxy. */
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN as string | undefined)?.replace(/\/$/, "") ?? "";

/** Build the full URL for an API request — prefixes `VITE_API_ORIGIN` in production builds. */
export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return API_ORIGIN ? `${API_ORIGIN}${normalizedPath}` : normalizedPath;
}

function mergeHeaders(init?: RequestInit): HeadersInit {
  const headers = new Headers(init?.headers)
  if (
    init?.body &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json')
  }
  return headers
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

/**
 * Thin `fetch` wrapper that prefixes the API origin, auto-sets `Content-Type: application/json` for bodies,
 * and throws a typed `ApiError` for non-2xx responses (preserving message and error code from the JSON body).
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: mergeHeaders(init),
  })
  const bodyText = await response.text()
  if (!response.ok) {
    let message = bodyText || `${response.status} ${response.statusText}`
    let code: string | undefined
    try {
      const parsedBody = JSON.parse(bodyText) as { error?: string; code?: string }
      if (typeof parsedBody.error === 'string' && parsedBody.error.trim()) message = parsedBody.error
      if (typeof parsedBody.code === 'string' && parsedBody.code.trim()) code = parsedBody.code
    } catch {
      /* plain text body */
    }
    throw new ApiError(message, response.status, code)
  }
  return bodyText ? (JSON.parse(bodyText) as T) : ({} as T)
}
