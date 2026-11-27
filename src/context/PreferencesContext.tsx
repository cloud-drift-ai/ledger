import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  DEFAULT_PREFERENCES,
  readStoredPreferences,
  writeStoredPreferences,
  type AppPreferences,
  type DashboardWidgets,
  type ResolvedTheme,
} from '../lib/preferences'

type PreferencesUpdate = Omit<Partial<AppPreferences>, 'dashboardWidgets'> & {
  dashboardWidgets?: Partial<DashboardWidgets>
}

type PreferencesContextValue = {
  preferences: AppPreferences
  resolvedTheme: ResolvedTheme
  updatePreferences: (updates: PreferencesUpdate) => void
  resetPreferences: () => void
}

const PreferencesContext = createContext<PreferencesContextValue | undefined>(undefined)

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<AppPreferences>(readStoredPreferences)
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return 'light'
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  const resolvedTheme: ResolvedTheme = preferences.theme === 'system'
    ? systemTheme
    : preferences.theme

  const updatePreferences = useCallback((updates: PreferencesUpdate) => {
    const previous = readStoredPreferences()
    const next: AppPreferences = {
      ...previous,
      ...updates,
      dashboardWidgets: updates.dashboardWidgets
        ? { ...previous.dashboardWidgets, ...updates.dashboardWidgets }
        : previous.dashboardWidgets,
    }
    writeStoredPreferences(next)
    setPreferences(next)
  }, [])

  const resetPreferences = useCallback(() => {
    writeStoredPreferences(DEFAULT_PREFERENCES)
    setPreferences(DEFAULT_PREFERENCES)
  }, [])

  useEffect(() => {
    writeStoredPreferences(preferences)
  }, [preferences])

  useEffect(() => {
    if (!window.matchMedia) return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? 'dark' : 'light')
    }
    setSystemTheme(media.matches ? 'dark' : 'light')
    media.addEventListener?.('change', handleChange)
    return () => media.removeEventListener?.('change', handleChange)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = resolvedTheme
    root.dataset.themeMode = preferences.theme
    root.dataset.accent = preferences.accent
    root.dataset.font = preferences.fontFamily
    root.dataset.fontSize = preferences.fontSize
    root.dataset.density = preferences.density
    root.dataset.reducedMotion = String(preferences.reducedMotion)
    root.dataset.highContrast = String(preferences.highContrast)
    root.dataset.hideBalances = String(preferences.hideBalances)
    root.dataset.sidebarCollapsed = String(preferences.sidebarCollapsed)
    root.style.colorScheme = resolvedTheme
  }, [preferences, resolvedTheme])

  const value = useMemo(() => ({
    preferences,
    resolvedTheme,
    updatePreferences,
    resetPreferences,
  }), [preferences, resolvedTheme, updatePreferences, resetPreferences])

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  )
}

export function usePreferences() {
  const context = useContext(PreferencesContext)
  if (!context) {
    throw new Error('usePreferences must be used within PreferencesProvider')
  }
  return context
}
