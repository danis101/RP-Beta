/**
 * Klient API dla ustawien aplikacji (singleton per user).
 *
 * GET  /settings  -> { settings: T | null, updatedAt: number | null }
 * PUT  /settings  -> upsert, zwraca { ok, updatedAt }
 *
 * Brak optimistic lockingu - LWW. Wersja z serwera jest zrodlem prawdy,
 * ostatni zapis wygrywa.
 */

import { request } from './client'
import { markSelfSave } from './ws'
import type { AppSettings } from '../../context/SettingsContext'

const SELF_SAVE_ID = 'settings:singleton'

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
    // Oznacz ze to nasz wlasny zapis - WS listener odfiltruje echo.
    markSelfSave(SELF_SAVE_ID)
  },
}

/** ID do porownania z eventem WS (entityType='settings' + id='singleton'). */
export const SETTINGS_WS_ID = 'singleton'
