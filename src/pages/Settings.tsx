import { useEffect, useState, type ReactNode } from 'react'
import {
  Accessibility,
  ArrowDown,
  ArrowUp,
  Check,
  Eye,
  LayoutDashboard,
  Monitor,
  Moon,
  RotateCcw,
  Settings as SettingsIcon,
  ShieldCheck,
  Smartphone,
  SlidersHorizontal,
  Sun,
  Type,
  Wallet,
} from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { usePreferences } from '../context/PreferencesContext'
import PwaSettingsCard from '../components/PwaSettingsCard'
import type {
  AccentColor,
  AppPreferences,
  DashboardWidgets,
  DashboardWidgetKey,
  FontFamily,
  FontSize,
  LandingPage,
  ThemeMode,
} from '../lib/preferences'

type SettingsTab = 'appearance' | 'preferences' | 'dashboard' | 'privacy' | 'application'

const accentOptions: { value: AccentColor; label: string; color: string }[] = [
  { value: 'purple', label: 'Stripe purple', color: '#635BFF' },
  { value: 'blue', label: 'Ocean blue', color: '#2878D0' },
  { value: 'green', label: 'Emerald', color: '#0B9B78' },
  { value: 'amber', label: 'Amber', color: '#D18B32' },
  { value: 'slate', label: 'Slate', color: '#64748B' },
]

const themeOptions: { value: ThemeMode; label: string; description: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', description: 'Bright and clear', icon: Sun },
  { value: 'dark', label: 'Dark', description: 'Comfortable in low light', icon: Moon },
  { value: 'system', label: 'System', description: 'Follow your device', icon: Monitor },
]

const widgetOptions: { key: keyof DashboardWidgets; label: string; description: string }[] = [
  { key: 'summary', label: 'Financial summary', description: 'Net worth, available balance, income and expenses' },
  { key: 'cashflow', label: 'Cash flow chart', description: 'Monthly income and expense trends' },
  { key: 'spending', label: 'Spending breakdown', description: 'Expense categories and monthly totals' },
  { key: 'activity', label: 'Recent activity', description: 'Latest transactions on the dashboard' },
  { key: 'accounts', label: 'Account overview', description: 'Quick view of bank, wallet and cash balances' },
  { key: 'investments', label: 'Investment portfolio', description: 'A compact investment summary' },
  { key: 'upcoming', label: 'Upcoming payments', description: 'Recurring payments due or expected soon' },
]

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-[#26364A]">{title}</p>
        <p className="mt-1 text-[11px] leading-5 text-[#8290A3]">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-[#635BFF]' : 'bg-[#CBD5E1]'}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
      </button>
    </div>
  )
}

function SettingCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-[16px] border border-[#E7EBF1] bg-white p-5 shadow-[0_1px_2px_rgba(16,42,67,0.035)] md:p-6 ${className}`}>
      {children}
    </section>
  )
}

function SelectField({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string
  description?: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="block text-[13px] font-semibold text-[#26364A]">{label}</span>
      {description && <span className="mt-1 block text-[11px] text-[#8290A3]">{description}</span>}
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="mt-2.5 w-full rounded-[10px] border border-[#E1E7EF] bg-white px-3.5 py-2.5 text-[12px] text-[#26364A] outline-none transition focus:border-[#A9A4FF] focus:ring-4 focus:ring-[#635BFF]/[0.08]"
      >
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

export default function SettingsPage() {
  const { preferences, updatePreferences, resetPreferences } = usePreferences()
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance')
  const [searchParams] = useSearchParams()
  const [resetMessage, setResetMessage] = useState('')

  useEffect(() => {
    const requested = searchParams.get('tab')
    if (requested === 'dashboard' || requested === 'appearance' || requested === 'preferences' || requested === 'privacy' || requested === 'application') {
      setActiveTab(requested)
    }
  }, [searchParams])

  const update = <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => {
    updatePreferences({ [key]: value } as Pick<AppPreferences, K>)
  }

  const updateWidget = (key: keyof DashboardWidgets, value: boolean) => {
    updatePreferences({ dashboardWidgets: { [key]: value } })
  }

  const moveWidget = (key: DashboardWidgetKey, direction: -1 | 1) => {
    const order = [...preferences.dashboardWidgetOrder]
    const index = order.indexOf(key)
    const target = index + direction
    if (index < 0 || target < 0 || target >= order.length) return
    ;[order[index], order[target]] = [order[target], order[index]]
    updatePreferences({ dashboardWidgetOrder: order })
  }

  const tabs: { key: SettingsTab; label: string; icon: typeof SettingsIcon }[] = [
    { key: 'appearance', label: 'Appearance', icon: Sun },
    { key: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
    { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { key: 'privacy', label: 'Privacy & accessibility', icon: ShieldCheck },
    { key: 'application', label: 'App & offline', icon: Smartphone },
  ]

  const handleReset = () => {
    if (!window.confirm('Reset all Ledger preferences to their default values?')) return
    resetPreferences()
    setResetMessage('Your preferences have been reset.')
    window.setTimeout(() => setResetMessage(''), 3500)
  }

  return (
    <div className="mx-auto max-w-[1240px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-[11px] font-medium text-[#8A96A8]">PERSONALIZE YOUR WORKSPACE</p>
          <h1 className="text-[27px] font-semibold tracking-[-0.04em] text-[#0A2540]">Settings</h1>
          <p className="mt-1.5 text-[13px] text-[#718096]">Make Ledger comfortable for the way you work.</p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-[#D9EFE7] bg-[#F1FAF6] px-3 py-1.5 text-[10px] font-semibold text-[#177A5D]">
          <Check size={13} /> Saved automatically
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
        <nav className="h-fit rounded-[16px] border border-[#E7EBF1] bg-white p-2 shadow-[0_1px_2px_rgba(16,42,67,0.035)]">
          {tabs.map(tab => {
            const Icon = tab.icon
            const active = activeTab === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-3 text-left text-[12px] font-semibold transition ${active ? 'bg-[#F0EFFF] text-[#5148D8]' : 'text-[#718096] hover:bg-[#F7F8FA] hover:text-[#26364A]'}`}
              >
                <Icon size={16} />
                <span>{tab.label}</span>
              </button>
            )
          })}
          <div className="mt-2 border-t border-[#EEF1F5] px-3 pt-3">
            <p className="text-[10px] leading-5 text-[#98A3B3]">Preferences are stored in this browser and do not change your financial records.</p>
          </div>
        </nav>

        <div className="min-w-0 space-y-5">
          {activeTab === 'appearance' && (
            <>
              <SettingCard>
                <div className="mb-4">
                  <h2 className="text-[15px] font-semibold text-[#0A2540]">Theme</h2>
                  <p className="mt-1 text-[11px] text-[#8290A3]">Choose how Ledger looks across the application.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {themeOptions.map(option => {
                    const Icon = option.icon
                    const selected = preferences.theme === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => update('theme', option.value)}
                        className={`rounded-[12px] border p-3.5 text-left transition ${selected ? 'border-[#8D86FF] bg-[#F8F7FF] ring-2 ring-[#635BFF]/10' : 'border-[#E7EBF1] hover:border-[#C9C5FF]'}`}
                      >
                        <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-[10px] ${selected ? 'bg-[#635BFF] text-white' : 'bg-[#F2F4F8] text-[#718096]'}`}>
                          <Icon size={18} />
                        </div>
                        <p className="text-[12px] font-semibold text-[#26364A]">{option.label}</p>
                        <p className="mt-1 text-[10px] text-[#8290A3]">{option.description}</p>
                      </button>
                    )
                  })}
                </div>
              </SettingCard>

              <SettingCard>
                <div className="mb-4">
                  <h2 className="text-[15px] font-semibold text-[#0A2540]">Accent colour</h2>
                  <p className="mt-1 text-[11px] text-[#8290A3]">Used for primary buttons, active navigation and highlights.</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  {accentOptions.map(option => {
                    const selected = preferences.accent === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => update('accent', option.value)}
                        aria-label={`Use ${option.label} accent`}
                        aria-pressed={selected}
                        className={`flex items-center gap-2 rounded-full border px-3 py-2 text-[11px] font-semibold transition ${selected ? 'border-[#A9A4FF] bg-[#F8F7FF] text-[#5148D8]' : 'border-[#E7EBF1] text-[#718096] hover:border-[#C9C5FF]'}`}
                      >
                        <span className="flex h-5 w-5 items-center justify-center rounded-full" style={{ backgroundColor: option.color }}>
                          {selected && <Check size={12} className="text-white" />}
                        </span>
                        {option.label}
                      </button>
                    )
                  })}
                </div>
              </SettingCard>

              <SettingCard>
                <div className="mb-4 flex items-center gap-2">
                  <Type size={17} className="text-[#635BFF]" />
                  <div>
                    <h2 className="text-[15px] font-semibold text-[#0A2540]">Typography</h2>
                    <p className="mt-1 text-[11px] text-[#8290A3]">Adjust the typeface and reading size.</p>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField
                    label="Font family"
                    value={preferences.fontFamily}
                    options={[
                      { value: 'manrope', label: 'Manrope Variable (Default)' },
                      { value: 'inter-tight', label: 'Inter Tight' },
                      { value: 'inter', label: 'Inter' },
                      { value: 'system', label: 'System default' },
                    ]}
                    onChange={value => update('fontFamily', value as FontFamily)}
                  />
                  <SelectField
                    label="Font size"
                    value={preferences.fontSize}
                    options={[
                      { value: 'small', label: 'Small' },
                      { value: 'default', label: 'Default' },
                      { value: 'large', label: 'Large' },
                    ]}
                    onChange={value => update('fontSize', value as FontSize)}
                  />
                </div>
                <div className="mt-4 rounded-[11px] border border-[#EEF1F5] bg-[#FAFBFD] p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#98A3B3]">Preview</p>
                  <p className="mt-2 text-[20px] font-semibold tracking-[-0.03em] text-[#0A2540]">Your finances, clearly organised.</p>
                  <p className="mt-1 text-[12px] text-[#718096]">Account activity and financial summaries will use your selected typography.</p>
                </div>
              </SettingCard>

              <SettingCard>
                <h2 className="text-[15px] font-semibold text-[#0A2540]">Layout</h2>
                <p className="mt-1 text-[11px] text-[#8290A3]">Choose the amount of space used by tables and navigation.</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {(['comfortable', 'compact'] as const).map(value => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => update('density', value)}
                      className={`rounded-[11px] border p-3 text-left transition ${preferences.density === value ? 'border-[#8D86FF] bg-[#F8F7FF]' : 'border-[#E7EBF1] hover:border-[#C9C5FF]'}`}
                    >
                      <div className="mb-2 space-y-1.5 rounded-md bg-[#F1F3F7] p-2">
                        <div className="h-1.5 w-full rounded bg-[#AAB5C4]" />
                        <div className={`h-1.5 w-4/5 rounded bg-[#C3CBD6] ${value === 'compact' ? '' : 'my-2'}`} />
                        <div className="h-1.5 w-3/5 rounded bg-[#D3D9E2]" />
                      </div>
                      <p className="text-[12px] font-semibold capitalize text-[#26364A]">{value}</p>
                      <p className="mt-1 text-[10px] text-[#8290A3]">{value === 'compact' ? 'More information in less space' : 'More breathing room between items'}</p>
                    </button>
                  ))}
                </div>
                <div className="mt-4 border-t border-[#EEF1F5] pt-1">
                  <ToggleRow title="Collapse sidebar by default" description="Use an icon-only sidebar to create more room for your financial data." checked={preferences.sidebarCollapsed} onChange={value => update('sidebarCollapsed', value)} />
                </div>
              </SettingCard>
            </>
          )}

          {activeTab === 'preferences' && (
            <>
              <SettingCard>
                <div className="mb-4 flex items-center gap-2">
                  <Wallet size={17} className="text-[#635BFF]" />
                  <div>
                    <h2 className="text-[15px] font-semibold text-[#0A2540]">Financial display</h2>
                    <p className="mt-1 text-[11px] text-[#8290A3]">These options change how amounts are displayed, not how they are stored.</p>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <span className="block text-[13px] font-semibold text-[#26364A]">Currency</span>
                    <span className="mt-1 block text-[11px] text-[#8290A3]">Ledger is configured for Bangladesh Taka.</span>
                    <div className="mt-2.5 rounded-[10px] border border-[#E1E7EF] bg-[#F7F8FA] px-3.5 py-2.5 text-[12px] font-medium text-[#627187]">Bangladeshi Taka (৳ BDT)</div>
                  </div>
                  <SelectField
                    label="Decimal places"
                    value={String(preferences.currencyDecimals)}
                    options={[
                      { value: '0', label: 'No decimal places (৳1,250)' },
                      { value: '2', label: 'Two decimal places (৳1,250.00)' },
                    ]}
                    onChange={value => update('currencyDecimals', Number(value) as 0 | 2)}
                  />
                </div>
              </SettingCard>

              <SettingCard>
                <h2 className="text-[15px] font-semibold text-[#0A2540]">Date and navigation</h2>
                <p className="mt-1 text-[11px] text-[#8290A3]">Set how dates appear and which page opens when you enter Ledger.</p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <SelectField
                    label="Date format"
                    value={preferences.dateFormat}
                    options={[
                      { value: 'dd MMM yyyy', label: '23 Nov 2026' },
                      { value: 'dd/MM/yyyy', label: '23/11/2026' },
                      { value: 'yyyy-MM-dd', label: '2026-11-23' },
                    ]}
                    onChange={value => update('dateFormat', value as AppPreferences['dateFormat'])}
                  />
                  <SelectField
                    label="Default landing page"
                    value={preferences.defaultLandingPage}
                    options={[
                      { value: 'Dashboard', label: 'Dashboard' },
                      { value: 'Accounts', label: 'Accounts' },
                      { value: 'Transactions', label: 'Transactions' },
                      { value: 'Investments', label: 'Investments & GPF' },
                    ]}
                    onChange={value => update('defaultLandingPage', value as LandingPage)}
                  />
                </div>
              </SettingCard>
            </>
          )}

          {activeTab === 'dashboard' && (
            <SettingCard>
              <div className="mb-3 flex items-center gap-2">
                <LayoutDashboard size={17} className="text-[#635BFF]" />
                <div>
                  <h2 className="text-[15px] font-semibold text-[#0A2540]">Dashboard sections</h2>
                  <p className="mt-1 text-[11px] text-[#8290A3]">Choose which panels appear on your overview page.</p>
                </div>
              </div>
              <div className="divide-y divide-[#EEF1F5]">
                {widgetOptions.map(option => (
                  <ToggleRow
                    key={option.key}
                    title={option.label}
                    description={option.description}
                    checked={preferences.dashboardWidgets[option.key]}
                    onChange={value => updateWidget(option.key, value)}
                  />
                ))}
              </div>
              <div className="mt-5 border-t border-[#EEF1F5] pt-4">
                <h3 className="text-[13px] font-semibold text-[#26364A]">Widget order</h3>
                <p className="mt-1 text-[11px] text-[#8290A3]">Choose the order in which enabled panels appear on your dashboard.</p>
                <div className="mt-3 space-y-2">
                  {preferences.dashboardWidgetOrder.map((key, index) => {
                    const option = widgetOptions.find(item => item.key === key)
                    if (!option) return null
                    return (
                      <div key={key} className={`flex items-center justify-between gap-3 rounded-[10px] border px-3 py-2.5 ${preferences.dashboardWidgets[key] ? 'border-[#E7EBF1] bg-white' : 'border-[#EEF1F5] bg-[#FAFBFD] opacity-60'}`}>
                        <span className="text-[12px] font-medium text-[#26364A]">{option.label}</span>
                        <span className="flex items-center gap-1">
                          <button type="button" onClick={() => moveWidget(key, -1)} disabled={index === 0} aria-label={`Move ${option.label} up`} className="rounded-md p-1.5 text-[#718096] hover:bg-[#F0EFFF] hover:text-[#5148D8] disabled:opacity-25"><ArrowUp size={14}/></button>
                          <button type="button" onClick={() => moveWidget(key, 1)} disabled={index === preferences.dashboardWidgetOrder.length - 1} aria-label={`Move ${option.label} down`} className="rounded-md p-1.5 text-[#718096] hover:bg-[#F0EFFF] hover:text-[#5148D8] disabled:opacity-25"><ArrowDown size={14}/></button>
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </SettingCard>
          )}

          {activeTab === 'application' && <PwaSettingsCard />}

          {activeTab === 'privacy' && (
            <>
              <SettingCard>
                <div className="mb-3 flex items-center gap-2">
                  <Eye size={17} className="text-[#635BFF]" />
                  <div>
                    <h2 className="text-[15px] font-semibold text-[#0A2540]">Privacy</h2>
                    <p className="mt-1 text-[11px] text-[#8290A3]">Control what is visible while using Ledger.</p>
                  </div>
                </div>
                <div className="divide-y divide-[#EEF1F5]">
                  <ToggleRow title="Hide financial amounts" description="Mask displayed balances and monetary values on screen. This does not encrypt or change stored data." checked={preferences.hideBalances} onChange={value => update('hideBalances', value)} />
                </div>
              </SettingCard>

              <SettingCard>
                <div className="mb-3 flex items-center gap-2">
                  <Accessibility size={17} className="text-[#635BFF]" />
                  <div>
                    <h2 className="text-[15px] font-semibold text-[#0A2540]">Accessibility</h2>
                    <p className="mt-1 text-[11px] text-[#8290A3]">Make the interface easier to read and navigate.</p>
                  </div>
                </div>
                <div className="divide-y divide-[#EEF1F5]">
                  <ToggleRow title="High contrast" description="Increase text and border contrast across the interface." checked={preferences.highContrast} onChange={value => update('highContrast', value)} />
                  <ToggleRow title="Reduce animations" description="Limit transitions and motion effects throughout Ledger." checked={preferences.reducedMotion} onChange={value => update('reducedMotion', value)} />
                </div>
              </SettingCard>

              <div className="rounded-[13px] border border-[#F1DDAA] bg-[#FFF9E9] p-4">
                <div className="flex items-start gap-2.5">
                  <ShieldCheck size={17} className="mt-0.5 shrink-0 text-[#9A6A16]" />
                  <div>
                    <p className="text-[12px] font-semibold text-[#805B1A]">Financial safety</p>
                    <p className="mt-1 text-[11px] leading-5 text-[#8C713C]">Confirmation prompts for permanent deletion remain enabled to help prevent accidental loss of financial records.</p>
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[#E7EBF1] bg-white p-4">
            <div>
              <p className="text-[12px] font-semibold text-[#26364A]">Reset preferences</p>
              <p className="mt-1 text-[10px] text-[#8290A3]">Restore the original Ledger appearance and behaviour.</p>
              {resetMessage && <p role="status" className="mt-1 text-[10px] font-semibold text-[#0B9B78]">{resetMessage}</p>}
            </div>
            <button type="button" onClick={handleReset} className="inline-flex items-center gap-2 rounded-[9px] border border-[#E1E7EF] px-3.5 py-2.5 text-[11px] font-semibold text-[#627187] transition hover:border-[#C9C5FF] hover:bg-[#F8F7FF] hover:text-[#5148D8]">
              <RotateCcw size={14} /> Reset to defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
