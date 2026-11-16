import { useAuthStore } from '@/stores/authStore'
import { reportUserName } from './userName'

/** The signed-in user as a report names them; null when unknown. */
export function currentUser(): { displayName: string } | null {
  try {
    const displayName = reportUserName(useAuthStore().user?.name)
    return displayName ? { displayName } : null
  } catch {
    // No active store (the kit used outside the app): nobody to name.
    return null
  }
}
