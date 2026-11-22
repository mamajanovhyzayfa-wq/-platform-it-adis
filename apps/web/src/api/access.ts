import { http, setStepUpToken, type SessionRole } from './client'

export interface RegistrationItem {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  requestedRole: SessionRole
  message: string | null
  birthDate: string | null
  guardianName: string | null
  guardianPhone: string | null
  locale: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  inviteId: string | null
  createdAt: string
  decidedAt: string | null
  rejectReason: string | null
}

export interface InvitationItem {
  id: string
  token: string
  code: string
  channel: 'LINK' | 'CODE' | 'EMAIL' | 'PHONE'
  role: SessionRole
  email: string | null
  phone: string | null
  note: string | null
  expiresAt: string
  usedAt: string | null
  createdAt: string
}

export interface LoginResult {
  user?: {
    id: string
    email: string
    firstName: string
    lastName: string
    role: SessionRole
    locale?: string
  }
  tokens?: { accessToken: string }
  twoFactorRequired?: true
  challengeToken?: string
}

/** Публичные и административные операции регистрации и защиты аккаунта. */
export const accessApi = {
  login: (identifier: string, password: string, captcha?: { captchaId: string; captchaAnswer: string }) =>
    http
      .post('/auth/login', { identifier, password, ...captcha })
      .then((response) => response.data as LoginResult),

  captcha: () =>
    http
      .get<{ id: string; question: string; expiresInSeconds: number }>('/auth/captcha')
      .then((response) => response.data),

  register: (payload: {
    firstName: string
    lastName: string
    email: string
    phone?: string
    password: string
    passwordRepeat: string
    role?: 'STUDENT' | 'TEACHER' | 'PARENT'
    message?: string
    inviteCode?: string
    birthDate: string
    guardianName?: string
    guardianPhone?: string
    guardianConsent?: true
    acceptTerms: true
    acceptPrivacy: true
    acceptDataProcessing: true
    acceptMarketing: boolean
  }) => http.post('/access/registration', payload).then((response) => response.data as { message: string }),

  registrations: (status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL') =>
    http
      .get<RegistrationItem[]>('/access/registrations', { params: { status } })
      .then((response) => response.data),

  decide: (id: string, approve: boolean, reason?: string) =>
    http
      .post(`/access/registrations/${id}/decision`, { approve, reason })
      .then((response) => response.data),

  invitations: () => http.get<InvitationItem[]>('/access/invitations').then((response) => response.data),

  createInvitation: (payload: {
    channel: 'LINK' | 'CODE' | 'EMAIL' | 'PHONE'
    role: SessionRole
    email?: string
    phone?: string
    note?: string
    ttlHours?: number
  }) => http.post<InvitationItem>('/access/invitations', payload).then((response) => response.data),

  previewInvitation: (code: string) =>
    http
      .get<{
        code: string
        role: SessionRole
        email: string | null
        phone: string | null
        expiresAt: string
        note: string | null
      }>(`/access/invitations/${encodeURIComponent(code)}`)
      .then((response) => response.data),

  acceptInvitation: (payload: {
    code: string
    firstName: string
    lastName: string
    email: string
    phone?: string
    birthDate: string
    guardianName?: string
    guardianPhone?: string
    guardianConsent?: true
    password: string
    passwordRepeat: string
  }) => http.post('/access/invitations/accept', payload).then((response) => response.data as LoginResult),

  requestRecovery: (identifier: string) =>
    http
      .post<{ channel: 'email' | 'sms'; message: string }>('/auth/password/request', { identifier })
      .then((response) => response.data),

  confirmRecovery: (payload: {
    identifier: string
    code: string
    password: string
    passwordRepeat: string
  }) => http.post('/auth/password/confirm', payload).then((response) => response.data),

  oauthLogin: (provider: 'google' | 'apple', idToken: string) =>
    http.post(`/auth/oauth/${provider}`, { idToken }).then((response) => response.data as LoginResult & {
      registrationRequired?: true
      email?: string
      firstName?: string
      lastName?: string
      provider?: string
    }),

  verifyTwoFactor: (challengeToken: string, code: string) =>
    http.post('/auth/2fa/verify', { challengeToken, code }).then((response) => response.data as LoginResult),

  setupTwoFactor: () =>
    http
      .post<{ secret: string; otpauthUrl: string }>('/auth/2fa/setup')
      .then((response) => response.data),

  enableTwoFactor: (password: string, code: string) =>
    http
      .post<{ backupCodes: string[]; message: string }>('/auth/2fa/enable', { password, code })
      .then((response) => response.data),

  disableTwoFactor: (password: string) => http.post('/auth/2fa/disable', { password }),

  /** Повторный ввод пароля: токен живёт 10 минут и уходит в заголовке X-Step-Up-Token. */
  stepUp: async (password: string) => {
    const response = await http.post<{ stepUpToken: string }>('/auth/step-up', { password })
    setStepUpToken(response.data.stepUpToken)
    return response.data
  },

  sessions: () =>
    http
      .get<{
        items: Array<{
          id: string
          ip: string | null
          userAgent: string | null
          createdAt: string
          expiresAt: string
          current: boolean
        }>
      }>('/auth/sessions')
      .then((response) => response.data.items),

  revokeSession: (id: string) => http.delete(`/auth/sessions/${id}`),

  logoutAll: () => http.post('/auth/logout-all'),

  resetAccess: (userId: string, newPassword?: string) =>
    http
      .post<{ temporaryPassword: string | null; message: string }>(`/access/users/${userId}/reset-access`, {
        ...(newPassword ? { newPassword } : {}),
      })
      .then((response) => response.data),
}
