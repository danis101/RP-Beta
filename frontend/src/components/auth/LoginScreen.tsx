import { useState } from 'react'
import { LogIn, Loader2 } from 'lucide-react'
import { useI18n } from '../../i18n'
import { useAuth } from '../../context/AuthContext'

/** Ekran logowania — pełny ekran, przed App. */
export default function LoginScreen() {
  const { t } = useI18n()
  const { login } = useAuth()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password || loading) return

    setLoading(true)
    setError(null)

    try {
      await login(username.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const disabled = loading || !username.trim() || !password

  return (
    <div className="flex h-screen items-center justify-center bg-surface-dark p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-edge bg-surface p-6"
      >
        <div>
          <h1 className="text-[17px] font-semibold text-[#f2f2f4]">{t('authTitle')}</h1>
          <p className="mt-0.5 text-[12px] text-[#75757f]">{t('authSubtitle')}</p>
        </div>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-[#8a8a94]">
            {t('authUsername')}
          </span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
            disabled={loading}
            className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none transition-colors focus:border-accent disabled:opacity-60"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-[#8a8a94]">
            {t('authPassword')}
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={loading}
            className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none transition-colors focus:border-accent disabled:opacity-60"
          />
        </label>

        {error && (
          <div className="rounded-lg bg-[#2a1a1a] px-3 py-2 text-[12px] text-[#e05b5b]">{error}</div>
        )}

        <button
          type="submit"
          disabled={disabled}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
          {loading ? t('authLoggingIn') : t('authLogin')}
        </button>

        <p className="text-center text-[11px] text-[#5a5f78]">{t('authHint')}</p>
      </form>
    </div>
  )
}
