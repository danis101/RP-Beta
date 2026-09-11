/** Wspólne typy dla warstwy sync. */

export interface SyncUser {
  id: string
  username: string
  isAdmin: boolean
}

export interface LoginResponse {
  token: string
  user: SyncUser
}
