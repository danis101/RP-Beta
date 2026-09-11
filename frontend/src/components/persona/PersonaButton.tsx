import type { Persona } from '../../types'
import Avatar from '../ui/Avatar'

interface PersonaButtonProps {
  persona: Persona
  onClick: () => void
}

/**
 * Kółko persony w lewej ramce nawigacji (nad ikoną Rozmowy).
 * Sam avatar, bez nazwy — minimalnie i czytelnie.
 */
export default function PersonaButton({ persona, onClick }: PersonaButtonProps) {
  return (
    <button
      onClick={onClick}
      title={`Persona: ${persona.name}`}
      className="rounded-full transition-transform hover:scale-105"
    >
      <Avatar src={persona.avatar} name={persona.name} size="md" />
    </button>
  )
}
