import { useI18n } from '../../i18n'
import { useSettings } from '../../context/SettingsContext'
import type { FormattingPatterns, FormattingColors } from '../../lib/formatting'
import { defaultPatterns, defaultColors } from '../../lib/formatting'

/** Ustawienia formatowania tekstu — wzorce i kolory narracji, mowy i monologu. */
export default function FormattingSettings() {
  const { t } = useI18n()
  const { settings, updateSettings } = useSettings()
  const patterns = settings.formatting
  const colors = settings.formattingColors

  const setPattern = (key: keyof FormattingPatterns, field: 'start' | 'end', value: string) => {
    updateSettings({
      formatting: {
        ...patterns,
        [key]: { ...patterns[key], [field]: value },
      },
    })
  }

  const setColor = (key: keyof FormattingColors, value: string) => {
    updateSettings({
      formattingColors: { ...colors, [key]: value },
    })
  }

  const resetAll = () => {
    updateSettings({ formatting: defaultPatterns, formattingColors: defaultColors })
  }

  return (
    <div className="p-6">
      <h1 className="text-[17px] font-semibold text-[#f2f2f4]">{t('formattingTitle')}</h1>
      <p className="mt-1 text-[12px] text-[#75757f]">{t('formattingHint')}</p>

      <div className="mt-5 max-w-xl space-y-4">
        <PatternRow
          label={t('formattingNarrative')}
          description={t('formattingNarrativeHint')}
          start={patterns.narrative.start}
          end={patterns.narrative.end}
          color={colors.narrative}
          onChangeStart={(v) => setPattern('narrative', 'start', v)}
          onChangeEnd={(v) => setPattern('narrative', 'end', v)}
          onChangeColor={(v) => setColor('narrative', v)}
        />

        <PatternRow
          label={t('formattingSpeech')}
          description={t('formattingSpeechHint')}
          start={patterns.speech.start}
          end={patterns.speech.end}
          color={colors.speech}
          onChangeStart={(v) => setPattern('speech', 'start', v)}
          onChangeEnd={(v) => setPattern('speech', 'end', v)}
          onChangeColor={(v) => setColor('speech', v)}
        />

        <PatternRow
          label={t('formattingMonologue')}
          description={t('formattingMonologueHint')}
          start={patterns.monologue.start}
          end={patterns.monologue.end}
          color={colors.monologue}
          onChangeStart={(v) => setPattern('monologue', 'start', v)}
          onChangeEnd={(v) => setPattern('monologue', 'end', v)}
          onChangeColor={(v) => setColor('monologue', v)}
        />

        <PatternRow
          label={t('formattingDefault')}
          description={t('formattingDefaultHint')}
          color={colors.default}
          colorOnly
          onChangeColor={(v) => setColor('default', v)}
        />

        <button
          onClick={resetAll}
          className="rounded-lg border border-edge px-3 py-2 text-[12.5px] text-[#8a8a94] transition-colors hover:bg-surface-light"
        >
          {t('formattingReset')}
        </button>
      </div>
    </div>
  )
}

function PatternRow({
  label,
  description,
  start,
  end,
  color,
  colorOnly = false,
  onChangeStart,
  onChangeEnd,
  onChangeColor,
}: {
  label: string
  description: string
  start?: string
  end?: string
  color: string
  colorOnly?: boolean
  onChangeStart?: (v: string) => void
  onChangeEnd?: (v: string) => void
  onChangeColor: (v: string) => void
}) {
  return (
    <div className="rounded-xl border border-edge bg-surface p-4">
      <div className="mb-1 text-[13px] font-medium text-[#f2f2f4]">{label}</div>
      <div className="mb-3 text-[11.5px] text-[#75757f]">{description}</div>
      <div className="flex items-center gap-3">
        {!colorOnly && start !== undefined && end !== undefined && (
          <div className="flex items-center gap-2">
            <input
              value={start}
              onChange={(e) => onChangeStart?.(e.target.value)}
              className="w-16 rounded-lg border border-[#2a2a31] bg-surface-dark px-2 py-1.5 text-center text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
            />
            <span className="text-[12px] text-[#75757f]">… tekst …</span>
            <input
              value={end}
              onChange={(e) => onChangeEnd?.(e.target.value)}
              className="w-16 rounded-lg border border-[#2a2a31] bg-surface-dark px-2 py-1.5 text-center text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
            />
          </div>
        )}

        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="color"
            value={color}
            onChange={(e) => onChangeColor(e.target.value)}
            className="h-8 w-10 cursor-pointer rounded border border-[#2a2a31] bg-surface-dark p-0.5"
          />
          <span className="text-[11.5px] text-[#75757f]">{color}</span>
        </label>
      </div>
    </div>
  )
}
