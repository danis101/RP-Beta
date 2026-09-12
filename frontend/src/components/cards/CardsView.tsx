import { useRef, useState } from 'react'
import { Plus, Import, Pencil } from 'lucide-react'
import type { CharacterCard } from '../../types'
import { useI18n } from '../../i18n'
import { parseSTJSON, cardFromSTSpec } from '../../lib/spec/st'
import { extractPNGText } from '../../lib/png'
import { uploadBlobFromDataUrl } from '../../services/sync'
import Avatar from '../ui/Avatar'
import CardEditor from './CardEditor'

interface CardsViewProps {
  characters: CharacterCard[]
  onSave: (card: CharacterCard) => Promise<CharacterCard | null>
  onDelete: (id: string) => void
  onStartChat: (characterId: string) => void
}

/** Widok kart postaci: lista, tworzenie, import (PNG/JSON), edycja, start czatu. */
export default function CardsView({ characters, onSave, onDelete, onStartChat }: CardsViewProps) {
  const { t } = useI18n()
  const [editing, setEditing] = useState<CharacterCard | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  const handleImport = async (file: File) => {
    try {
      let card: CharacterCard
      let pendingPortraitDataUrl: string | undefined

      if (file.name.toLowerCase().endsWith('.png')) {
        const buffer = await file.arrayBuffer()
        const chara = extractPNGText(buffer, 'chara')
        if (!chara) {
          alert(t('importNoMetadata'))
          return
        }
        const spec = JSON.parse(decodeURIComponent(escape(atob(chara))))
        card = cardFromSTSpec(spec)

        // Portret z tego samego pliku PNG - zapamietujemy jako data URL,
        // zaraz go wgramy jako blob i podmienimy na blobId.
        pendingPortraitDataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.readAsDataURL(file)
        })
      } else if (file.name.toLowerCase().endsWith('.json')) {
        const text = await file.text()
        card = parseSTJSON(text)
      } else {
        alert(t('importUnsupported'))
        return
      }

      // Jesli mamy portret z PNG - upload jako blob zamiast trzymac base64.
      if (pendingPortraitDataUrl) {
        try {
          const blobId = await uploadBlobFromDataUrl(pendingPortraitDataUrl)
          card.portraitBlobId = blobId
          card.portrait = undefined
        } catch (err) {
          console.warn('Upload portretu nie powiodl sie, zostaje base64:', err)
          // Fallback: zostawiamy base64 (dziala jak w poprzedniej wersji).
          card.portrait = pendingPortraitDataUrl
        }
      }

      const saved = await onSave(card)
      if (saved) setEditing(saved)
    } catch (error) {
      console.error('Blad importu karty:', error)
      alert(t('importError'))
    }
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-surface-dark">
      <div className="flex items-center gap-3 border-b border-edge bg-surface px-6 py-4">
        <div className="flex-1">
          <h1 className="text-[17px] font-semibold text-[#f2f2f4]">{t('cardsTitle')}</h1>
          <p className="mt-0.5 text-[12px] text-[#75757f]">{t('cardsSubtitle')}</p>
        </div>
        <button
          onClick={() => importRef.current?.click()}
          className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-[12.5px] text-[#b8bdd0] transition-colors hover:bg-surface-light"
        >
          <Import size={14} /> {t('cardsImport')}
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".png,.json"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleImport(e.target.files[0])}
        />
        <button
          onClick={() =>
            setEditing({
              id: crypto.randomUUID(),
              name: '',
              role: '',
              status: 'offline',
              characterBook: { entries: [] },
              extensions: {},
              portraitBlobId: null,
            })
          }
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          <Plus size={14} /> {t('cardsNew')}
        </button>
      </div>

      <div className="grid flex-1 grid-cols-2 gap-3 overflow-y-auto p-6 md:grid-cols-3 xl:grid-cols-4">
        {characters.map((card) => (
          <div
            key={card.id}
            role="button"
            tabIndex={0}
            onClick={() => onStartChat(card.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onStartChat(card.id)
              }
            }}
            className="group flex cursor-pointer flex-col items-start gap-3 rounded-2xl border border-edge bg-surface p-4 text-left transition-colors hover:border-accent/50"
          >
            <div className="flex w-full items-center gap-3">
              <Avatar src={card.portraitBlobId ?? card.portrait} name={card.name} size="lg" />
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-[14.5px] font-semibold text-[#f2f2f4]">{card.name}</h3>
                <p className="truncate text-[12px] text-[#75757f]">{card.role ?? t('cardsNoRole')}</p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setEditing(card)
                }}
                title={t('editorEditCard')}
                className="rounded-lg p-1.5 text-[#8a8a94] opacity-0 transition-opacity hover:bg-surface-light hover:text-white group-hover:opacity-100"
              >
                <Pencil size={15} />
              </button>
            </div>
            {card.description && (
              <p className="line-clamp-2 text-[12px] leading-relaxed text-[#9a9aa3]">{card.description}</p>
            )}
            <div className="flex w-full items-center justify-between">
              <span className="text-[10.5px] text-[#5a5f78]">
                {card.characterBook?.entries?.length
                  ? `${card.characterBook.entries.length} ${t('cardsLorebook')}`
                  : t('cardsNoLorebook')}
              </span>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <CardEditor
          card={characters.find((c) => c.id === editing.id) ? editing : null}
          onSave={onSave}
          onDelete={onDelete}
          onClose={() => setEditing(null)}
        />
      )}
    </main>
  )
}
