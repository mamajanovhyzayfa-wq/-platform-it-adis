import axios from 'axios'

const TOKEN_KEY = 'itadis.platform.token'

export type BranchStatus = 'PROVISIONING' | 'PROVISIONED' | 'ACTIVE' | 'FAILED'

export interface BranchStep {
  key: string
  label: string
  status: 'ok' | 'failed'
  detail: string
}

export interface PlatformBranch {
  id: string
  name: string
  slug: string
  domain: string
  status: BranchStatus
  isPrimary: boolean
  adminEmail: string
  adminName: string | null
  steps: BranchStep[] | null
  lastError: string | null
  provisionedAt: string | null
  activatedAt: string | null
  createdAt: string
}

export interface CreateBranchInput {
  name: string
  domain: string
  slug?: string
  adminEmail: string
  adminName: string
  logoUrl?: string
  description?: string
  contactPhone?: string
  contactEmail?: string
  contactAddress?: string
  directions?: string
}

export interface ProvisionResult {
  branch: PlatformBranch
  credentials: { email: string; temporaryPassword: string }
  steps: BranchStep[]
  urls: { site: string; api: string }
}

export function getPlatformToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

function savePlatformToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearPlatformToken() {
  localStorage.removeItem(TOKEN_KEY)
}

const http = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
  timeout: 60_000,
})

http.interceptors.request.use((config) => {
  const token = getPlatformToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export const platformApi = {
  async login(email: string, password: string) {
    const { data } = await http.post<{ token: string; email: string }>('/platform/auth/login', { email, password })
    savePlatformToken(data.token)
    return data
  },
  async branches() {
    const { data } = await http.get<PlatformBranch[]>('/platform/branches')
    return data
  },
  async create(input: CreateBranchInput) {
    const { data } = await http.post<ProvisionResult>('/platform/branches', input)
    return data
  },
  async retry(branchId: string) {
    const { data } = await http.post<ProvisionResult>(`/platform/branches/${branchId}/retry`)
    return data
  },
  async activate(branchId: string) {
    const { data } = await http.post<PlatformBranch>(`/platform/branches/${branchId}/activate`, { confirm: true })
    return data
  },
}
