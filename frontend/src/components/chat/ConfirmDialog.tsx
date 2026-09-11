import { X } from 'lucide-react'

interface ConfirmDialogProps {
  title: string
  description?: string
  onConfirm: () => void
  onCancel: () => void
}

/** Prosty modal potwierdzenia Tak/Nie. */
export default function ConfirmDialog({ title, description, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-sm rounded-2xl border border-edge bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-[15px] font-semibold text-[#f2f2f4]">{title}</h2>
          <button onClick={onCancel} className="rounded-lg p-1 text-[#8a8a94] hover:bg-surface-light hover:text-white">
            <X size={15} />
          </button>
        </div>
        {description && <p className="mt-2 text-[12.5px] leading-relaxed text-[#9a9aa3]">{description}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-[12.5px] text-[#8a8a94] hover:bg-surface-light"
          >
            Nie
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-[#e05b5b] px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[#c74444]"
          >
            Tak
          </button>
        </div>
      </div>
    </div>
  )
}
