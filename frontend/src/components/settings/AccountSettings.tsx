import { useState } from 'react'
import { KeyRound, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { useI18n } from '../../i18n'
import { useAuth } from '../../context/AuthContext'
import { changeMyPassword } from '../../services/sync'

/**
 * Zakladka "Konto" w Ustawieniach.
 *
 * Zakres:
 *   - pokazuje nazwe zalogowanego usera (read-only)
 *   - formularz zmiany wlasnego hasla (wymaga aktualnego)
 *
 * Zmiana hasla:
 *   - backend bumpuje session_version → inne sesje (telefon, druga przegladarka)
 *     padaja natychmiast
 *   - backend zwraca nowy token → ta sesja pozostaje zalogowana
 *   - brak auto-logout, brak migania UI
 */
export default function AccountSettings() {
  const { t } = useI18n()
  const { user } = useAuth()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clearForm = () => {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return

    setError(null)
    setSuccess(false)

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError(t('accountFillAllFields'))
      return
    }

    if (newPassword.length < 8) {
      setError(t('accountPasswordTooShort'))
      return
    }

    if (newPassword !== confirmPassword) {
      setError(t('accountPasswordMismatch'))
      return
    }

    if (newPassword === currentPassword) {
      setError(t('accountPasswordSameAsCurrent'))
      return
    }

    setSubmitting(true)
    try {
      await changeMyPassword(currentPassword, newPassword)
      setSuccess(true)
      clearForm()
      // Sukces widoczny przez chwile, potem sam zniknie przy nastepnej akcji.
      window.setTimeout(() => setSuccess(false), 5000)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const disabled =
    submitting ||
    !currentPassword ||
    !newPassword ||
    !confirmPassword

  return (
    <div className="p-6">
      <h1 className="text-[17px] font-semibold text-[#f2f2f4]">{t('accountTitle')}</h1>
      <p className="mt-1 text-[12px] text-[#75757f]">{t('accountSubtitle')}</p>

      <div className="mt-5 max-w-md space-y-5">
        {/* Nazwa zalogowanego usera */}
        <div className="rounded-xl border border-edge bg-surface p-4">
          <div className="text-[11px] font-medium uppercase tracking-wide text-[#8a8a94]">
            {t('accountUsername')}
          </div>
          <div className="mt-1 text-[14px] text-[#f2f2f4]">
            {user?.username ?? '—'}
            {user?.isAdmin && (
              <span className="ml-2 rounded bg-[#1e2436] px-1.5 py-0.5 text-[10px] font-medium text-accent">
                admin
              </span>
            )}
          </div>
        </div>

        {/* Zmiana hasla */}
        <form
          onSubmit={handleSubmit}
          className="space-y-3 rounded-xl border border-edge bg-surface p-4"
        >
          <div className="flex items-center gap-2 text-[13px] font-medium text-[#f2f2f4]">
            <KeyRound size={14} className="text-[#8a8a94]" />
            {t('accountChangePassword')}
          </div>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-[#8a8a94]">
              {t('accountCurrentPassword')}
            </span>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              disabled={submitting}
              className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none transition-colors focus:border-accent disabled:opacity-60"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-[#8a8a94]">
              {t('accountNewPassword')}
            </span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              disabled={submitting}
              className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none transition-colors focus:border-accent disabled:opacity-60"
            />
            <span className="mt-1 block text-[11px] text-[#6a6a72]">
              {t('accountPasswordHint')}
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-[#8a8a94]">
              {t('accountConfirmPassword')}
            </span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              disabled={submitting}
              className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none transition-colors focus:border-accent disabled:opacity-60"
            />
          </label>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-[#2a1a1a] px-3 py-2 text-[12px] text-[#e05b5b]">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-start gap-2 rounded-lg bg-[#16241b] px-3 py-2 text-[12px] text-[#7ee2a0]">
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              <span>{t('accountPasswordChanged')}</span>
            </div>
          )}

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={disabled}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting && <Loader2 size={13} className="animate-spin" />}
              {submitting ? t('accountChanging') : t('accountChangeButton')}
            </button>
          </div>

          <p className="border-t border-edge pt-3 text-[11.5px] leading-relaxed text-[#6a6a72]">
            {t('accountOtherSessionsHint')}
          </p>
        </form>
      </div>
    </div>
  )
}

