import { useEffect, useState } from 'react'
import { getSession, type AdminSession } from '../api/client'

/** Сессия, которая перерисовывает интерфейс при смене активной роли. */
export function useSession(): AdminSession | null {
  const [session, setSession] = useState<AdminSession | null>(() => getSession())

  useEffect(() => {
    const sync = () => setSession(getSession())
    window.addEventListener('itadis:session', sync)
    window.addEventListener('itadis:login', sync)
    window.addEventListener('itadis:logout', sync)
    return () => {
      window.removeEventListener('itadis:session', sync)
      window.removeEventListener('itadis:login', sync)
      window.removeEventListener('itadis:logout', sync)
    }
  }, [])

  return session
}
