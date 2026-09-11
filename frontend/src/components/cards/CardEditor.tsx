import { useEffect, useRef, useState } from 'react'
import { X, Upload, Trash2, ImageDown, FileJson } from 'lucide-react'
import type { CharacterCard } from '../../types'
import { useI18n } from '../../i18n'
import { cardToJSON } from '../../lib/spec/st'
import { dataURLToImageData, createPNGWithText } from '../../lib/png'
import Avatar from '../ui/Avatar'

interface CardEditorProps {
  card: CharacterCard | null
  onSave: (card: CharacterCard) => void
  onDelete: (id: string) => void
  onClose: () => void
}

/** Edytor karty postaci — formularz pól ST + upload portretu + eksport. */
export default function CardEditor({ card, onSave, onDelete, onClose }: CardEditorProps) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<CharacterCard>(() => {
    if (card) return structuredClone(card)
    return {
      id: crypto.randomUUID(),
      name: '',
      role: '',
      status: 'offline',
      description: '',
      personality: '',
      scenario: '',
      firstMes: '',
      mesExample: '',
      systemPrompt: '',
      creatorNotes: '',
      tags: [],
      characterBook: { entries: [] },
      extensions: {},
    }
  })

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const set = <K extends keyof CharacterCard>(key: K, value: CharacterCard[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  const handlePortraitUpload = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => set('portrait', reader.result as string)
    reader.readAsDataURL(file)
  }

  const handleExportPNG = async () => {
    const json = cardToJSON(draft)
    const base64 = btoa(unescape(encodeURIComponent(json)))

    const fallbackSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="400" height="600">
        <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#1e2436"/><stop offset="1" stop-color="#0d0d0f"/>
        </linearGradient></defs>
        <rect width="400" height="600" fill="url(#g)"/>
        <text x="200" y="300" fill="#4d6bfe" font-family="sans-serif" font-size="28" text-anchor="middle">${draft.name || 'Karta postaci'}</text>
      </svg>
    `
    const portraitURL = draft.portrait ?? `data:image/svg+xml;utf8,${encodeURIComponent(fallbackSvg)}`
    const imageData = await dataURLToImageData(portraitURL)
    const blob = await createPNGWithText(imageData, 'chara', base64)

    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${draft.name || 'character'}.png`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const handleExportJSON = () => {
    const blob = new Blob([cardToJSON(draft)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${draft.name || 'character'}.json`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const handleSave = () => {
    if (!draft.name.trim()) return
    onSave(draft)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-edge bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-edge px-5 py-3.5">
          <Avatar src={draft.portrait} name={draft.name || '?'} size="sm" />
          <h2 className="flex-1 text-[15px] font-semibold text-[#f2f2f4]">
            {card ? t('editorEditCard') : t('editorNewCard')}
          </h2>
          <button onClick={handleExportPNG} title={t('editorExportPNG')} className="rounded-lg p-2 text-[#8a8a94] hover:bg-surface-light hover:text-white">
            <ImageDown size={16} />
          </button>
          <button onClick={handleExportJSON} title={t('editorExportJSON')} className="rounded-lg p-2 text-[#8a8a94] hover:bg-surface-light hover:text-white">
            <FileJson size={16} />
          </button>
          <button onClick={onClose} className="rounded-lg p-2 text-[#8a8a94] hover:bg-surface-light hover:text-white">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <div className="flex gap-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              title={t('fieldPortraitUpload')}
              className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-edge bg-surface-dark text-[#6a6a72] transition-colors hover:border-accent"
            >
              {draft.portrait ? (
                <Avatar src={draft.portrait} name={draft.name} size="lg" />
              ) : (
                <Upload size={20} />
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handlePortraitUpload(e.target.files[0])}
            />
            <div className="flex-1 space-y-2">
              <Field label={t('fieldName')} value={draft.name} onChange={(v) => set('name', v)} />
              <Field label={t('fieldRole')} value={draft.role ?? ''} onChange={(v) => set('role', v)} />
            </div>
          </div>

          <AreaField label={t('fieldDescription')} value={draft.description ?? ''} onChange={(v) => set('description', v)} rows={2} />
          <AreaField label={t('fieldPersonality')} value={draft.personality ?? ''} onChange={(v) => set('personality', v)} rows={2} />
          <AreaField label={t('fieldScenario')} value={draft.scenario ?? ''} onChange={(v) => set('scenario', v)} rows={2} />
          <AreaField label={t('fieldFirstMes')} value={draft.firstMes ?? ''} onChange={(v) => set('firstMes', v)} rows={2} />
          <AreaField label={t('fieldMesExample')} value={draft.mesExample ?? ''} onChange={(v) => set('mesExample', v)} rows={3} />
          <AreaField label={t('fieldSystemPrompt')} value={draft.systemPrompt ?? ''} onChange={(v) => set('systemPrompt', v)} rows={3} />
          <AreaField label={t('fieldCreatorNotes')} value={draft.creatorNotes ?? ''} onChange={(v) => set('creatorNotes', v)} rows={2} />

          <Field
            label={t('fieldTags')}
            value={draft.tags?.join(', ') ?? ''}
            onChange={(v) => set('tags', v.split(',').map((tag) => tag.trim()).filter(Boolean))}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t border-edge px-5 py-3">
          {card && (
            <button
              onClick={() => onDelete(draft.id)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] text-[#e05b5b] hover:bg-[#2a1a1a]"
            >
              <Trash2 size={14} /> {t('editorDelete')}
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-[12.5px] text-[#8a8a94] hover:bg-surface-light">
            {t('editorCancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={!draft.name.trim()}
            className="rounded-lg bg-accent px-4 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            {t('editorSave')}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-[#8a8a94]">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none transition-colors focus:border-accent"
      />
    </label>
  )
}

function AreaField({
  label,
  value,
  onChange,
  rows = 3,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  rows?: number
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-[#8a8a94]">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full resize-y rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] leading-relaxed text-[#e8e8eb] outline-none transition-colors focus:border-accent"
      />
    </label>
  )
}
