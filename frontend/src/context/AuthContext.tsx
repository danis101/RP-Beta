import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import * as sync from '../services/sync/client'
import type { SyncUser } from '../services/sync/types'

interface AuthContextValue {
  user: SyncUser | null
  /** Trwa weryfikacja tokenu z localStorage przy zimnym starcie. */
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

/**
 * Zarządza sesją użytkownika.
 *
 * Przy starcie: jeśli w localStorage jest token, próbuje zweryfikować go
 * przez `/auth/me`. Sukces = zalogowany, jakikolwiek błąd = czyścimy token
 * i pokazujemy ekran logowania.
 *
 * Globalna reakcja na 401 z dowolnego endpointu: subskrypcja `onUnauthorized`
 * z klienta — czyści user state i UI wraca do ekranu logowania.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SyncUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      if (!sync.getToken()) {
        if (!cancelled) setLoading(false)
        return
      }
      try {
        const me = await sync.fetchMe()
        if (!cancelled) setUser(me)
      } catch {
        // 401 już wyczyścił token przez fireUnauthorized. Network error też
        // wymaga czyścić — token może być dobry, ale nie zweryfikujemy go bez
        // serwera. Użytkownik zobaczy ekran logowania i spróbuje jeszcze raz.
        if (!cancelled) sync.setToken(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return sync.onUnauthorized(() => setUser(null))
  }, [])

  const login = async (username: string, password: string) => {
    const resp = await sync.login(username, password)
    setUser(resp.user)
  }

  const logout = () => {
    sync.logout()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
