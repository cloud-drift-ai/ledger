import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CalendarDays,
  Database,
  Landmark,
  Lock,
  LoaderCircle,
  Search,
  ShieldCheck,
  Smartphone,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { usePwa } from '../context/PwaContext'
import { usePreferences } from '../context/PreferencesContext'
import { formatBDTMinor, formatLedgerDate } from '../lib/preferences'
import type { OfflineInvestment, OfflineInvestmentActivity } from '../lib/offlineVault'

type OfflineTab = 'accounts' | 'transactions' | 'investments' | 'gpf'

function formatTimestamp(value: string | null | undefined) {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function AccountIcon({ subtype }: { subtype: string | null }) {
  if (subtype === 'mobile_wallet') return <Smartphone size={18}/>
  if (subtype === 'cash') return <Wallet size={18}/>
  return <Landmark size={18}/>
}

function instrumentTone(type: string) {
  if (type === 'gpf') return 'bg-emerald-50 text-emerald-700'
  if (type === 'fdr') return 'bg-blue-50 text-blue-700'
  if (type === 'dps') return 'bg-teal-50 text-teal-700'
  if (type === 'savings_certificate') return 'bg-amber-50 text-amber-700'
  if (type === 'stock') return 'bg-violet-50 text-violet-700'
  if (type === 'mutual_fund') return 'bg-cyan-50 text-cyan-700'
  if (type === 'gold') return 'bg-yellow-50 text-yellow-800'
  return 'bg-slate-100 text-slate-700'
}

function instrumentLabel(type: string) {
  const labels: Record<string, string> = {
    fdr: 'Fixed Deposit (FDR)',
    dps: 'DPS',
    savings_certificate: 'Savings Certificate',
    stock: 'Stocks / Shares',
    mutual_fund: 'Mutual Fund',
    gold: 'Gold',
    gpf: 'General Provident Fund',
    other: 'Other Investment',
  }
  return labels[type] || type.replace(/_/g, ' ')
}

function activityLabel(type: string) {
  const labels: Record<string, string> = {
    purchase: 'Purchase', sale: 'Sale', contribution: 'Contribution',
    withdrawal: 'Withdrawal / Advance', dividend: 'Dividend', interest: 'Interest',
    fee: 'Fee', maturity: 'Maturity', adjustment: 'Adjustment',
  }
  return labels[type] || type.replace(/_/g, ' ')
}

function EmptyState({ children }: { children: string }) {
  return <p className="py-8 text-center text-[11px] text-[var(--ledger-muted)]">{children}</p>
}

function ActivityTable({
  rows,
  money,
  emptyLabel,
}: {
  rows: OfflineInvestmentActivity[]
  money: (minor: number) => string
  emptyLabel: string
}) {
  if (!rows.length) return <EmptyState>{emptyLabel}</EmptyState>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-left">
        <thead><tr className="border-b border-[var(--ledger-border)] text-[9px] font-semibold uppercase tracking-wider text-[var(--ledger-muted)]">
          <th className="px-2 py-3">Date</th><th className="px-2 py-3">Investment</th><th className="px-2 py-3">Activity</th><th className="px-2 py-3 text-right">Amount</th><th className="px-2 py-3 text-right">Fees</th><th className="px-2 py-3">Notes</th>
        </tr></thead>
        <tbody>{rows.map(row => (
          <tr key={row.id} className="border-b border-[var(--ledger-border)] last:border-0">
            <td className="whitespace-nowrap px-2 py-3 text-[10px] text-[var(--ledger-muted)]">{formatLedgerDate(row.date)}</td>
            <td className="max-w-[180px] px-2 py-3"><p className="truncate text-[10px] font-semibold text-[var(--ledger-heading)]">{row.instrumentName}</p><p className="mt-0.5 text-[9px] text-[var(--ledger-muted)]">{row.fundingMode?.replace(/_/g, ' ') || '—'}</p></td>
            <td className="px-2 py-3"><span className="rounded-full bg-[var(--ledger-surface-muted)] px-2 py-1 text-[9px] font-medium text-[var(--ledger-heading)]">{activityLabel(row.activityType)}</span></td>
            <td className="whitespace-nowrap px-2 py-3 text-right text-[10px] font-semibold text-[var(--ledger-heading)]">{money(row.amountMinor)}</td>
            <td className="whitespace-nowrap px-2 py-3 text-right text-[10px] text-[var(--ledger-muted)]">{row.feesMinor ? money(row.feesMinor) : '—'}</td>
            <td className="max-w-[180px] px-2 py-3 text-[9px] text-[var(--ledger-muted)]"><span className="block truncate">{row.notes || row.counterpartyAccountName || '—'}</span></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

export default function OfflineData() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { preferences } = usePreferences()
  const {
    online,
    offlineVaultMetadata,
    offlineVaultMetadataUserId,
    offlineVaultUnlocked,
    offlineVaultUserId,
    offlineSnapshot,
    refreshOfflineVault,
    unlockOfflineVault,
    lockOfflineVault,
  } = usePwa()

  const [checkingVault, setCheckingVault] = useState(true)
  const [passphrase, setPassphrase] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const [unlockError, setUnlockError] = useState('')
  const [activeTab, setActiveTab] = useState<OfflineTab>('accounts')
  const [accountSearch, setAccountSearch] = useState('')
  const [transactionSearch, setTransactionSearch] = useState('')
  const [transactionType, setTransactionType] = useState<'all' | 'income' | 'expense'>('all')
  const [investmentSearch, setInvestmentSearch] = useState('')
  const [investmentActivitySearch, setInvestmentActivitySearch] = useState('')
  const [gpfActivitySearch, setGpfActivitySearch] = useState('')

  const hasVault = Boolean(user?.id && offlineVaultMetadataUserId === user.id && offlineVaultMetadata)
  const unlockedForUser = Boolean(user?.id && offlineVaultUnlocked && offlineVaultUserId === user.id)
  const snapshot = unlockedForUser ? offlineSnapshot : null

  useEffect(() => {
    let active = true
    if (!user?.id) {
      setCheckingVault(false)
      return
    }
    setCheckingVault(true)
    void refreshOfflineVault(user.id)
      .catch(error => {
        if (active) setUnlockError(error instanceof Error ? error.message : 'Could not inspect offline storage.')
      })
      .finally(() => {
        if (active) setCheckingVault(false)
      })
    return () => { active = false }
  }, [user?.id, refreshOfflineVault])

  const visibleAccounts = useMemo(() => {
    if (!snapshot) return []
    const query = accountSearch.trim().toLowerCase()
    return snapshot.accounts
      .filter(account => !query || `${account.name} ${account.subtype || ''} ${account.accountType}`.toLowerCase().includes(query))
      .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name))
  }, [snapshot, accountSearch])

  const visibleTransactions = useMemo(() => {
    if (!snapshot) return []
    const query = transactionSearch.trim().toLowerCase()
    return snapshot.transactions.filter(transaction => {
      if (transactionType !== 'all' && transaction.type !== transactionType) return false
      if (!query) return true
      return `${transaction.description} ${transaction.payee} ${transaction.accountName} ${transaction.categoryName} ${transaction.notes} ${transaction.tags.join(' ')} ${transaction.groupName}`.toLowerCase().includes(query)
    })
  }, [snapshot, transactionSearch, transactionType])

  const investments = snapshot?.investments || []
  const investmentActivities = snapshot?.investmentActivities || []
  const investmentValuations = snapshot?.investmentValuations || []
  const gpfProfiles = snapshot?.gpfProfiles || []
  const gpfInstrumentIds = useMemo(() => new Set(investments.filter(item => item.instrumentType === 'gpf').map(item => item.id)), [investments])
  const gpfAccounts = investments.filter(item => item.instrumentType === 'gpf')
  const nonGpfInvestments = investments.filter(item => item.instrumentType !== 'gpf')

  const visibleInvestments = useMemo(() => {
    const query = investmentSearch.trim().toLowerCase()
    return nonGpfInvestments
      .filter(item => !query || `${item.name} ${item.institution} ${item.instrumentType} ${item.accountName} ${item.tickerSymbol}`.toLowerCase().includes(query))
      .sort((a, b) => Number(b.isActive) - Number(a.isActive) || b.currentValueMinor - a.currentValueMinor)
  }, [nonGpfInvestments, investmentSearch])

  const visibleInvestmentActivities = useMemo(() => {
    const query = investmentActivitySearch.trim().toLowerCase()
    return investmentActivities
      .filter(item => !gpfInstrumentIds.has(item.instrumentId))
      .filter(item => !query || `${item.instrumentName} ${item.activityType} ${item.notes} ${item.counterpartyAccountName}`.toLowerCase().includes(query))
  }, [investmentActivities, investmentActivitySearch, gpfInstrumentIds])

  const visibleGpfActivities = useMemo(() => {
    const query = gpfActivitySearch.trim().toLowerCase()
    return investmentActivities
      .filter(item => gpfInstrumentIds.has(item.instrumentId))
      .filter(item => !query || `${item.instrumentName} ${item.activityType} ${item.notes} ${item.fundingMode}`.toLowerCase().includes(query))
  }, [investmentActivities, gpfActivitySearch, gpfInstrumentIds])

  const money = (minor: number) => preferences.hideBalances ? '••••••' : formatBDTMinor(minor)
  const hasInvestmentSnapshot = (snapshot?.schemaVersion ?? 0) >= 2
  const portfolioValue = nonGpfInvestments.filter(item => item.isActive).reduce((sum, item) => sum + item.currentValueMinor, 0)
  const portfolioCost = nonGpfInvestments.filter(item => item.isActive).reduce((sum, item) => sum + item.costBasisMinor, 0)
  const portfolioUnrealized = nonGpfInvestments.filter(item => item.isActive).reduce((sum, item) => sum + item.unrealizedResultMinor, 0)
  const portfolioRealized = nonGpfInvestments.filter(item => item.isActive).reduce((sum, item) => sum + item.realizedResultMinor, 0)
  const portfolioIncome = nonGpfInvestments.filter(item => item.isActive).reduce((sum, item) => sum + item.incomeMinor, 0)
  const gpfBalance = gpfAccounts.filter(item => item.isActive).reduce((sum, item) => sum + item.currentValueMinor, 0)

  const handleUnlock = async () => {
    if (!user?.id) return
    setUnlockError('')
    setUnlocking(true)
    try {
      await unlockOfflineVault(user.id, passphrase)
      setPassphrase('')
    } catch (error) {
      setUnlockError(error instanceof Error ? error.message : 'Could not unlock offline data.')
    } finally {
      setUnlocking(false)
    }
  }

  if (checkingVault) {
    return <div className="flex min-h-[45vh] items-center justify-center gap-2 text-[12px] text-[var(--ledger-muted)]"><LoaderCircle size={17} className="animate-spin"/> Checking encrypted offline data…</div>
  }

  if (!hasVault) {
    return (
      <div className="mx-auto max-w-[680px] rounded-[18px] border border-[var(--ledger-border)] bg-[var(--ledger-surface)] p-7 text-center shadow-sm">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-50 text-violet-700"><Database size={25}/></span>
        <h1 className="mt-4 text-[22px] font-semibold tracking-tight text-[var(--ledger-heading)]">Offline data isn't set up yet</h1>
        <p className="mx-auto mt-2 max-w-[470px] text-[12px] leading-6 text-[var(--ledger-muted)]">Create an encrypted offline vault from Settings. Ledger will save a read-only copy of your accounts, transactions, investments and GPF information on this device.</p>
        <button type="button" onClick={() => navigate('/settings?tab=application')} className="mt-5 rounded-[10px] bg-[var(--ledger-accent)] px-4 py-2.5 text-[11px] font-semibold text-white">Set up offline data</button>
      </div>
    )
  }

  if (unlockedForUser && !snapshot) {
    return (
      <div className="mx-auto max-w-[560px] rounded-[18px] border border-[var(--ledger-border)] bg-[var(--ledger-surface)] p-6 text-center shadow-sm md:p-8">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-700"><Database size={24}/></span>
        <h1 className="mt-4 text-[22px] font-semibold tracking-tight text-[var(--ledger-heading)]">No offline snapshot yet</h1>
        <p className="mt-2 text-[12px] leading-6 text-[var(--ledger-muted)]">Your offline vault is unlocked, but no financial snapshot has been synchronized to this device yet.</p>
        <button type="button" onClick={() => navigate('/settings?tab=application')} className="mt-5 rounded-[10px] bg-[var(--ledger-accent)] px-4 py-2.5 text-[11px] font-semibold text-white">Open settings and sync now</button>
      </div>
    )
  }

  if (!unlockedForUser) {
    return (
      <div className="mx-auto max-w-[560px] rounded-[18px] border border-[var(--ledger-border)] bg-[var(--ledger-surface)] p-6 shadow-sm md:p-8">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-50 text-violet-700"><Lock size={24}/></span>
        <h1 className="mt-4 text-center text-[22px] font-semibold tracking-tight text-[var(--ledger-heading)]">Unlock your offline data</h1>
        <p className="mt-2 text-center text-[12px] leading-6 text-[var(--ledger-muted)]">This device has an encrypted Ledger snapshot. Enter your offline passphrase to decrypt it. You can unlock it without an internet connection.</p>
        <div className="mt-5 rounded-xl bg-[var(--ledger-surface-muted)] p-3.5">
          <div className="flex items-center justify-between gap-3 text-[11px]"><span className="text-[var(--ledger-muted)]">Last successful sync</span><strong className="text-[var(--ledger-heading)]">{offlineVaultMetadata?.lastSyncedAt ? formatTimestamp(offlineVaultMetadata.lastSyncedAt) : 'No snapshot yet'}</strong></div>
        </div>
        <label className="mt-4 block">
          <span className="text-[11px] font-semibold text-[var(--ledger-heading)]">Offline passphrase</span>
          <input type="password" autoComplete="current-password" value={passphrase} onChange={event => setPassphrase(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void handleUnlock() }} placeholder="Enter your offline passphrase" className="mt-1.5 w-full rounded-[10px] border border-[var(--ledger-border)] bg-[var(--ledger-surface)] px-3.5 py-3 text-[12px] text-[var(--ledger-heading)] outline-none focus:border-[var(--ledger-accent)]"/>
        </label>
        {unlockError && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-[11px] leading-5 text-rose-700">{unlockError}</p>}
        <button type="button" onClick={() => void handleUnlock()} disabled={unlocking || !passphrase} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--ledger-accent)] px-4 py-3 text-[11px] font-semibold text-white disabled:opacity-45">
          {unlocking ? <LoaderCircle size={14} className="animate-spin"/> : <ShieldCheck size={14}/>} Unlock offline snapshot
        </button>
        {!online && <p className="mt-3 text-center text-[10px] text-amber-700">Device is offline. Unlocking uses only the encrypted copy stored on this device.</p>}
        {!offlineVaultMetadata?.lastSyncedAt && <button type="button" onClick={() => navigate('/settings?tab=application')} className="mt-3 w-full text-[11px] font-semibold text-[var(--ledger-accent)]">Open offline settings to synchronize your first snapshot</button>}
      </div>
    )
  }

  if (!snapshot) {
    return <div className="rounded-xl border border-[var(--ledger-border)] bg-[var(--ledger-surface)] p-5 text-[11px] text-[var(--ledger-muted)]">The encrypted offline snapshot is not available. Unlock the vault again or synchronize a new copy from Settings.</div>
  }

  const tabs: { id: OfflineTab; label: string; count: number }[] = [
    { id: 'accounts', label: 'Accounts', count: snapshot.accounts.length },
    { id: 'transactions', label: 'Transactions', count: snapshot.transactions.length },
    { id: 'investments', label: 'Investments', count: nonGpfInvestments.length },
    { id: 'gpf', label: 'GPF', count: gpfAccounts.length },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-1 text-[10px] font-semibold tracking-[0.14em] text-[var(--ledger-muted)]">LOCAL ENCRYPTED COPY · VERSION {snapshot.schemaVersion}</p>
          <h1 className="text-[26px] font-semibold tracking-[-0.04em] text-[var(--ledger-heading)]">Offline data</h1>
          <p className="mt-1 text-[12px] text-[var(--ledger-muted)]">Read-only financial information saved on this device.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-3 py-1.5 text-[10px] font-semibold ${online ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{online ? 'Device online' : 'Offline mode'}</span>
          <button type="button" onClick={lockOfflineVault} className="inline-flex items-center gap-2 rounded-[10px] border border-[var(--ledger-border)] px-3 py-2 text-[10px] font-semibold text-[var(--ledger-heading)] hover:bg-[var(--ledger-surface-muted)]"><Lock size={13}/> Lock data</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
        <div className="flex items-start gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0"/><div><p className="text-[11px] font-semibold">Read-only snapshot</p><p className="mt-0.5 text-[10px] leading-5">This is not live data. Do not use it to post, trade or make a payment without reconnecting and checking the latest cloud records.</p></div></div>
        <span className="text-[10px] font-semibold">Synced {formatTimestamp(snapshot.generatedAt)}</span>
      </div>

      {snapshot.schemaVersion < 2 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-blue-900">
          <div><p className="text-[11px] font-semibold">Investment & GPF offline data is not in this snapshot yet.</p><p className="mt-1 text-[10px] leading-5">Connect to the internet, unlock your vault and select Sync now in Settings to upgrade this device's encrypted snapshot.</p></div>
          <button type="button" onClick={() => navigate('/settings?tab=application')} className="rounded-lg bg-blue-700 px-3 py-2 text-[10px] font-semibold text-white">Open sync settings</button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Net worth', value: snapshot.summary.netWorthMinor, tone: 'bg-violet-400' },
          { label: 'Total assets', value: snapshot.summary.assetsMinor, tone: 'bg-blue-400' },
          { label: 'Liabilities', value: snapshot.summary.liabilitiesMinor, tone: 'bg-rose-400' },
          { label: 'Available balance', value: snapshot.summary.availableBalanceMinor, tone: 'bg-teal-400' },
        ].map(item => (
          <div key={item.label} className="rounded-[14px] border border-[var(--ledger-border)] bg-[var(--ledger-surface)] p-4 shadow-sm">
            <p className="text-[10px] font-medium text-[var(--ledger-muted)]">{item.label}</p>
            <p className="mt-2 text-[20px] font-semibold tracking-tight text-[var(--ledger-heading)]">{money(item.value)}</p>
            <span className={`mt-3 inline-block h-1 w-10 rounded-full ${item.tone}`}/>
          </div>
        ))}
      </div>

      <section className="overflow-hidden rounded-[16px] border border-[var(--ledger-border)] bg-[var(--ledger-surface)] shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ledger-border)] p-4 md:p-5">
          <div><h2 className="text-[14px] font-semibold text-[var(--ledger-heading)]">Saved financial records</h2><p className="mt-1 text-[10px] text-[var(--ledger-muted)]">{snapshot.accounts.length} accounts · {snapshot.transactions.length} transactions · {nonGpfInvestments.length} investments · {gpfAccounts.length} GPF accounts</p></div>
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-[var(--ledger-surface-muted)] p-1">
            {tabs.map(tab => (
              <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`shrink-0 rounded-md px-3 py-2 text-[10px] font-semibold ${activeTab === tab.id ? 'bg-[var(--ledger-surface)] text-[var(--ledger-heading)] shadow-sm' : 'text-[var(--ledger-muted)]'}`}>
                {tab.label}<span className="ml-1.5 text-[9px] opacity-65">{tab.count}</span>
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'accounts' && (
          <div className="p-4 md:p-5">
            <div className="relative mb-4 max-w-md"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ledger-muted)]"/><input value={accountSearch} onChange={event => setAccountSearch(event.target.value)} placeholder="Search saved accounts…" className="w-full rounded-[10px] border border-[var(--ledger-border)] bg-[var(--ledger-surface)] py-2.5 pl-9 pr-3 text-[11px] text-[var(--ledger-heading)] outline-none focus:border-[var(--ledger-accent)]"/></div>
            {visibleAccounts.length === 0 ? <EmptyState>No matching accounts in this snapshot.</EmptyState> : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {visibleAccounts.map(account => (
                  <div key={account.id} className="rounded-xl border border-[var(--ledger-border)] bg-[var(--ledger-surface-muted)] p-3.5">
                    <div className="flex items-center gap-2.5"><span className={`flex h-9 w-9 items-center justify-center rounded-xl ${account.accountType === 'liability' ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700'}`}><AccountIcon subtype={account.subtype}/></span><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-semibold text-[var(--ledger-heading)]">{account.name}</p><p className="mt-0.5 text-[9px] text-[var(--ledger-muted)]">{account.subtype?.replace(/_/g, ' ') || account.accountType} · {account.accountType}</p></div>{!account.isActive && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[8px] font-semibold text-slate-600">Archived</span>}</div>
                    <p className="mt-3 text-[17px] font-semibold tracking-tight text-[var(--ledger-heading)]">{money(account.balanceMinor)}</p><p className="mt-1 text-[9px] text-[var(--ledger-muted)]">{account.includeInNetWorth ? 'Included in net worth' : 'Excluded from net worth'}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'transactions' && (
          <div className="p-4 md:p-5">
            <div className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
              <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ledger-muted)]"/><input value={transactionSearch} onChange={event => setTransactionSearch(event.target.value)} placeholder="Search description, payee, account, category or tag…" className="w-full rounded-[10px] border border-[var(--ledger-border)] bg-[var(--ledger-surface)] py-2.5 pl-9 pr-3 text-[11px] text-[var(--ledger-heading)] outline-none focus:border-[var(--ledger-accent)]"/></div>
              <select value={transactionType} onChange={event => setTransactionType(event.target.value as 'all' | 'income' | 'expense')} className="rounded-[10px] border border-[var(--ledger-border)] bg-[var(--ledger-surface)] px-3 py-2.5 text-[11px] text-[var(--ledger-heading)] outline-none"><option value="all">All transactions</option><option value="income">Income only</option><option value="expense">Expenses only</option></select>
            </div>
            {visibleTransactions.length === 0 ? <EmptyState>No matching transactions in this snapshot.</EmptyState> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[680px] border-collapse text-left">
                <thead><tr className="border-b border-[var(--ledger-border)] text-[9px] font-semibold uppercase tracking-wider text-[var(--ledger-muted)]"><th className="px-2 py-3">Date</th><th className="px-2 py-3">Description</th><th className="px-2 py-3">Account / Category</th><th className="px-2 py-3">Tags</th><th className="px-2 py-3 text-right">Amount</th></tr></thead>
                <tbody>{visibleTransactions.map(transaction => (
                  <tr key={transaction.id} className="border-b border-[var(--ledger-border)] last:border-0">
                    <td className="whitespace-nowrap px-2 py-3 text-[10px] text-[var(--ledger-muted)]">{formatLedgerDate(transaction.date)}</td>
                    <td className="max-w-[250px] px-2 py-3"><p className="truncate text-[11px] font-semibold text-[var(--ledger-heading)]">{transaction.description}</p><p className="mt-0.5 truncate text-[9px] text-[var(--ledger-muted)]">{transaction.payee || transaction.notes || '—'}</p></td>
                    <td className="px-2 py-3"><p className="text-[10px] text-[var(--ledger-heading)]">{transaction.accountName}</p><p className="mt-0.5 text-[9px] text-[var(--ledger-muted)]">{transaction.categoryName}</p></td>
                    <td className="px-2 py-3"><div className="flex max-w-[140px] flex-wrap gap-1">{transaction.tags.slice(0, 2).map(tag => <span key={tag} className="rounded-full bg-violet-50 px-2 py-0.5 text-[8px] font-medium text-violet-700">{tag}</span>)}{transaction.groupName && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[8px] font-medium text-blue-700">{transaction.groupName}</span>}</div></td>
                    <td className={`whitespace-nowrap px-2 py-3 text-right text-[11px] font-semibold ${transaction.type === 'income' ? 'text-emerald-700' : 'text-rose-700'}`}>{transaction.type === 'income' ? '+' : '−'}{money(transaction.amountMinor)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
            <p className="mt-3 text-[9px] text-[var(--ledger-muted)]">Showing {visibleTransactions.length} of {snapshot.transactions.length} cached transactions. Only the latest {snapshot.transactionLimit.toLocaleString()} posted income and expense entries are included.</p>
          </div>
        )}

        {activeTab === 'investments' && (
          <div className="space-y-5 p-4 md:p-5">
            {!hasInvestmentSnapshot ? <EmptyState>Sync this device while online to add investment information to the encrypted snapshot.</EmptyState> : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3"><p className="text-[9px] font-semibold uppercase tracking-wide text-blue-700">Current portfolio value</p><p className="mt-2 text-[18px] font-semibold text-blue-950">{money(portfolioValue)}</p></div>
                  <div className="rounded-xl border border-violet-100 bg-violet-50/70 p-3"><p className="text-[9px] font-semibold uppercase tracking-wide text-violet-700">Remaining cost basis</p><p className="mt-2 text-[18px] font-semibold text-violet-950">{money(portfolioCost)}</p></div>
                  <div className={`rounded-xl border p-3 ${portfolioUnrealized >= 0 ? 'border-emerald-100 bg-emerald-50/70' : 'border-rose-100 bg-rose-50/70'}`}><p className={`text-[9px] font-semibold uppercase tracking-wide ${portfolioUnrealized >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>Unrealized result</p><p className={`mt-2 text-[18px] font-semibold ${portfolioUnrealized >= 0 ? 'text-emerald-950' : 'text-rose-950'}`}>{money(portfolioUnrealized)}</p></div>
                  <div className="rounded-xl border border-teal-100 bg-teal-50/70 p-3"><p className="text-[9px] font-semibold uppercase tracking-wide text-teal-700">Realized result</p><p className="mt-2 text-[18px] font-semibold text-teal-950">{money(portfolioRealized)}</p></div>
                  <div className="rounded-xl border border-amber-100 bg-amber-50/70 p-3"><p className="text-[9px] font-semibold uppercase tracking-wide text-amber-700">Interest & dividends</p><p className="mt-2 text-[18px] font-semibold text-amber-950">{money(portfolioIncome)}</p></div>
                </div>
                <div className="relative max-w-md"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ledger-muted)]"/><input value={investmentSearch} onChange={event => setInvestmentSearch(event.target.value)} placeholder="Search investment, institution or type…" className="w-full rounded-[10px] border border-[var(--ledger-border)] bg-[var(--ledger-surface)] py-2.5 pl-9 pr-3 text-[11px] text-[var(--ledger-heading)] outline-none focus:border-[var(--ledger-accent)]"/></div>
                {visibleInvestments.length === 0 ? <EmptyState>No matching investments in this snapshot.</EmptyState> : (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {visibleInvestments.map((item: OfflineInvestment) => (
                      <article key={item.id} className="rounded-xl border border-[var(--ledger-border)] bg-[var(--ledger-surface-muted)] p-4">
                        <div className="flex items-start gap-3"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${instrumentTone(item.instrumentType)}`}><TrendingUp size={18}/></span><div className="min-w-0 flex-1"><h3 className="truncate text-[12px] font-semibold text-[var(--ledger-heading)]">{item.name}</h3><p className="mt-0.5 truncate text-[9px] text-[var(--ledger-muted)]">{item.institution || item.accountName}</p><span className={`mt-2 inline-flex rounded-full px-2 py-1 text-[8px] font-semibold ${instrumentTone(item.instrumentType)}`}>{instrumentLabel(item.instrumentType)}</span>{!item.isActive && <span className="ml-1 mt-2 inline-flex rounded-full bg-slate-200 px-2 py-1 text-[8px] font-semibold text-slate-600">Archived</span>}</div></div>
                        <div className="mt-4 grid grid-cols-2 gap-3"><div><p className="text-[9px] text-[var(--ledger-muted)]">Current value</p><p className="mt-1 text-[15px] font-semibold text-[var(--ledger-heading)]">{money(item.currentValueMinor)}</p></div><div><p className="text-[9px] text-[var(--ledger-muted)]">Cost basis</p><p className="mt-1 text-[12px] font-semibold text-[var(--ledger-heading)]">{money(item.costBasisMinor)}</p></div></div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ledger-border)] pt-3"><span className={`text-[10px] font-semibold ${item.unrealizedResultMinor >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>Unrealized: {money(item.unrealizedResultMinor)}</span><span className="text-[9px] text-[var(--ledger-muted)]">{item.latestValuationDate ? `Valued ${formatLedgerDate(item.latestValuationDate)}` : 'Ledger book value'} · {item.activityCount} activities</span></div>
                        {item.maturityDate && <p className="mt-2 text-[9px] text-[var(--ledger-muted)]">Maturity: {formatLedgerDate(item.maturityDate)}</p>}
                      </article>
                    ))}
                  </div>
                )}
                <div className="overflow-hidden rounded-xl border border-[var(--ledger-border)]"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ledger-border)] p-3"><div><h3 className="text-[11px] font-semibold text-[var(--ledger-heading)]">Investment activity history</h3><p className="mt-0.5 text-[9px] text-[var(--ledger-muted)]">Purchases, sales, income, fees and maturities</p></div><div className="relative w-full sm:w-64"><Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ledger-muted)]"/><input value={investmentActivitySearch} onChange={event => setInvestmentActivitySearch(event.target.value)} placeholder="Search activity…" className="w-full rounded-lg border border-[var(--ledger-border)] bg-[var(--ledger-surface)] py-2 pl-8 pr-2 text-[10px] text-[var(--ledger-heading)] outline-none"/></div></div><div className="p-3"><ActivityTable rows={visibleInvestmentActivities} money={money} emptyLabel="No investment activity in this snapshot."/></div></div>
                <div className="overflow-hidden rounded-xl border border-[var(--ledger-border)]"><div className="border-b border-[var(--ledger-border)] p-3"><h3 className="text-[11px] font-semibold text-[var(--ledger-heading)]">Saved valuation history</h3><p className="mt-0.5 text-[9px] text-[var(--ledger-muted)]">Historical manual/provider valuations stored in Ledger</p></div>{investmentValuations.length ? <div className="overflow-x-auto"><table className="w-full min-w-[620px] border-collapse text-left"><thead><tr className="border-b border-[var(--ledger-border)] text-[9px] font-semibold uppercase tracking-wider text-[var(--ledger-muted)]"><th className="px-3 py-3">Valuation date</th><th className="px-3 py-3">Investment</th><th className="px-3 py-3">Source</th><th className="px-3 py-3 text-right">Market value</th></tr></thead><tbody>{investmentValuations.map(valuation => <tr key={valuation.id} className="border-b border-[var(--ledger-border)] last:border-0"><td className="whitespace-nowrap px-3 py-3 text-[10px] text-[var(--ledger-muted)]">{formatLedgerDate(valuation.date)}</td><td className="px-3 py-3 text-[10px] font-medium text-[var(--ledger-heading)]">{investments.find(item => item.id === valuation.instrumentId)?.name || 'Investment unavailable'}</td><td className="px-3 py-3 text-[9px] text-[var(--ledger-muted)]">{valuation.source.replace(/_/g, ' ')}</td><td className="whitespace-nowrap px-3 py-3 text-right text-[10px] font-semibold text-[var(--ledger-heading)]">{money(valuation.marketValueMinor)}</td></tr>)}</tbody></table></div> : <div className="p-3"><EmptyState>No saved valuations in this snapshot.</EmptyState></div>}</div>
              </>
            )}
          </div>
        )}

        {activeTab === 'gpf' && (
          <div className="space-y-5 p-4 md:p-5">
            {!hasInvestmentSnapshot ? <EmptyState>Sync this device while online to add GPF information to the encrypted snapshot.</EmptyState> : gpfAccounts.length === 0 ? <EmptyState>No GPF account is included in this offline snapshot.</EmptyState> : (
              <>
                <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4"><p className="text-[9px] font-semibold uppercase tracking-wide text-emerald-700">Actual posted GPF balance</p><p className="mt-2 text-[21px] font-semibold text-emerald-950">{money(gpfBalance)}</p><p className="mt-1 text-[9px] text-emerald-800">Based on the linked ledger account balance</p></div><div className="rounded-xl border border-teal-100 bg-teal-50/70 p-4"><p className="text-[9px] font-semibold uppercase tracking-wide text-teal-700">GPF accounts</p><p className="mt-2 text-[21px] font-semibold text-teal-950">{gpfAccounts.length}</p><p className="mt-1 text-[9px] text-teal-800">{gpfProfiles.length} saved GPF profile(s)</p></div></div>
                <div className="grid gap-3 md:grid-cols-2">
                  {gpfAccounts.map(account => {
                    const profile = gpfProfiles.find(item => item.instrumentId === account.id)
                    return <article key={account.id} className="rounded-xl border border-[var(--ledger-border)] bg-[var(--ledger-surface-muted)] p-4"><div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><ShieldCheck size={18}/></span><div className="min-w-0 flex-1"><h3 className="truncate text-[12px] font-semibold text-[var(--ledger-heading)]">{account.name}</h3><p className="text-[9px] text-[var(--ledger-muted)]">{account.institution || account.accountName}</p></div></div><p className="mt-3 text-[19px] font-semibold text-[var(--ledger-heading)]">{money(account.currentValueMinor)}</p>{profile ? <><div className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--ledger-border)] pt-3"><div><p className="text-[9px] text-[var(--ledger-muted)]">Financial year</p><p className="mt-1 text-[10px] font-semibold text-[var(--ledger-heading)]">{profile.financialYear}</p></div><div><p className="text-[9px] text-[var(--ledger-muted)]">Monthly contribution</p><p className="mt-1 text-[10px] font-semibold text-[var(--ledger-heading)]">{money(profile.monthlyContributionMinor)}</p></div><div><p className="text-[9px] text-[var(--ledger-muted)]">Opening balance</p><p className="mt-1 text-[10px] font-semibold text-[var(--ledger-heading)]">{money(profile.openingBalanceMinor)}</p></div><div><p className="text-[9px] text-[var(--ledger-muted)]">Annual increase</p><p className="mt-1 text-[10px] font-semibold text-[var(--ledger-heading)]">{profile.annualContributionIncreasePercent}%</p></div></div>{profile.rateSchedule && <div className="mt-3 rounded-lg bg-[var(--ledger-surface)] p-3"><p className="text-[9px] font-semibold text-[var(--ledger-heading)]">Interest schedule · {profile.rateSchedule.financialYear}</p><p className="mt-1 text-[9px] text-[var(--ledger-muted)]">Effective from {formatLedgerDate(profile.rateSchedule.effectiveFrom)}{profile.rateSchedule.sourceTitle ? ` · ${profile.rateSchedule.sourceTitle}` : ''}</p><div className="mt-2 flex flex-wrap gap-1.5">{profile.rateTiers.map(tier => <span key={tier.id} className="rounded-full bg-emerald-50 px-2 py-1 text-[8px] font-semibold text-emerald-800">{money(tier.lowerBalanceMinor)}–{tier.upperBalanceMinor === null ? 'Above' : money(tier.upperBalanceMinor)} · {(tier.annualRateBasisPoints / 100).toFixed(2)}%</span>)}</div></div>}</> : <p className="mt-2 text-[10px] text-[var(--ledger-muted)]">No GPF calculation profile is linked to this instrument.</p>}</article>
                  })}
                </div>
                <div className="overflow-hidden rounded-xl border border-[var(--ledger-border)]"><div className="border-b border-[var(--ledger-border)] p-3"><h3 className="text-[11px] font-semibold text-[var(--ledger-heading)]">GPF contribution and withdrawal history</h3><p className="mt-0.5 text-[9px] text-[var(--ledger-muted)]">Recorded contributions, withdrawals/advances, interest credits and fees</p><div className="relative mt-3 max-w-sm"><Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ledger-muted)]"/><input value={gpfActivitySearch} onChange={event => setGpfActivitySearch(event.target.value)} placeholder="Search GPF activity…" className="w-full rounded-lg border border-[var(--ledger-border)] bg-[var(--ledger-surface)] py-2 pl-8 pr-2 text-[10px] text-[var(--ledger-heading)] outline-none"/></div></div><div className="p-3"><ActivityTable rows={visibleGpfActivities} money={money} emptyLabel="No GPF activity in this snapshot."/></div></div>
                <div className="overflow-hidden rounded-xl border border-[var(--ledger-border)]"><div className="border-b border-[var(--ledger-border)] p-3"><h3 className="text-[11px] font-semibold text-[var(--ledger-heading)]">Saved GPF calculation history</h3><p className="mt-0.5 text-[9px] text-[var(--ledger-muted)]">These are saved calculation records, not live projections.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[680px] border-collapse text-left"><thead><tr className="border-b border-[var(--ledger-border)] text-[9px] font-semibold uppercase tracking-wider text-[var(--ledger-muted)]"><th className="px-3 py-3">Calculated</th><th className="px-3 py-3">Financial year</th><th className="px-3 py-3 text-right">Closing balance</th><th className="px-3 py-3 text-right">Projected final</th><th className="px-3 py-3 text-right">Projected earnings</th></tr></thead><tbody>{(snapshot.gpfCalculationSnapshots || []).map(item => <tr key={item.id} className="border-b border-[var(--ledger-border)] last:border-0"><td className="whitespace-nowrap px-3 py-3 text-[10px] text-[var(--ledger-muted)]">{formatLedgerDate(item.calculationDate)}</td><td className="px-3 py-3 text-[10px] font-medium text-[var(--ledger-heading)]">{item.financialYear}</td><td className="whitespace-nowrap px-3 py-3 text-right text-[10px] font-semibold text-[var(--ledger-heading)]">{money(item.closingBalanceMinor)}</td><td className="whitespace-nowrap px-3 py-3 text-right text-[10px] text-[var(--ledger-heading)]">{money(item.finalProjectedBalanceMinor)}</td><td className="whitespace-nowrap px-3 py-3 text-right text-[10px] text-emerald-700">{money(item.totalProjectedEarningsMinor)}</td></tr>)}</tbody></table></div>{!(snapshot.gpfCalculationSnapshots || []).length && <div className="p-3"><EmptyState>No saved GPF calculations in this snapshot.</EmptyState></div>}</div>
              </>
            )}
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-[var(--ledger-muted)]"><span>Encrypted on this device · Read-only · No changes are sent while offline</span><span className="inline-flex items-center gap-1"><CalendarDays size={11}/> Snapshot age: {formatTimestamp(snapshot.generatedAt)}</span></div>
    </div>
  )
}
