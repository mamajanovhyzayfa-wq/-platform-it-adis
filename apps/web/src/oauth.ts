/**
 * Вход через Google и Apple.
 *
 * Кнопки включаются, когда администратор платформы задал публичные client id
 * при сборке (VITE_GOOGLE_CLIENT_ID, VITE_APPLE_CLIENT_ID). Сервер проверяет
 * полученный ID-токен; без настройки провайдер отвечает 503.
 */
import { appUrl } from './api/client'

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: { client_id: string; callback: (response: { credential?: string }) => void }) => void
          prompt: () => void
        }
      }
    }
    AppleID?: {
      auth: {
        init: (options: {
          clientId: string
          scope: string
          redirectURI: string
          usePopup: boolean
        }) => void
        signIn: () => Promise<{ authorization?: { id_token?: string } }>
      }
    }
  }
}

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
const appleClientId = import.meta.env.VITE_APPLE_CLIENT_ID as string | undefined

export const oauthConfigured = {
  google: Boolean(googleClientId),
  apple: Boolean(appleClientId),
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Не удалось загрузить провайдера входа'))
    document.head.appendChild(script)
  })
}

export async function signInWithGoogle(): Promise<string> {
  if (!googleClientId) throw new Error('Вход через Google не настроен')
  await loadScript('https://accounts.google.com/gsi/client')
  if (!window.google) throw new Error('Google недоступен')

  return new Promise((resolve, reject) => {
    window.google!.accounts.id.initialize({
      client_id: googleClientId,
      callback: (response) => {
        if (response.credential) resolve(response.credential)
        else reject(new Error('Google не вернул токен'))
      },
    })
    window.google!.accounts.id.prompt()
  })
}

export async function signInWithApple(): Promise<string> {
  if (!appleClientId) throw new Error('Вход через Apple не настроен')
  await loadScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js')
  if (!window.AppleID) throw new Error('Apple недоступен')

  window.AppleID.auth.init({
    clientId: appleClientId,
    scope: 'name email',
    redirectURI: `${window.location.origin}${appUrl('/login')}`,
    usePopup: true,
  })
  const response = await window.AppleID.auth.signIn()
  const token = response.authorization?.id_token
  if (!token) throw new Error('Apple не вернул токен')
  return token
}
