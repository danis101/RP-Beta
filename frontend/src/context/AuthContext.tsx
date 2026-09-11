import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import * as sync from '../services/sync/client'
import { clearBlobCache } from '../lib/blobCache'
import type { SyncUser } from '../services/sync/types'

interface AuthContextValue {
  user: SyncUser | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

/**
 * Zarzadza sesja uzytkownika.
 * Przy logout czysci tez blob cache (zwalnia blob URL-e).
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
    return sync.onUnauthorized(() => {
      clearBlobCache()
      setUser(null)
    })
  }, [])

  const login = async (username: string, password: string) => {
    const resp = await sync.login(username, password)
    setUser(resp.user)
  }

  const logout = () => {
    sync.logout()
    clearBlobCache()
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

// === END OF FILE ===
