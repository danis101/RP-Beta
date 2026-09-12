import { useEffect, useRef, useState } from 'react'
import { X, Upload, Trash2, ImageDown, FileJson, Loader2 } from 'lucide-react'
import type { CharacterCard } from '../../types'
import { useI18n } from '../../i18n'
import { uploadBlobFromDataUrl, uploadBlobFromFile } from '../../services/sync'
import { cardToJSON } from '../../lib/spec/st'
import { dataURLToImageData, createPNGWithText } from '../../lib/png'
import Avatar from '../ui/Avatar'

interface CardEditorProps {
  card: CharacterCard | null
  onSave: (card: CharacterCard) => Promise<CharacterCard | null>
  onDelete: (id: string) => void
  onClose: () => void
}

/** Edytor karty postaci - formularz pol ST + upload portretu + eksport. */
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
      portraitBlobId: null,
    }
  })

  const [uploadingPortrait, setUploadingPortrait] = useState(false)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
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

  /**
   * Upload portretu: konwertuje plik na blob, wysyla na /blobs, zapisuje
   * `portraitBlobId`. Stare `portrait` (base64) jest czyszczone - od teraz
   * karta uzywa tylko bloba.
   */
  const handlePortraitUpload = async (file: File) => {
    setUploadingPortrait(true)
    try {
      const blobId = await uploadBlobFromFile(file)
      setDraft((prev) => ({ ...prev, portraitBlobId: blobId, portrait: undefined }))
    } catch (err) {
      console.error('Upload portretu nie powiodl sie:', err)
      alert(err instanceof Error ? err.message : String(err))
    } finally {
      setUploadingPortrait(false)
    }
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

    // Zrodlo portretu do eksportu PNG: probujemy blobId -> data URL,
    // fallback na stary base64, fallback na SVG placeholder.
    let portraitURL: string
    if (draft.portraitBlobId) {
      try {
        const { getBlobUrl } = await import('../../lib/blobCache')
        const blobUrl = await getBlobUrl(draft.portraitBlobId)
        // Konwertujemy blob URL z powrotem na data URL dla canvas.
        const blob = await (await fetch(blobUrl)).blob()
        portraitURL = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(blob)
        })
      } catch (err) {
        console.warn('Nie udalo sie pobrac portretu do eksportu:', err)
        portraitURL = `data:image/svg+xml;utf8,${encodeURIComponent(fallbackSvg)}`
      }
    } else if (draft.portrait) {
      portraitURL = draft.portrait
    } else {
      portraitURL = `data:image/svg+xml;utf8,${encodeURIComponent(fallbackSvg)}`
    }

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

  const handleSave = async () => {
    if (!draft.name.trim() || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      const saved = await onSave(draft)
      if (!saved) return
      // Aktualizujemy tylko wersje po WLASNYM udanym zapisie. Pelna podmiana
      // draftu zgubilaby tekst wpisany podczas oczekiwania na odpowiedz.
      // Zmiany z innych urzadzen nadal musza wywolac konflikt.
      setDraft((current) => ({
        ...current,
        _serverCreatedAt: saved._serverCreatedAt,
        _serverUpdatedAt: saved._serverUpdatedAt,
      }))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  // Preferujemy portraitBlobId, fallback na stary portrait.
  const avatarSrc = draft.portraitBlobId ?? draft.portrait

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-edge bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-edge px-5 py-3.5">
          <Avatar src={avatarSrc} name={draft.name || '?'} size="sm" />
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

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <div className="flex gap-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingPortrait}
              title={t('fieldPortraitUpload')}
              className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-edge bg-surface-dark text-[#6a6a72] transition-colors hover:border-accent disabled:opacity-60"
            >
              {uploadingPortrait ? (
                <Loader2 size={20} className="animate-spin" />
              ) : avatarSrc ? (
                <Avatar src={avatarSrc} name={draft.name} size="lg" />
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
            disabled={!draft.name.trim() || uploadingPortrait || saving}
            aria-busy={saving}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
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

// suppress unused - import jest potrzebny dla future use i eslint
void uploadBlobFromDataUrl
