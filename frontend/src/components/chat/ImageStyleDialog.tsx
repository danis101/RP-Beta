import { useState } from 'react'
import { X, Wand2 } from 'lucide-react'
import { useI18n } from '../../i18n'

interface ImageStyleDialogProps {
  /** Aktualnie wybrany styl (undefined = auto). */
  current: string | undefined
  /** Lista styli zdefiniowanych przez usera w Settings. */
  availableStyles: string[]
  onSave: (styleId: string | undefined) => void
  onClose: () => void
}

/**
 * Modal wyboru stylu obrazu dla tej konwersacji.
 *
 * Wybrany styl jest przekazywany do refinera jako twarda dyrektywa
 * `[STYLE: <wartość>]`. Lista pochodzi z ustawień usera
 * (`imageGenCustomStyles`) — zero hardkodowania.
 *
 * Pusty wybór ("Auto") = refiner sam decyduje.
 */
export default function ImageStyleDialog({
  current,
  availableStyles,
  onSave,
  onClose,
}: ImageStyleDialogProps) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<string>(current ?? '')

  const handleSave = () => {
    onSave(draft.trim() || undefined)
    onClose()
  }

  const handleClear = () => {
    setDraft('')
  }

  const noStyles = availableStyles.length === 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-edge bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Wand2 size={16} className="text-accent" />
            <h2 className="text-[15px] font-semibold text-[#f2f2f4]">{t('imageStyleTitle')}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-[#8a8a94] hover:bg-surface-light hover:text-white"
          >
            <X size={15} />
          </button>
        </div>

        <p className="mt-2 text-[12px] leading-relaxed text-[#75757f]">
          {t('imageStyleSubtitle')}
        </p>

        {noStyles ? (
          <div className="mt-4 rounded-xl border border-dashed border-edge bg-surface-dark px-4 py-3 text-[12px] leading-relaxed text-[#8a8a94]">
            {t('imageStyleNoCustomStyles')}
          </div>
        ) : (
          <div className="mt-4 space-y-1">
            <button
              onClick={() => setDraft('')}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
                draft === '' ? 'bg-[#1e2436] text-white' : 'text-[#b8bdd0] hover:bg-surface-light'
              }`}
            >
              <span className="flex-1">{t('imageStyleAuto')}</span>
            </button>
            {availableStyles.map((s) => (
              <button
                key={s}
                onClick={() => setDraft(s)}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
                  draft === s ? 'bg-[#1e2436] text-white' : 'text-[#b8bdd0] hover:bg-surface-light'
                }`}
              >
                <span className="flex-1 truncate">{s}</span>
              </button>
            ))}
          </div>
        )}

        {!noStyles && (
          <label className="mt-3 block">
            <span className="mb-1 block text-[11px] font-medium text-[#8a8a94]">
              {t('imageStyleCustomLabel')}
            </span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('imageStyleCustomPlaceholder')}
              className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
            />
          </label>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={handleClear}
            className="rounded-lg px-4 py-2 text-[12.5px] text-[#8a8a94] hover:bg-surface-light"
          >
            {t('imageStyleClear')}
          </button>
          <button
            onClick={handleSave}
            className="rounded-lg bg-accent px-4 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            {t('imageStyleSave')}
          </button>
        </div>
      </div>
    </div>
  )
}

