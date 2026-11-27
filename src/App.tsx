import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownUp,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronDown,
  Database,
  FileText,
  HardDrive,
  LayoutDashboard,
  ListChecks,
  Landmark,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PieChart,
  Plus,
  Repeat,
  Search,
  Settings,
  Target,
  TrendingUp,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

import SupabaseStatus from './components/SupabaseStatus'
import UserAccount from './components/UserAccount'
import GlobalSearch from './components/GlobalSearch'
import Accounts from './pages/Accounts'
import Transactions from './pages/Transactions'
import Transfers from './pages/Transfers'
import Investments from './pages/Investments'
import Budgets from './pages/Budgets'
import Goals from './pages/Goals'
import Reports from './pages/Reports'
import RecurringTransactions from './pages/RecurringTransactions'
import BackupRestore from './pages/BackupRestore'
import SettingsPage from './pages/Settings'
import Dashboard from './pages/Dashboard'
import OfflineData from './pages/OfflineData'
import OfflineTransactions from './pages/OfflineTransactions'
import { usePreferences } from './context/PreferencesContext'
import { useAuth } from './context/AuthContext'
import { usePwa } from './context/PwaContext'

const navigation: { heading: string; items: { label: string; icon: LucideIcon; path: string }[] }[] = [
  { heading: 'OVERVIEW', items: [{ label: 'Dashboard', icon: LayoutDashboard, path: '/' }] },
  { heading: 'MONEY', items: [
    { label: 'Transactions', icon: ArrowLeftRight, path: '/transactions' },
    { label: 'Transfers', icon: ArrowDownUp, path: '/transfers' },
    { label: 'Accounts', icon: Wallet, path: '/accounts' },
  ] },
  { heading: 'PLANNING', items: [
    { label: 'Investments & GPF', icon: TrendingUp, path: '/investments' },
    { label: 'Budgets', icon: PieChart, path: '/budgets' },
    { label: 'Financial Goals', icon: Target, path: '/goals' },
    { label: 'Recurring', icon: Repeat, path: '/recurring' },
  ] },
  { heading: 'INSIGHTS', items: [{ label: 'Reports & Analytics', icon: FileText, path: '/reports' }] },
  { heading: 'SYSTEM', items: [
    { label: 'Offline Data', icon: Database, path: '/offline' },
    { label: 'Pending Transactions', icon: ListChecks, path: '/offline-queue' },
    { label: 'Backup & Restore', icon: HardDrive, path: '/backup' },
    { label: 'Settings', icon: Settings, path: '/settings' },
  ] },
]

const quickActions = [
  { label: 'Record income', description: 'Salary, interest or other receipts', icon: ArrowUpRight, path: '/transactions?new=income' },
  { label: 'Record expense', description: 'Purchases, bills and everyday spending', icon: ArrowLeftRight, path: '/transactions?new=expense' },
  { label: 'Transfer money', description: 'Move money between your accounts', icon: ArrowDownUp, path: '/transfers?new=transfer' },
  { label: 'Add account', description: 'Bank, wallet, cash or liability account', icon: Landmark, path: '/accounts?new=account' },
  { label: 'Add investment', description: 'Create an investment instrument', icon: TrendingUp, path: '/investments?new=investment' },
  { label: 'Record GPF contribution', description: 'Post a contribution to your provident fund', icon: Wallet, path: '/investments?new=gpfContribution' },
  { label: 'Record GPF withdrawal', description: 'Record a withdrawal from your provident fund', icon: ArrowDownUp, path: '/investments?new=gpfWithdrawal' },
  { label: 'Add recurring payment', description: 'Create a scheduled income or expense', icon: Repeat, path: '/recurring?new=recurring' },
]

function pageTitle(pathname: string) {
  if (pathname.startsWith('/transactions')) return 'Transactions'
  if (pathname.startsWith('/transfers')) return 'Transfers'
  if (pathname.startsWith('/accounts')) return 'Accounts'
  if (pathname.startsWith('/investments')) return 'Investments & GPF'
  if (pathname.startsWith('/budgets')) return 'Budgets'
  if (pathname.startsWith('/goals')) return 'Financial Goals'
  if (pathname.startsWith('/reports')) return 'Reports & Analytics'
  if (pathname.startsWith('/recurring')) return 'Recurring Transactions'
  if (pathname.startsWith('/backup')) return 'Backup & Restore'
  if (pathname.startsWith('/offline-queue')) return 'Pending Transactions'
  if (pathname.startsWith('/offline')) return 'Offline Data'
  if (pathname.startsWith('/settings')) return 'Settings'
  return 'Dashboard'
}

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const { preferences, updatePreferences } = usePreferences()
  const { user } = useAuth()
  const { online, offlineVaultUnlocked, offlineVaultUserId, offlineVaultMetadata, offlineVaultMetadataUserId, syncOfflineData, syncPendingTransactions } = usePwa()
  const landingRedirectApplied = useRef(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    OVERVIEW: true, MONEY: true, PLANNING: true, INSIGHTS: true, SYSTEM: true,
  })

  useEffect(() => {
    if (landingRedirectApplied.current) return
    landingRedirectApplied.current = true
    if (location.pathname === '/' && preferences.defaultLandingPage !== 'Dashboard') {
      const routes: Record<string, string> = {
        Accounts: '/accounts', Transactions: '/transactions', Investments: '/investments',
      }
      navigate(routes[preferences.defaultLandingPage] || '/', { replace: true })
    }
  }, [location.pathname, navigate, preferences.defaultLandingPage])

  const wasOnlineRef = useRef(online)

  useEffect(() => {
    const justReconnected = !wasOnlineRef.current && online
    wasOnlineRef.current = online
    if (justReconnected && user?.id && offlineVaultUnlocked && offlineVaultUserId === user.id) {
      void (async () => {
        await syncPendingTransactions(user.id)
        await syncOfflineData(user.id)
      })().catch(error => {
        console.warn('Ledger offline synchronization failed:', error instanceof Error ? error.message : error)
      })
    }
  }, [online, user?.id, offlineVaultUnlocked, offlineVaultUserId, syncOfflineData, syncPendingTransactions])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTyping = Boolean(
        target &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      )

      if (event.key === 'Escape') {
        if (globalSearchOpen) setGlobalSearchOpen(false)
        if (quickAddOpen) setQuickAddOpen(false)
        if (mobileSidebarOpen) setMobileSidebarOpen(false)
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setQuickAddOpen(false)
        setGlobalSearchOpen(true)
        return
      }

      if (event.ctrlKey || event.metaKey || event.altKey || isTyping || globalSearchOpen) return

      const key = event.key.toLowerCase()
      if (key === '/') {
        event.preventDefault()
        setQuickAddOpen(false)
        setGlobalSearchOpen(true)
      } else if (key === 'n') {
        event.preventDefault()
        setQuickAddOpen(true)
      } else if (key === 'i') {
        event.preventDefault()
        navigate('/transactions?new=income')
      } else if (key === 'e') {
        event.preventDefault()
        navigate('/transactions?new=expense')
      } else if (key === 't') {
        event.preventDefault()
        navigate('/transfers?new=transfer')
      }
    }

    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [globalSearchOpen, quickAddOpen, mobileSidebarOpen, navigate])

  useEffect(() => {
    setQuickAddOpen(false)
    setMobileSidebarOpen(false)
  }, [location.pathname, location.search])

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    if (path === '/offline' || path === '/offline-queue') return location.pathname === path
    return location.pathname.startsWith(path)
  }
  const currentTitle = pageTitle(location.pathname)

  return (
    <div className="ledger-app min-h-screen bg-ledger-bg text-slate-800" data-sidebar-collapsed={String(preferences.sidebarCollapsed)}>
      {mobileSidebarOpen && <button aria-label="Close navigation" onClick={() => setMobileSidebarOpen(false)} className="fixed inset-0 z-40 bg-[#0A2540]/35 backdrop-blur-[2px] lg:hidden"/>}

      <aside className={`fixed inset-y-0 left-0 z-50 flex w-[252px] flex-col border-r border-[var(--ledger-border)] bg-white text-[#26364A] transition-all duration-200 lg:translate-x-0 ${preferences.sidebarCollapsed ? 'lg:w-[76px]' : 'lg:w-[252px]'} ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className={`sidebar-brand flex h-[72px] shrink-0 items-center justify-between border-b border-[var(--ledger-border)] px-5 ${preferences.sidebarCollapsed ? 'lg:justify-center lg:px-0' : ''}`}>
          <button type="button" onClick={() => navigate('/')} className="flex min-w-0 items-center gap-3 text-left">
            <span className="flex h-9 w-9 items-center justify-center rounded-[11px] text-white shadow-sm" style={{ background: 'var(--ledger-accent)' }}><Wallet size={19} strokeWidth={2.2}/></span>
            <span className="sidebar-brand-copy"><span className="block text-[18px] font-semibold tracking-[-0.04em] text-[var(--ledger-heading)]">Ledger</span><span className="mt-[-1px] block text-[9px] font-semibold tracking-[0.16em] ledger-muted">PERSONAL FINANCE</span></span>
          </button>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => updatePreferences({ sidebarCollapsed: !preferences.sidebarCollapsed })} className="hidden rounded-lg p-2 text-[#8A96A8] transition hover:bg-[var(--ledger-surface-muted)] lg:flex" aria-label={preferences.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={preferences.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{preferences.sidebarCollapsed ? <PanelLeftOpen size={17}/> : <PanelLeftClose size={17}/>}</button>
            <button type="button" onClick={() => setMobileSidebarOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 lg:hidden" aria-label="Close menu"><X size={19}/></button>
          </div>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-5">
          {navigation.map(group => {
            const expanded = expandedGroups[group.heading]
            return <div key={group.heading}>
              <button type="button" onClick={() => setExpandedGroups(current => ({ ...current, [group.heading]: !current[group.heading] }))} className="sidebar-nav-heading mb-2 flex w-full items-center justify-between px-3 text-[10px] font-semibold tracking-[0.13em] text-[#98A3B3]">
                <span>{group.heading}</span><ChevronDown size={13} className={`transition-transform ${expanded ? '' : '-rotate-90'} ${preferences.sidebarCollapsed ? 'lg:hidden' : ''}`}/>
              </button>
              {(expanded || preferences.sidebarCollapsed) && <div className="space-y-1">
                {group.items.map(item => {
                  const Icon = item.icon
                  const active = isActive(item.path)
                  return <button key={item.path} type="button" aria-current={active ? 'page' : undefined} onClick={() => navigate(item.path)} title={preferences.sidebarCollapsed ? item.label : undefined} className={`sidebar-nav-button group flex w-full items-center gap-3 rounded-[10px] px-3 py-[10px] text-left text-[13px] font-medium transition-colors ${active ? 'bg-[var(--ledger-accent-soft)] text-[var(--ledger-accent)]' : 'text-[#627187] hover:bg-[var(--ledger-surface-muted)] hover:text-[#26364A]'}`}>
                    <Icon size={17} strokeWidth={active ? 2.25 : 1.9} className={active ? '' : 'text-[#8491A3] group-hover:text-[#52647C]'}/><span className="sidebar-nav-label flex-1">{item.label}</span>{active && <span className="sidebar-active-dot h-1.5 w-1.5 rounded-full" style={{ background: 'var(--ledger-accent)' }}/>} 
                  </button>
                })}
              </div>}
            </div>
          })}
        </nav>

        <div className="shrink-0 border-t border-[var(--ledger-border)] p-3"><UserAccount/></div>
      </aside>

      <div className={`min-h-screen transition-[margin] duration-200 ${preferences.sidebarCollapsed ? 'lg:ml-[76px]' : 'lg:ml-[252px]'}`}>
        <header className={`sticky top-0 ${quickAddOpen ? 'z-[60] lg:z-30' : 'z-30'} flex h-[68px] items-center justify-between gap-3 border-b border-[var(--ledger-border)] bg-[var(--ledger-surface)]/95 px-4 lg:backdrop-blur-xl md:px-7`}>
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={() => setMobileSidebarOpen(true)} className="rounded-lg p-2 text-[#64748B] hover:bg-[var(--ledger-surface-muted)] lg:hidden" aria-label="Open menu"><Menu size={21}/></button>
            <div className="min-w-0"><h2 className="truncate text-[16px] font-semibold tracking-[-0.025em] text-[var(--ledger-heading)]">{currentTitle}</h2><p className="hidden text-[10px] ledger-muted sm:block">Your personal finance workspace</p></div>
          </div>

          <div className="flex min-w-0 items-center gap-2 md:gap-3">
            <button
              type="button"
              onClick={() => { setQuickAddOpen(false); setGlobalSearchOpen(true) }}
              className="inline-flex min-w-0 items-center gap-2 rounded-[10px] border border-[var(--ledger-border)] bg-[var(--ledger-surface-muted)] px-3 py-2.5 text-left text-[12px] text-[var(--ledger-muted)] transition hover:border-[var(--ledger-accent)] hover:bg-[var(--ledger-surface)] sm:min-w-[180px] md:min-w-[230px]"
              aria-label="Search Ledger records"
            >
              <Search size={15} className="shrink-0"/>
              <span className="hidden flex-1 truncate sm:inline">Search anything…</span>
              <span className="flex-1 sm:hidden">Search</span>
              <kbd className="hidden rounded border border-[var(--ledger-border)] bg-[var(--ledger-surface)] px-1.5 py-0.5 text-[9px] sm:inline">Ctrl K</kbd>
            </button>

            <div className="relative">
              <button type="button" onClick={() => setQuickAddOpen(value => !value)} aria-expanded={quickAddOpen} aria-controls="ledger-quick-actions" className="inline-flex items-center gap-2 rounded-[10px] px-3.5 py-2.5 text-[12px] font-semibold text-white shadow-sm transition hover:brightness-105" style={{ background: 'var(--ledger-accent)' }}><Plus size={16}/><span className="hidden sm:inline">Add transaction</span><ChevronDown size={14}/></button>
              {quickAddOpen && <>
                <button type="button" aria-label="Close quick add menu" onClick={() => setQuickAddOpen(false)} className="fixed inset-0 z-40 cursor-default"/>
                <div id="ledger-quick-actions" className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-3 z-50 max-h-[min(72dvh,480px)] w-[min(92vw,285px)] overflow-y-auto rounded-xl border border-[var(--ledger-border)] bg-[var(--ledger-surface)] p-1.5 shadow-[0_18px_45px_rgba(15,23,42,0.18)] lg:absolute lg:bottom-auto lg:right-0 lg:top-12 lg:max-h-[min(75vh,560px)] lg:w-[285px]">
                  <div className="flex items-center justify-between px-3 pb-2 pt-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] ledger-muted">Quick actions</p>
                    <kbd className="rounded border border-[var(--ledger-border)] px-1.5 py-0.5 text-[9px] ledger-muted">N</kbd>
                  </div>
                  {quickActions.map(action => {
                    const Icon = action.icon
                    const shortcut = action.label === 'Record income' ? 'I'
                      : action.label === 'Record expense' ? 'E'
                        : action.label === 'Transfer money' ? 'T' : ''
                    return <button key={action.path} type="button" onClick={() => { setQuickAddOpen(false); navigate(action.path) }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-[var(--ledger-surface-muted)]">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--ledger-accent-soft)', color: 'var(--ledger-accent)' }}><Icon size={16}/></span>
                      <span className="min-w-0 flex-1"><span className="block text-[12px] font-semibold text-[var(--ledger-heading)]">{action.label}</span><span className="mt-0.5 block text-[10px] ledger-muted">{action.description}</span></span>
                      {shortcut && <kbd className="rounded border border-[var(--ledger-border)] px-1.5 py-1 text-[10px] ledger-muted">{shortcut}</kbd>}
                    </button>
                  })}
                  <div className="mt-1 border-t border-[var(--ledger-border)] px-3 py-2 text-[10px] ledger-muted">Ctrl K · Search all records</div>
                </div>
              </>}
            </div>
            <SupabaseStatus/>
          </div>
        </header>

        <main className="mx-auto max-w-[1520px] space-y-6 px-4 pb-24 pt-6 md:px-7 md:pb-24 md:pt-7 xl:px-9 lg:pb-7">
          {!online && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900"><div className="min-w-0"><p className="text-[11px] font-semibold">Ledger is offline</p><p className="mt-0.5 text-[10px] leading-5">Cloud records cannot refresh. You can view your encrypted snapshot and save income, expenses or transfers to the encrypted pending queue.</p></div><button type="button" onClick={() => navigate(offlineVaultMetadata && offlineVaultMetadataUserId === user?.id ? '/offline' : '/settings?tab=application')} className="shrink-0 rounded-lg bg-amber-700 px-3 py-2 text-[10px] font-semibold text-white">{offlineVaultMetadata && offlineVaultMetadataUserId === user?.id ? 'View / unlock offline data' : 'Set up offline data'}</button></div>}
          {location.pathname.startsWith('/offline-queue') ? <OfflineTransactions/>
            : location.pathname.startsWith('/offline') ? <OfflineData/>
            : location.pathname.startsWith('/accounts') ? <Accounts/>
            : location.pathname.startsWith('/transactions') ? <Transactions/>
            : location.pathname.startsWith('/transfers') ? <Transfers/>
            : location.pathname.startsWith('/investments') ? <Investments/>
            : location.pathname.startsWith('/budgets') ? <Budgets/>
            : location.pathname.startsWith('/goals') ? <Goals/>
            : location.pathname.startsWith('/reports') ? <Reports/>
            : location.pathname.startsWith('/recurring') ? <RecurringTransactions/>
            : location.pathname.startsWith('/backup') ? <BackupRestore/>
            : location.pathname.startsWith('/settings') ? <SettingsPage/>
            : <Dashboard/>}
        </main>
      </div>

      <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-[var(--ledger-border)] bg-[var(--ledger-surface)]/95 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 shadow-[0_-8px_30px_rgba(15,23,42,0.07)] backdrop-blur-xl lg:hidden">
        <button type="button" onClick={() => navigate('/')} className={`flex flex-col items-center gap-1 rounded-lg py-1.5 text-[10px] font-semibold ${location.pathname === '/' ? 'text-[var(--ledger-accent)]' : 'text-[var(--ledger-muted)]'}`}>
          <LayoutDashboard size={19}/><span>Home</span>
        </button>
        <button type="button" onClick={() => navigate('/transactions')} className={`flex flex-col items-center gap-1 rounded-lg py-1.5 text-[10px] font-semibold ${location.pathname.startsWith('/transactions') ? 'text-[var(--ledger-accent)]' : 'text-[var(--ledger-muted)]'}`}>
          <ArrowLeftRight size={19}/><span>Activity</span>
        </button>
        <button type="button" onClick={() => setQuickAddOpen(value => !value)} aria-label="Open quick actions" aria-expanded={quickAddOpen} aria-controls="ledger-quick-actions" className="flex flex-col items-center gap-1 py-0.5 text-[10px] font-semibold text-[var(--ledger-accent)]">
          <span className="flex h-9 w-9 -translate-y-1 items-center justify-center rounded-2xl text-white shadow-md" style={{ background: 'var(--ledger-accent)' }}><Plus size={21}/></span><span className="-mt-1">Add</span>
        </button>
        <button type="button" onClick={() => navigate('/accounts')} className={`flex flex-col items-center gap-1 rounded-lg py-1.5 text-[10px] font-semibold ${location.pathname.startsWith('/accounts') ? 'text-[var(--ledger-accent)]' : 'text-[var(--ledger-muted)]'}`}>
          <Wallet size={19}/><span>Accounts</span>
        </button>
        <button type="button" onClick={() => setMobileSidebarOpen(true)} className="flex flex-col items-center gap-1 rounded-lg py-1.5 text-[10px] font-semibold text-[var(--ledger-muted)]">
          <Menu size={19}/><span>More</span>
        </button>
      </nav>

      <GlobalSearch open={globalSearchOpen} onClose={() => setGlobalSearchOpen(false)} />
    </div>
  )
}
