/**
 * API klienta dla endpointów administracyjnych.
 * Wywołania działają tylko dla usera z isAdmin=true — serwer zwraca 403 inaczej.
 */

import { request } from './client'
import type { SyncUser } from './types'

export interface AdminUser extends SyncUser {
  createdAt: number
}

interface UsersListResponse {
  users: AdminUser[]
}

export const adminApi = {
  async listUsers(): Promise<AdminUser[]> {
    const resp = await request<UsersListResponse>('/admin/users')
    return resp.users
  },

  async createUser(username: string, password: string, isAdmin = false): Promise<AdminUser> {
    const resp = await request<{ user: AdminUser }>('/admin/users', {
      method: 'POST',
      body: { username, password, isAdmin },
    })
    return resp.user
  },

  async deleteUser(id: string): Promise<void> {
    await request<void>(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },

  async changeUserPassword(id: string, newPassword: string): Promise<void> {
    await request<void>(`/admin/users/${encodeURIComponent(id)}/password`, {
      method: 'PATCH',
      body: { newPassword },
    })
  },
}
