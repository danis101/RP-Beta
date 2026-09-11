/**
 * Klient HTTP do serwera RP Sync.
 *
 * Trzyma token JWT w localStorage (`rp-sync-token`) i doklada go do kazdego
 * zadania jako `Authorization: Bearer`. Reaguje na 401 globalnie - czysci
 * token i powiadamia subskrybentow (AuthContext sie wylogowuje).
 *
 * 409 Conflict: backend zwraca `{ error, conflict: true, current }`.
 * Klient parsuje `current` i rzuca ConflictError z tym polem w srodku.
 * Warstwa wyzej (App.tsx) decyduje co zrobic - najczesciej pokazac banner.
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
    // localStorage moze byc niedostepny w trybie prywatnym - ignorujemy.
  }
}

// --- Blad konfliktu (409) ---

/**
 * Rzucany gdy serwer zwroci 409. `current` zawiera aktualna wersje encji
 * z serwera (albo null jesli zostala usunieta w miedzyczasie).
 *
 * Generyczny typ T pozwala warstwie wyzej (App.tsx) dostac typowana encje
 * bez rzutowania: `catch (e) { if (e instanceof ConflictError) e.current }`
 */
export class ConflictError<T = unknown> extends Error {
  constructor(public current: T | null) {
    super('Konflikt: encja zostala zmieniona na innym urzadzeniu')
    this.name = 'ConflictError'
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
      // ignorujemy bledy subskrybentow
    }
  }
}

// --- Rdzen ---

interface RequestOptions {
  method?: string
  body?: unknown
  signal?: AbortSignal
  /** Login uzywa tego, zeby nie odpalac globalnego logout na 401. */
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
    throw new Error(
      `Nie mozna polaczyc sie z serwerem: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (resp.status === 401 && !opts.skipUnauthorized) {
    fireUnauthorized()
    throw new Error('Sesja wygasla. Zaloguj sie ponownie.')
  }

  if (resp.status === 409) {
    // Backend zwrocil konflikt - parsujemy payload i rzucamy ConflictError
    // z aktualna wersja encji w `current`. Typ T na tym poziomie jest
    // "unknown" - warstwa wyzej (entities.ts) rzutuje to na konkretny typ.
    const payload = (await resp.json().catch(() => ({}))) as { current?: unknown }
    throw new ConflictError(payload.current ?? null)
  }

  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }))
    throw new Error((errBody as { error?: string }).error || `HTTP ${resp.status}`)
  }

  if (resp.status === 204) return undefined as T

  return (await resp.json()) as T
}

// --- Auth API ---

export async function login(username: string, password: string): Promise<LoginResponse> {
  const resp = await request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: { username, password },
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

/**
 * Zmiana wlasnego hasla. Backend bumpuje session_version (inne sesje padaja),
 * ale zwraca nowy token z nowym `sv` — podmieniamy go lokalnie, zeby biezaca
 * sesja pozostala zalogowana.
 */
export async function changeMyPassword(currentPassword: string, newPassword: string): Promise<void> {
  const resp = await request<{ ok: boolean; token: string }>('/auth/change-password', {
    method: 'POST',
    body: { currentPassword, newPassword },
  })
  if (resp.token) {
    setToken(resp.token)
  }
}

