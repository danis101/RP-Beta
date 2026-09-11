/**
 * Seeding: konto admina (raz, z env), oraz domyślna zawartość dla każdego
 * nowego usera (Asystent + Persona Użytkownik).
 *
 * Nowe konto = Asystent gotowy do pisania. Bez konwersacji — user sam
 * zaczyna czat. Bez mocków typu Aria/Kael/Mira — user importuje własne
 * karty jeśli chce.
 */

import { db } from './db'
import { hashPassword, validatePassword, validateUsername } from './auth'
import { ADMIN_USERNAME, ADMIN_PASSWORD } from './config'

/**
 * Seeduje konto admina jeśli w bazie nie ma jeszcze żadnego admina.
 * Wywoływane przy starcie serwera. Bezpieczne wielokrotnie.
 *
 * Zwraca info co się stało (log).
 */
export async function seedAdminIfNeeded(): Promise<void> {
  const existing = db
    .query('SELECT id FROM users WHERE is_admin = 1 LIMIT 1')
    .get() as { id: string } | null

  if (existing) {
    return
  }

  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    console.warn(
      '[seed] Brak ADMIN_USERNAME/ADMIN_PASSWORD w env, a w bazie nie ma żadnego admina. ' +
        'Nie można utworzyć konta — zaloguj się nie będzie możliwe.',
    )
    return
  }

  const uErr = validateUsername(ADMIN_USERNAME)
  if (uErr) {
    console.error(`[seed] Nieprawidłowy ADMIN_USERNAME: ${uErr}`)
    return
  }

  const pErr = validatePassword(ADMIN_PASSWORD)
  if (pErr) {
    console.error(`[seed] Nieprawidłowe ADMIN_PASSWORD: ${pErr}`)
    return
  }

  const existingName = db
    .query('SELECT id FROM users WHERE username = ?')
    .get(ADMIN_USERNAME) as { id: string } | null

  if (existingName) {
    // Konto o tej nazwie istnieje, ale nie ma flagi admina — podnosimy uprawnienia.
    db.run('UPDATE users SET is_admin = 1 WHERE id = ?', [existingName.id])
    console.log(`[seed] Podniesiono konto "${ADMIN_USERNAME}" do rangi admina`)
    return
  }

  const id = crypto.randomUUID()
  const hash = await hashPassword(ADMIN_PASSWORD)
  const now = Date.now()

  db.run(
    'INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, 1, ?)',
    [id, ADMIN_USERNAME, hash, now],
  )
  seedUserContent(id)
  console.log(`[seed] Utworzono konto admina "${ADMIN_USERNAME}"`)
}

/**
 * Seeduje domyślną zawartość dla nowego usera: kartę "Asystent" i personę
 * "Użytkownik". Wywoływane w momencie tworzenia konta (przez /admin/users POST).
 */
export function seedUserContent(userId: string): void {
  const now = Date.now()

  const assistantId = crypto.randomUUID()
  const assistantData = {
    id: assistantId,
    name: 'Asystent',
    role: '',
    status: 'online' as const,
    description: '',
    personality: '',
    scenario: '',
    firstMes: 'Cześć! W czym mogę pomóc?',
    mesExample: '',
    systemPrompt: '',
    creatorNotes: '',
    tags: [],
    characterBook: { entries: [] },
    extensions: {},
    portraitBlobId: null,
  }

  db.run(
    `INSERT INTO entities
      (user_id, type, id, name, blob_id, data_json, created_at, updated_at, deleted_at)
     VALUES (?, 'character', ?, 'Asystent', NULL, ?, ?, ?, NULL)`,
    [userId, assistantId, JSON.stringify(assistantData), now, now],
  )

  const personaId = crypto.randomUUID()
  const personaData = {
    id: personaId,
    name: 'Użytkownik',
    description: '',
    avatarBlobId: null,
  }

  db.run(
    `INSERT INTO entities
      (user_id, type, id, name, blob_id, data_json, created_at, updated_at, deleted_at)
     VALUES (?, 'persona', ?, 'Użytkownik', NULL, ?, ?, ?, NULL)`,
    [userId, personaId, JSON.stringify(personaData), now, now],
  )
}
