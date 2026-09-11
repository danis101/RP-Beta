/**
 * Klient HTTP do serwera RP Sync.
 *
 * Trzyma token JWT w localStorage (`rp-sync-token`) i dokłada go do każdego
 * żądania jako `Authorization: Bearer`. Reaguje na 401 globalnie — czyści
 * token i powiadamia subskrybentów (AuthContext się wylogowuje).
 *
 * Wszystkie endpointy przechodzą przez `request<T>(path, opts)`.
 */

import { syncUrl } from './config'
import type { LoginResponse, SyncUser } from './types'

const TOKEN_KEY = 'rp-sync-token'

let _token: string | null = (() => {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
})()

export function getToken(): string | null {
  return _token
}

export function setToken(token: string | null): void {
  _token = token
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // localStorage może być niedostępny w trybie prywatnym — ignorujemy.
  }
}

// --- Globalny handler 401 ---

type UnauthorizedHandler = () => void
const unauthorizedHandlers = new Set<UnauthorizedHandler>()

export function onUnauthorized(handler: UnauthorizedHandler): () => void {
  unauthorizedHandlers.add(handler)
  return () => {
    unauthorizedHandlers.delete(handler)
  }
}

function fireUnauthorized(): void {
  setToken(null)
  for (const h of unauthorizedHandlers) {
    try {
      h()
    } catch {
      // ignorujemy błędy subskrybentów
    }
  }
}

// --- Rdzeń ---

interface RequestOptions {
  method?: string
  body?: unknown
  signal?: AbortSignal
  /** Login używa tego, żeby nie odpalać globalnego logout na 401. */
  skipUnauthorized?: boolean
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'

  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  let resp: Response
  try {
    resp = await fetch(syncUrl(path), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    })
  } catch (err) {
    // Network error (backend offline, DNS, CORS). Zachowujemy oryginalny komunikat.
    throw new Error(
      `Nie można połączyć się z serwerem: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (resp.status === 401 && !opts.skipUnauthorized) {
    fireUnauthorized()
    throw new Error('Sesja wygasła. Zaloguj się ponownie.')
  }

  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }))
    throw new Error((errBody as { error?: string }).error || `HTTP ${resp.status}`)
  }

  // 204 bez treści (np. delete) — zwróć undefined jako T.
  if (resp.status === 204) return undefined as T

  return (await resp.json()) as T
}

// --- Auth API ---

export async function login(username: string, password: string): Promise<LoginResponse> {
  const resp = await request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: { username, password },
    // 401 przy złych danych logowania NIE ma czyścić sesji (żadnej nie ma) — 
    // pokazujemy tylko komunikat błędu.
    skipUnauthorized: true,
  })
  setToken(resp.token)
  return resp
}

export function logout(): void {
  setToken(null)
}

export async function fetchMe(): Promise<SyncUser> {
  return request<SyncUser>('/auth/me')
}
