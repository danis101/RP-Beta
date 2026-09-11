import { Pencil, RotateCcw, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'

interface MessageActionsProps {
  role: 'user' | 'assistant'
  variantIndex: number
  variantCount: number
  canRegenerate: boolean
  onEdit: () => void
  onDelete: () => void
  onRegenerate: () => void
  onPrevVariant: () => void
  onNextVariant: () => void
}

/**
 * Dyskretne akcje pod dymkiem.
 * Widoczne po najechaniu na wiadomość (group-hover).
 * Dla asystenta: edycja, regeneracja, usuwanie, przełączanie wariantów.
 * Dla użytkownika: edycja, usuwanie, regeneracja (gdy to ostatnia wiadomość).
 */
export default function MessageActions({
  role,
  variantIndex,
  variantCount,
  canRegenerate,
  onEdit,
  onDelete,
  onRegenerate,
  onPrevVariant,
  onNextVariant,
}: MessageActionsProps) {
  const iconClass = 'rounded-md p-1 text-[#6a6a72] transition-colors hover:bg-surface hover:text-white'

  return (
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
      <button onClick={onEdit} title="Edytuj" className={iconClass}>
        <Pencil size={13} />
      </button>

      {canRegenerate && (
        <button onClick={onRegenerate} title="Regeneruj" className={iconClass}>
          <RotateCcw size={13} />
        </button>
      )}

      <button onClick={onDelete} title="Usuń" className={`${iconClass} hover:text-[#e05b5b]`}>
        <Trash2 size={13} />
      </button>

      {role === 'assistant' && variantCount > 1 && (
        <>
          <span className="mx-1 text-[10.5px] text-[#5a5f78]">
            {variantIndex + 1}/{variantCount}
          </span>
          <button onClick={onPrevVariant} title="Poprzedni wariant" className={iconClass}>
            <ChevronLeft size={13} />
          </button>
          <button onClick={onNextVariant} title="Następny wariant" className={iconClass}>
            <ChevronRight size={13} />
          </button>
        </>
      )}
    </div>
  )
}
