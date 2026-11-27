export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'
export type AccentColor = 'purple' | 'blue' | 'green' | 'amber' | 'slate'
export type FontFamily = 'manrope' | 'inter-tight' | 'inter' | 'system'
export type FontSize = 'small' | 'default' | 'large'
export type Density = 'compact' | 'comfortable'
export type DateFormat = 'dd MMM yyyy' | 'dd/MM/yyyy' | 'yyyy-MM-dd'
export type LandingPage = 'Dashboard' | 'Accounts' | 'Transactions' | 'Investments'

export type DashboardWidgets = {
  summary: boolean
  cashflow: boolean
  spending: boolean
  activity: boolean
  accounts: boolean
  investments: boolean
  upcoming: boolean
}

export type DashboardWidgetKey = keyof DashboardWidgets

export type AppPreferences = {
  theme: ThemeMode
  accent: AccentColor
  fontFamily: FontFamily
  fontSize: FontSize
  density: Density
  sidebarCollapsed: boolean
  reducedMotion: boolean
  hideBalances: boolean
  highContrast: boolean
  currencyDecimals: 0 | 2
  dateFormat: DateFormat
  defaultLandingPage: LandingPage
  dashboardWidgets: DashboardWidgets
  dashboardWidgetOrder: DashboardWidgetKey[]
}

export const PREFERENCES_STORAGE_KEY = 'ledger.preferences.v1'

let preferencesSnapshot: AppPreferences | null = null

export function writeStoredPreferences(preferences: AppPreferences) {
  preferencesSnapshot = preferences
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // Browser storage can be unavailable in private or restricted sessions.
  }
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  theme: 'light',
  accent: 'purple',
  fontFamily: 'manrope',
  fontSize: 'default',
  density: 'comfortable',
  sidebarCollapsed: false,
  reducedMotion: false,
  hideBalances: false,
  highContrast: false,
  currencyDecimals: 2,
  dateFormat: 'dd MMM yyyy',
  defaultLandingPage: 'Dashboard',
  dashboardWidgets: {
    summary: true,
    cashflow: true,
    spending: true,
    activity: true,
    accounts: true,
    investments: true,
    upcoming: true,
  },
  dashboardWidgetOrder: ['summary', 'cashflow', 'spending', 'activity', 'accounts', 'investments', 'upcoming'],
}

export function readStoredPreferences(): AppPreferences {
  if (preferencesSnapshot) return preferencesSnapshot
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES

  try {
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY)
    if (!raw) return DEFAULT_PREFERENCES

    const parsed = JSON.parse(raw) as Partial<AppPreferences>
    const fontMigrationKey = 'ledger.font-default.manrope.v1'
    const supportedFonts: FontFamily[] = ['manrope', 'inter-tight', 'inter', 'system']
    let storedFontFamily = parsed.fontFamily

    // Existing installations used Inter Tight as the default. Migrate that
    // previous default to Manrope once, while preserving other font choices.
    if (window.localStorage.getItem(fontMigrationKey) !== '1') {
      if (!storedFontFamily || storedFontFamily === 'inter-tight') {
        storedFontFamily = 'manrope'
      }
      window.localStorage.setItem(fontMigrationKey, '1')
    }

    if (!storedFontFamily || !supportedFonts.includes(storedFontFamily)) {
      storedFontFamily = DEFAULT_PREFERENCES.fontFamily
    }

    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
      fontFamily: storedFontFamily,
      dashboardWidgets: {
        ...DEFAULT_PREFERENCES.dashboardWidgets,
        ...(parsed.dashboardWidgets || {}),
      },
      dashboardWidgetOrder: (() => {
        const saved = Array.isArray(parsed.dashboardWidgetOrder)
          ? [...new Set(parsed.dashboardWidgetOrder.filter((key): key is DashboardWidgetKey => typeof key === 'string' && key in DEFAULT_PREFERENCES.dashboardWidgets))]
          : []
        return [...saved, ...DEFAULT_PREFERENCES.dashboardWidgetOrder.filter(key => !saved.includes(key))]
      })(),
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export function getCurrencyDecimals(): 0 | 2 {
  return readStoredPreferences().currencyDecimals === 0 ? 0 : 2
}

export function shouldHideBalances(): boolean {
  return readStoredPreferences().hideBalances
}

export function formatBDTMinor(minor: number | string | null | undefined): string {
  if (shouldHideBalances()) return '••••••'
  const value = Number(minor || 0) / 100
  const sign = value < 0 ? '-' : ''
  const decimals = getCurrencyDecimals()
  return `${sign}৳${new Intl.NumberFormat('en-BD', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Math.abs(value))}`
}

export function formatBDTMajor(amount: number): string {
  if (shouldHideBalances()) return '••••••'
  const decimals = getCurrencyDecimals()
  return `৳${new Intl.NumberFormat('en-BD', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount)}`
}

export function formatBDTCurrencyMinor(minor: number): string {
  if (shouldHideBalances()) return '••••••'
  const decimals = getCurrencyDecimals()
  return new Intl.NumberFormat('en-BD', {
    style: 'currency',
    currency: 'BDT',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(minor / 100)
}

export function formatLedgerDate(value: string | null | undefined): string {
  if (!value) return '—'
  const datePart = value.slice(0, 10)
  const [year, month, day] = datePart.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) return value

  const format = readStoredPreferences().dateFormat
  const dd = String(day).padStart(2, '0')
  const mm = String(month).padStart(2, '0')
  if (format === 'dd/MM/yyyy') return `${dd}/${mm}/${year}`
  if (format === 'yyyy-MM-dd') return `${year}-${mm}-${dd}`
  return new Intl.DateTimeFormat('en-BD', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

export function formatLedgerDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${formatLedgerDate(value)} ${date.toLocaleTimeString('en-BD', {
    hour: '2-digit',
    minute: '2-digit',
  })}`
}
