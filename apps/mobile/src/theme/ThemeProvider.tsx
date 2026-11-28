import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { useColorScheme, type ViewStyle } from 'react-native'
import { useThemeStore, type ThemeMode } from '@/store/theme'
import { palettes, type ColorScheme, type Palette } from './palette'

interface Theme {
  scheme: ColorScheme
  mode: ThemeMode
  colors: Palette
  /** Тень карточки подобрана под тему: на тёмном фоне тень почти не видна, нужна граница. */
  shadow: {
    card: ViewStyle
    floating: ViewStyle
  }
  setMode: (mode: ThemeMode) => void
}

const lightShadow = {
  card: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  } satisfies ViewStyle,
  floating: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  } satisfies ViewStyle,
}

const darkShadow = {
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  } satisfies ViewStyle,
  floating: {
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  } satisfies ViewStyle,
}

const ThemeContext = createContext<Theme | null>(null)

const fallbackTheme: Theme = {
  scheme: 'light',
  mode: 'light',
  colors: palettes.light,
  shadow: lightShadow,
  setMode: () => undefined,
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme()
  const mode = useThemeStore((state) => state.mode)
  const hydrate = useThemeStore((state) => state.hydrate)
  const setMode = useThemeStore((state) => state.setMode)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  const theme = useMemo<Theme>(() => {
    const scheme: ColorScheme = mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode
    return {
      scheme,
      mode,
      colors: palettes[scheme],
      shadow: scheme === 'dark' ? darkShadow : lightShadow,
      setMode: (next) => void setMode(next),
    }
  }, [mode, systemScheme, setMode])

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}

export function useTheme(): Theme {
  return useContext(ThemeContext) ?? fallbackTheme
}

/** Создаёт StyleSheet один раз на палитру и пересоздаёт при смене темы. */
export function useThemedStyles<T>(factory: (colors: Palette, theme: Theme) => T): T {
  const theme = useTheme()
  return useMemo(() => factory(theme.colors, theme), [factory, theme])
}
