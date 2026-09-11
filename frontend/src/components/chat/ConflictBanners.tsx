import { AlertTriangle, RefreshCw, X } from 'lucide-react'
import { useConflict } from '../../context/ConflictContext'
import { useI18n } from '../../i18n'

/**
 * Pasek powiadomien o konfliktach sync.
 *
 * Wyswietlany na gorze glownego widoku (App.tsx). Kazdy banner:
 *   - ikona ostrzezenia
 *   - tytul + opcjonalny opis
 *   - przycisk "Odswiez" (onRefresh)
 *   - przycisk "X" (onDismiss)
 *
 * Gdy brak bannerow - nic nie renderuje, zero zajetego miejsca.
 */
export default function ConflictBanners() {
  const { t } = useI18n()
  const { banners, dismissBanner } = useConflict()

  if (banners.length === 0) return null

  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-40 flex w-full max-w-xl -translate-x-1/2 flex-col gap-2 px-4">
      {banners.map((banner) => (
        <div
          key={banner.id}
          className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-[#4a3a1a] bg-[#2a2015] px-3.5 py-2.5 text-[12.5px] text-[#e8d0a0] shadow-lg shadow-black/40"
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[#f0b040]" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">{banner.title}</div>
            {banner.description && (
              <div className="mt-0.5 text-[11.5px] text-[#b8a070]">{banner.description}</div>
            )}
          </div>
          {banner.onRefresh && (
            <button
              onClick={() => {
                banner.onRefresh?.()
                dismissBanner(banner.id)
              }}
              className="flex shrink-0 items-center gap-1 rounded-md bg-[#4a3a1a] px-2 py-1 text-[11.5px] font-medium text-[#f0b040] transition-colors hover:bg-[#5a4a2a]"
            >
              <RefreshCw size={11} />
              {t('conflictRefresh')}
            </button>
          )}
          <button
            onClick={() => {
              banner.onDismiss?.()
              dismissBanner(banner.id)
            }}
            className="shrink-0 rounded-md p-1 text-[#8a7a5a] transition-colors hover:bg-[#3a2a1a] hover:text-[#e8d0a0]"
            title={t('conflictDismiss')}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
