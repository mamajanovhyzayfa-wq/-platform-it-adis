/** Токены дизайн-системы: общие значения для admin-web и mobile. */
export const colors = {
  brand: '#2563eb',
  brandStrong: '#1d4ed8',
  success: '#15803d',
  warning: '#b45309',
  danger: '#b91c1c',
  ink: '#111827',
  muted: '#6b7280',
  surface: '#ffffff',
  canvas: '#f8fafc',
  border: '#e5e7eb',
} as const

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const

export const typography = {
  family: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
  size: { xs: 12, sm: 14, md: 16, lg: 20, xl: 28 },
  weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
} as const

export const breakpoints = { mobile: 480, tablet: 768, desktop: 1200 } as const
