/** Токены хранятся в памяти во время сессии, на диск пишутся только через SecureStore в store/auth. */
let accessToken: string | null = null
let refreshToken: string | null = null
let sessionExpiredHandler: (() => void) | null = null

export function getAccessToken() {
  return accessToken
}

export function getRefreshToken() {
  return refreshToken
}

export function setSessionTokens(tokens: { accessToken: string; refreshToken: string }) {
  accessToken = tokens.accessToken
  refreshToken = tokens.refreshToken
}

export function clearSessionTokens() {
  accessToken = null
  refreshToken = null
}

export function onSessionExpired(handler: (() => void) | null) {
  sessionExpiredHandler = handler
}

export function notifySessionExpired() {
  clearSessionTokens()
  sessionExpiredHandler?.()
}
