/**
 * Warstwa sync jako jeden punkt wejscia.
 */

import { createEntityApi } from './entities'
import type { CharacterCard, Persona, Conversation, StylePreset, Lorebook } from '../../types'

export { request, login, logout, fetchMe, getToken, setToken, onUnauthorized, ConflictError } from './client'
export { adminApi } from './admin'
export type { AdminUser } from './admin'
export type { ConflictPayload } from './types'

/** Encje - instancje API per typ. */
export const charactersApi = createEntityApi<CharacterCard>('/characters')
export const personasApi = createEntityApi<Persona>('/personas')
export const conversationsApi = createEntityApi<Conversation>('/conversations')
export const stylesApi = createEntityApi<StylePreset>('/styles')
export const lorebooksApi = createEntityApi<Lorebook>('/lorebooks')
