/**
 * Klient API dla ustawien aplikacji (singleton per user).
 *
 * GET  /settings  -> { settings: T | null, updatedAt: number | null }
 * PUT  /settings  -> upsert, zwraca { ok, updatedAt }
 *
 * Brak optimistic lockingu - LWW. Wersja z serwera jest zrodlem prawdy,
 * ostatni zapis wygrywa.
 *
 * Self-save filter: backend broadcastuje event entity.changed z
 * entityType='settings', id='singleton'. markSelfSave('singleton')
 * (ten sam id) sprawia ze WS listener w App odfiltruje echo wlasnego zapisu.
 */

import { request } from './client'
import { markSelfSave } from './ws'
import type { AppSettings } from '../../context/SettingsContext'

/**
 * ID ustawien w tabeli entities po stronie serwera (routes/settings.ts).
 * Ten sam string jest uzywany w eventach WebSocket - dlatego self-save
 * filter musi znac dokladnie ta wartosc.
 */
export const SETTINGS_WS_ID = 'singleton'

interface GetResponse {
  settings: AppSettings | null
  updatedAt: number | null
}

interface PutResponse {
  ok: boolean
  updatedAt: number
}

export const settingsApi = {
  async get(): Promise<AppSettings | null> {
    const resp = await request<GetResponse>('/settings')
    return resp.settings
  },

  async save(settings: AppSettings): Promise<void> {
    await request<PutResponse>('/settings', {
      method: 'PUT',
      body: settings,
    })
    // Znacz ze to nasz wlasny zapis - WS listener odfiltruje echo.
    markSelfSave(SETTINGS_WS_ID)
  },
}
