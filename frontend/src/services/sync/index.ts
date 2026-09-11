/**
 * Warstwa sync jako jeden punkt wejscia.
 */

import { createEntityApi } from './entities'
import type { CharacterCard, Persona, Conversation, StylePreset, Lorebook } from '../../types'

export {
  request,
  login,
  logout,
  fetchMe,
  getToken,
  setToken,
  onUnauthorized,
  notifySessionRevoked,
  ConflictError,
  changeMyPassword,
} from './client'
export { adminApi } from './admin'
export { settingsApi, SETTINGS_WS_ID } from './settings'
export { uploadBlob, uploadBlobFromDataUrl, uploadBlobFromFile, uploadBlobFromBlob } from './blobs'
export { connectSyncWs, isRecentSelfSave, markSelfSave } from './ws'
export type { SyncEvent, EntityType, EntityAction } from './ws'
export type { AdminUser } from './admin'
export type { ConflictPayload } from './types'
export type { BlobUploadResult } from './blobs'

/** Encje - instancje API per typ. */
export const charactersApi = createEntityApi<CharacterCard>('/characters')
export const personasApi = createEntityApi<Persona>('/personas')
export const conversationsApi = createEntityApi<Conversation>('/conversations')
export const stylesApi = createEntityApi<StylePreset>('/styles')
export const lorebooksApi = createEntityApi<Lorebook>('/lorebooks')

