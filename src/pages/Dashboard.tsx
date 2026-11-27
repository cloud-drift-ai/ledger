import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Activity,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Landmark,
  RefreshCw,
  Settings2,
  Smartphone,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
} from 'chart.js'
import { Line, Doughnut } from 'react-chartjs-2'
import { useNavigate } from 'react-router-dom'

import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { usePreferences } from '../context/PreferencesContext'
import { formatBDTMinor, formatLedgerDate } from '../lib/preferences'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler)

type Account = {
  id: string
  name: string
  account_kind: 'financial' | 'category'
  account_type: 'asset' | 'liability' | 'equity' | 'income' | 'expense'
  subtype: string | null
  include_in_net_worth: boolean
  is_active: boolean
}

type JournalEntry = {
  id: string
  entry_date: string
  transaction_type: string
  description: string | null
  payee: string | null
  status: string
  created_at: string
}

type JournalLine = {
  id: string
  journal_entry_id: string
  ledger_account_id: string
  debit_minor: number | string
  credit_minor: number | string
}

type InvestmentInstrument = {
  id: string
  name: string
  instrument_type: string
  ledger_account_id: string
  is_active: boolean
}

type InvestmentValuation = {
  instrument_id: string
  valuation_date: string
  market_value_minor: number | string
}

type RecurringSchedule = {
  id: string
  name: string
  transaction_type: 'income' | 'expense'
  amount_minor: number | string
  next_due_date: string
  payee: string | null
  status: string
}

type MonthlyTotal = { key: string; label: string; income: number; expenses: number }
type CategoryTotal = { id: string; name: string; amount: number }
type RecentTransaction = {
  id: string
  date: string
  description: string
  payee: string
  category: string
  account: string
  type: 'income' | 'expense'
  amount: number
}
type DashboardData = {
  accounts: { id: string; name: string; subtype: string | null; accountType: string; balance: number }[]
  netWorth: number
  assets: number
  liabilities: number
  availableBalance: number
  monthly: MonthlyTotal[]
  expenseCategoriesByMonth: Record<string, CategoryTotal[]>
  income: number
  expenses: number
  previousIncome: number
  previousExpenses: number
  recentTransactions: RecentTransaction[]
  investments: { id: string; name: string; type: string; value: number }[]
  recurring: RecurringSchedule[]
}

const PAGE_SIZE = 500
const BATCH_SIZE = 200
const CHART_COLORS = ['#635BFF', '#0B9B78', '#F0A44B', '#6F8FB8', '#B09AFB', '#D95B70', '#93A3B8']

function localDateString(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(key: string) {
  const [year, month] = key.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('en-BD', { month: 'short' })
}

function addMonths(key: string, amount: number) {
  const [year, month] = key.split('-').map(Number)
  return monthKey(new Date(year, month - 1 + amount, 1))
}

function monthRange(key: string) {
  const [year, month] = key.split('-').map(Number)
  const lastDay = new Date(year, month, 0).getDate()
  return { from: `${key}-01`, to: `${key}-${String(lastDay).padStart(2, '0')}` }
}

function accountSubtypeLabel(subtype: string | null) {
  const labels: Record<string, string> = {
    bank: 'Bank account', cash: 'Cash', mobile_wallet: 'Mobile wallet',
    savings: 'Savings account', current: 'Current account', credit_card: 'Credit card',
    personal_loan: 'Personal loan', other: 'Other',
  }
  return subtype ? labels[subtype] || subtype.replace(/_/g, ' ') : 'Financial account'
}

function accountIcon(subtype: string | null): LucideIcon {
  if (subtype === 'mobile_wallet') return Smartphone
  if (subtype === 'cash') return Wallet
  if (subtype === 'credit_card' || subtype === 'personal_loan') return Target
  return Landmark
}

function pctChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? '0.0%' : 'New'
  const change = ((current - previous) / Math.abs(previous)) * 100
  return `${change > 0 ? '+' : ''}${change.toFixed(1)}%`
}

function errorText(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return error instanceof Error ? error.message : 'Unable to load your financial overview.'
}

async function fetchPages<T>(queryFactory: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await queryFactory(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    const page = data || []
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  return rows
}

async function loadDashboardData(userId: string): Promise<DashboardData> {
  const today = localDateString()
  const todayDate = new Date(`${today}T00:00:00`)
  const firstMonth = new Date(todayDate.getFullYear(), todayDate.getMonth() - 11, 1)
  const fromDate = localDateString(firstMonth)
  const futureDate = new Date(todayDate)
  futureDate.setDate(futureDate.getDate() + 30)
  const futureDateString = localDateString(futureDate)

  const [accountResult, instrumentResult, recurringResult] = await Promise.all([
    supabase.from('ledger_accounts')
      .select('id, name, account_kind, account_type, subtype, include_in_net_worth, is_active')
      .eq('user_id', userId)
      .order('name', { ascending: true }),
    supabase.from('investment_instruments')
      .select('id, name, instrument_type, ledger_account_id, is_active')
      .eq('user_id', userId)
      .order('name', { ascending: true }),
    supabase.from('recurring_transactions')
      .select('id, name, transaction_type, amount_minor, next_due_date, payee, status')
      .eq('user_id', userId)
      .eq('status', 'active')
      .lte('next_due_date', futureDateString)
      .order('next_due_date', { ascending: true })
      .limit(12),
  ])

  if (accountResult.error) throw accountResult.error
  if (instrumentResult.error) throw instrumentResult.error
  if (recurringResult.error) throw recurringResult.error

  const accounts = (accountResult.data || []) as Account[]
  const instruments = (instrumentResult.data || []) as InvestmentInstrument[]
  const recurring = (recurringResult.data || []) as RecurringSchedule[]
  const accountMap = new Map(accounts.map(account => [account.id, account]))
  const financialIds = accounts
    .filter(account => account.account_kind === 'financial' && ['asset', 'liability'].includes(account.account_type))
    .map(account => account.id)

  let financialLines: JournalLine[] = []
  if (financialIds.length) {
    financialLines = await fetchPages<JournalLine>((from, to) =>
      supabase.from('journal_lines')
        .select('id, journal_entry_id, ledger_account_id, debit_minor, credit_minor')
        .eq('user_id', userId)
        .in('ledger_account_id', financialIds)
        .order('id', { ascending: true })
        .range(from, to)
    )
  }

  const financialEntryIds = [...new Set(financialLines.map(line => line.journal_entry_id))]
  const postedEntries: JournalEntry[] = []
  for (let offset = 0; offset < financialEntryIds.length; offset += BATCH_SIZE) {
    const batch = financialEntryIds.slice(offset, offset + BATCH_SIZE)
    const { data, error } = await supabase.from('journal_entries')
      .select('id, entry_date, transaction_type, description, payee, status, created_at')
      .eq('user_id', userId)
      .eq('status', 'posted')
      .in('id', batch)
    if (error) throw error
    postedEntries.push(...((data || []) as JournalEntry[]))
  }

  const postedIds = new Set(postedEntries.map(entry => entry.id))
  const balances: Record<string, number> = {}
  for (const account of accounts) {
    if (account.account_kind === 'financial') balances[account.id] = 0
  }
  for (const line of financialLines) {
    if (!postedIds.has(line.journal_entry_id)) continue
    const account = accountMap.get(line.ledger_account_id)
    if (!account) continue
    const debit = Number(line.debit_minor || 0)
    const credit = Number(line.credit_minor || 0)
    const movement = account.account_type === 'asset' ? debit - credit : credit - debit
    balances[account.id] = (balances[account.id] || 0) + movement
  }

  const recentEntries = postedEntries
    .filter(entry => entry.entry_date >= fromDate && entry.entry_date <= today)
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.created_at.localeCompare(b.created_at))
  const recentEntryIds = recentEntries.map(entry => entry.id)
  const recentLines: JournalLine[] = []
  for (let offset = 0; offset < recentEntryIds.length; offset += BATCH_SIZE) {
    const batch = recentEntryIds.slice(offset, offset + BATCH_SIZE)
    const rows = await fetchPages<JournalLine>((from, to) =>
      supabase.from('journal_lines')
        .select('id, journal_entry_id, ledger_account_id, debit_minor, credit_minor')
        .eq('user_id', userId)
        .in('journal_entry_id', batch)
        .order('id', { ascending: true })
        .range(from, to)
    )
    recentLines.push(...rows)
  }

  const linesByEntry = new Map<string, JournalLine[]>()
  for (const line of recentLines) {
    const current = linesByEntry.get(line.journal_entry_id) || []
    current.push(line)
    linesByEntry.set(line.journal_entry_id, current)
  }

  const monthlyMap = new Map<string, MonthlyTotal>()
  for (let i = 11; i >= 0; i -= 1) {
    const key = addMonths(monthKey(todayDate), -i)
    monthlyMap.set(key, { key, label: monthLabel(key), income: 0, expenses: 0 })
  }

  const currentMonth = monthKey(todayDate)
  const previousMonth = addMonths(currentMonth, -1)
  const expenseMapsByMonth = new Map<string, Map<string, CategoryTotal>>()
  const recentTransactions: RecentTransaction[] = []

  for (const entry of recentEntries) {
    const entryLines = linesByEntry.get(entry.id) || []
    const month = monthlyMap.get(entry.entry_date.slice(0, 7))
    const categoryLines = entryLines.filter(line => accountMap.get(line.ledger_account_id)?.account_kind === 'category')
    let entryAmount = 0
    const categoryNames: string[] = []

    for (const line of categoryLines) {
      const category = accountMap.get(line.ledger_account_id)
      if (!category) continue
      const debit = Number(line.debit_minor || 0)
      const credit = Number(line.credit_minor || 0)
      if (category.account_type === 'income') {
        const amount = credit - debit
        if (amount > 0 && month) month.income += amount
        if (amount > 0) entryAmount += amount
      } else if (category.account_type === 'expense') {
        const amount = debit - credit
        if (amount > 0 && month) month.expenses += amount
        if (amount > 0) {
          entryAmount += amount
          if (month) {
            const entryMonth = entry.entry_date.slice(0, 7)
            let monthExpenseMap = expenseMapsByMonth.get(entryMonth)
            if (!monthExpenseMap) {
              monthExpenseMap = new Map<string, CategoryTotal>()
              expenseMapsByMonth.set(entryMonth, monthExpenseMap)
            }
            const existing = monthExpenseMap.get(category.id) || { id: category.id, name: category.name, amount: 0 }
            existing.amount += amount
            monthExpenseMap.set(category.id, existing)
          }
        }
      }
      if (Math.abs(debit - credit) > 0 && !categoryNames.includes(category.name)) categoryNames.push(category.name)
    }

    if (entry.transaction_type === 'income' || entry.transaction_type === 'expense') {
      const financialLine = entryLines.find(line => accountMap.get(line.ledger_account_id)?.account_kind === 'financial')
      const financialAccount = financialLine ? accountMap.get(financialLine.ledger_account_id) : undefined
      recentTransactions.push({
        id: entry.id,
        date: entry.entry_date,
        description: entry.description || (entry.transaction_type === 'income' ? 'Income' : 'Expense'),
        payee: entry.payee || '',
        category: categoryNames.join(', ') || 'Uncategorised',
        account: financialAccount?.name || 'Account unavailable',
        type: entry.transaction_type,
        amount: entryAmount,
      })
    }
  }

  const currentTotals = monthlyMap.get(currentMonth) || { income: 0, expenses: 0 }
  const previousTotals = monthlyMap.get(previousMonth) || { income: 0, expenses: 0 }

  const included = accounts.filter(account =>
    account.account_kind === 'financial' && account.include_in_net_worth &&
    (account.account_type === 'asset' || account.account_type === 'liability')
  )
  const assets = included.filter(account => account.account_type === 'asset')
    .reduce((sum, account) => sum + (balances[account.id] || 0), 0)
  const liabilities = included.filter(account => account.account_type === 'liability')
    .reduce((sum, account) => sum + (balances[account.id] || 0), 0)
  const netWorth = assets - liabilities

  const investmentAccountIds = new Set(instruments.map(item => item.ledger_account_id))
  const availableBalance = accounts
    .filter(account => account.account_kind === 'financial' && account.account_type === 'asset' && account.is_active && !investmentAccountIds.has(account.id))
    .reduce((sum, account) => sum + (balances[account.id] || 0), 0)

  const valuationRows = instruments.length
    ? await fetchPages<InvestmentValuation>((from, to) =>
        supabase.from('investment_valuations')
          .select('instrument_id, valuation_date, market_value_minor')
          .eq('user_id', userId)
          .lte('valuation_date', today)
          .order('valuation_date', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to)
      )
    : []
  const latestValuations = new Map<string, InvestmentValuation>()
  for (const valuation of valuationRows) {
    if (!latestValuations.has(valuation.instrument_id)) latestValuations.set(valuation.instrument_id, valuation)
  }

  const investmentRows = instruments.filter(item => item.is_active).map(item => {
    const bookValue = balances[item.ledger_account_id] || 0
    const valuation = latestValuations.get(item.id)
    return {
      id: item.id,
      name: item.name,
      type: item.instrument_type,
      value: item.instrument_type === 'gpf' ? bookValue : valuation ? Number(valuation.market_value_minor) : bookValue,
    }
  }).sort((a, b) => b.value - a.value)

  return {
    accounts: accounts.filter(account => account.account_kind === 'financial' && account.is_active && (account.account_type === 'asset' || account.account_type === 'liability'))
      .map(account => ({ id: account.id, name: account.name, subtype: account.subtype, accountType: account.account_type, balance: balances[account.id] || 0 }))
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)),
    netWorth,
    assets,
    liabilities,
    availableBalance,
    monthly: [...monthlyMap.values()],
    expenseCategoriesByMonth: Object.fromEntries([...expenseMapsByMonth.entries()].map(([key, values]) => [key, [...values.values()].sort((a, b) => b.amount - a.amount)])),
    income: currentTotals.income,
    expenses: currentTotals.expenses,
    previousIncome: previousTotals.income,
    previousExpenses: previousTotals.expenses,
    recentTransactions: recentTransactions.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8),
    investments: investmentRows.slice(0, 6),
    recurring: recurring.slice(0, 6),
  }
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { preferences, resolvedTheme } = usePreferences()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [selectedMonth, setSelectedMonth] = useState(monthKey(new Date()))

  const load = useCallback(async (refresh = false) => {
    if (!user?.id) {
      setData(null)
      setLoading(false)
      return
    }
    if (refresh) setRefreshing(true)
    else setLoading(true)
    setError('')
    try {
      const result = await loadDashboardData(user.id)
      setData(result)
    } catch (err) {
      console.error('Dashboard loading error:', err)
      setError(errorText(err))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [user?.id])

  useEffect(() => { void load() }, [load])

  const selected = data?.monthly.find(item => item.key === selectedMonth)
  const previous = data?.monthly.find(item => item.key === addMonths(selectedMonth, -1))
  const income = selected?.income || 0
  const expenses = selected?.expenses || 0
  const selectedMonthIndex = data?.monthly.findIndex(item => item.key === selectedMonth) ?? -1
  const cashflow = selectedMonthIndex >= 0 ? data!.monthly.slice(Math.max(0, selectedMonthIndex - 5), selectedMonthIndex + 1) : []
  const expenseCategories = data?.expenseCategoriesByMonth[selectedMonth] || []
  const chartExpenseCategories = expenseCategories.length > 6
    ? [...expenseCategories.slice(0, 5), { id: 'other', name: 'Other', amount: expenseCategories.slice(5).reduce((sum, item) => sum + item.amount, 0) }]
    : expenseCategories
  const spendingTotal = expenseCategories.reduce((sum, item) => sum + item.amount, 0)

  const lineData = useMemo(() => ({
    labels: cashflow.map(item => item.label),
    datasets: [
      { label: 'Income', data: cashflow.map(item => item.income / 100), borderColor: '#0B9B78', backgroundColor: 'rgba(11,155,120,0.08)', fill: true, tension: 0.35, pointRadius: 3, borderWidth: 2.5 },
      { label: 'Expenses', data: cashflow.map(item => item.expenses / 100), borderColor: '#D95B70', backgroundColor: 'rgba(217,91,112,0.04)', fill: false, tension: 0.35, pointRadius: 3, borderWidth: 2.5 },
    ],
  }), [cashflow])

  const doughnutData = useMemo(() => ({
    labels: chartExpenseCategories.map(item => item.name),
    datasets: [{ data: chartExpenseCategories.map(item => item.amount / 100), backgroundColor: CHART_COLORS, borderColor: resolvedTheme === 'dark' ? '#152235' : '#FFFFFF', borderWidth: 3, hoverOffset: 5 }],
  }), [chartExpenseCategories, resolvedTheme])

  const lineOptions: ChartOptions<'line'> = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `${context.dataset.label}: ${formatBDTMinor(Number(context.raw) * 100)}` } } },
    scales: { x: { grid: { display: false }, ticks: { color: '#8290A3', font: { size: 11 } } }, y: { beginAtZero: true, grid: { color: resolvedTheme === 'dark' ? 'rgba(154,169,188,0.16)' : 'rgba(130,144,163,0.14)' }, ticks: { color: '#8290A3', callback: value => preferences.hideBalances ? '•••' : `৳${Number(value).toLocaleString('en-BD')}` } } },
  }
  const doughnutOptions: ChartOptions<'doughnut'> = {
    responsive: true, maintainAspectRatio: false, cutout: '72%',
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `${context.label}: ${formatBDTMinor(Number(context.raw) * 100)}` } } },
  }

  const monthLabel = new Date(Number(selectedMonth.slice(0, 4)), Number(selectedMonth.slice(5, 7)) - 1, 1)
    .toLocaleDateString('en-BD', { month: 'long', year: 'numeric' })
  const earliestMonth = data?.monthly[0]?.key || selectedMonth
  const latestMonth = data && data.monthly.length ? data.monthly[data.monthly.length - 1].key : selectedMonth

  const widgetRenderers: Record<string, () => ReactNode> = {
    cashflow: () => (
      <section className="ledger-panel p-5 md:p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div><h3 className="text-[15px] font-semibold text-[var(--ledger-heading)]">Cash flow</h3><p className="mt-1 text-xs ledger-muted">Income and expenses over the last six months</p></div>
          <div className="flex items-center gap-3 text-xs"><span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#0B9B78]"/>Income</span><span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#D95B70]"/>Expenses</span></div>
        </div>
        <div className="h-[260px]">{cashflow.some(item => item.income || item.expenses) ? <Line data={lineData} options={lineOptions}/> : <EmptyState message="No posted income or expense activity in this period."/>}</div>
      </section>
    ),
    spending: () => (
      <section className="ledger-panel p-5 md:p-6">
        <div><h3 className="text-[15px] font-semibold text-[var(--ledger-heading)]">Spending breakdown</h3><p className="mt-1 text-xs ledger-muted">Expense categories · {monthLabel}</p></div>
        {expenseCategories.length ? <>
          <div className="relative mx-auto mt-5 h-[210px] max-w-[260px]"><Doughnut data={doughnutData} options={doughnutOptions}/><div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-[10px] ledger-muted">Total spent</span><strong className="mt-1 text-xl font-semibold tabular-nums text-[var(--ledger-heading)]">{formatBDTMinor(spendingTotal)}</strong></div></div>
          <div className="mt-4 space-y-2">{chartExpenseCategories.map((item, index) => <button key={item.id} type="button" disabled={item.id === 'other'} onClick={() => { const range = monthRange(selectedMonth); navigate(`/transactions?type=expense&category=${encodeURIComponent(item.id)}&from=${range.from}&to=${range.to}`) }} className="flex w-full items-center justify-between gap-3 rounded-md py-1 text-left text-xs hover:bg-[var(--ledger-surface-muted)] disabled:cursor-default disabled:hover:bg-transparent"><span className="flex min-w-0 items-center gap-2"><i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}/><span className="truncate text-[var(--ledger-text)]">{item.name}</span></span><strong className="tabular-nums text-[var(--ledger-heading)]">{formatBDTMinor(item.amount)}</strong></button>)}</div>
        </> : <div className="mt-6"><EmptyState message="No expense categories recorded for this month."/></div>}
      </section>
    ),
    activity: () => (
      <section className="ledger-panel overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--ledger-border)] p-5 md:px-6"><div><h3 className="text-[15px] font-semibold text-[var(--ledger-heading)]">Recent activity</h3><p className="mt-1 text-xs ledger-muted">Your latest posted income and expenses</p></div><button onClick={() => navigate('/transactions')} className="text-xs font-semibold" style={{ color: 'var(--ledger-accent)' }}>View all →</button></div>
        {data?.recentTransactions.length ? <div className="divide-y divide-[var(--ledger-border)]">{data.recentTransactions.map(item => <div key={item.id} className="flex items-center justify-between gap-3 px-5 py-3.5 md:px-6"><div className="min-w-0"><p className="truncate text-sm font-medium text-[var(--ledger-heading)]">{item.description}</p><p className="mt-1 truncate text-xs ledger-muted">{item.category} · {item.account}{item.payee ? ` · ${item.payee}` : ''} · {formatLedgerDate(item.date)}</p></div><strong className={`shrink-0 text-sm tabular-nums ${item.type === 'income' ? 'text-emerald-600' : 'text-rose-600'}`}>{item.type === 'income' ? '+' : '−'}{formatBDTMinor(item.amount)}</strong></div>)}</div> : <div className="p-6"><EmptyState message="Your posted transactions will appear here."/></div>}
      </section>
    ),
    accounts: () => (
      <section className="ledger-panel p-5 md:p-6"><div className="flex items-center justify-between gap-3"><div><h3 className="text-[15px] font-semibold text-[var(--ledger-heading)]">Accounts</h3><p className="mt-1 text-xs ledger-muted">Your current financial account balances</p></div><button onClick={() => navigate('/accounts')} className="text-xs font-semibold" style={{ color: 'var(--ledger-accent)' }}>View all →</button></div>
        {data?.accounts.length ? <div className="mt-5 space-y-4">{data.accounts.slice(0, 5).map(account => { const Icon = accountIcon(account.subtype); return <button key={account.id} type="button" onClick={() => navigate(`/transactions?account=${encodeURIComponent(account.id)}`)} className="flex w-full items-center justify-between gap-3 rounded-lg py-1 text-left hover:bg-[var(--ledger-surface-muted)]"><div className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'var(--ledger-accent-soft)', color: 'var(--ledger-accent)' }}><Icon size={17}/></span><span className="min-w-0"><span className="block truncate text-sm font-medium text-[var(--ledger-heading)]">{account.name}</span><span className="block text-xs ledger-muted">{accountSubtypeLabel(account.subtype)}</span></span></div><strong className="shrink-0 text-sm tabular-nums text-[var(--ledger-heading)]">{formatBDTMinor(account.balance)}</strong></button>})}</div> : <div className="mt-6"><EmptyState message="Add a financial account to see its balance here."/></div>}
      </section>
    ),
    investments: () => (
      <section className="ledger-panel p-5 md:p-6"><div className="flex items-center justify-between gap-3"><div><h3 className="text-[15px] font-semibold text-[var(--ledger-heading)]">Investments & GPF</h3><p className="mt-1 text-xs ledger-muted">Latest recorded portfolio values</p></div><button onClick={() => navigate('/investments')} className="text-xs font-semibold" style={{ color: 'var(--ledger-accent)' }}>View portfolio →</button></div>
        {data?.investments.length ? <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{data.investments.map((item, index) => <div key={item.id} className="rounded-xl border border-[var(--ledger-border)] bg-[var(--ledger-surface-muted)] p-4"><span className="mb-3 block h-1 w-8 rounded-full" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}/><p className="truncate text-xs ledger-muted">{item.name}</p><p className="mt-1 text-lg font-semibold tabular-nums text-[var(--ledger-heading)]">{formatBDTMinor(item.value)}</p><p className="mt-1 text-[10px] ledger-muted">{item.type.toUpperCase()}</p></div>)}</div> : <div className="mt-6"><EmptyState message="Your investment instruments and GPF records will appear here."/></div>}
      </section>
    ),
    upcoming: () => (
      <section className="ledger-panel p-5 md:p-6"><div className="flex items-center justify-between gap-3"><div><h3 className="text-[15px] font-semibold text-[var(--ledger-heading)]">Upcoming payments</h3><p className="mt-1 text-xs ledger-muted">Due or expected in the next 30 days</p></div><button onClick={() => navigate('/recurring?view=calendar')} className="text-xs font-semibold" style={{ color: 'var(--ledger-accent)' }}>View payment calendar →</button></div>
        {data?.recurring.length ? <div className="mt-4 divide-y divide-[var(--ledger-border)]">{data.recurring.map(item => <div key={item.id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-[var(--ledger-heading)]">{item.name}</p><p className="mt-1 text-xs ledger-muted">{item.payee || (item.transaction_type === 'income' ? 'Expected income' : 'Scheduled expense')} · {formatLedgerDate(item.next_due_date)}</p></div><div className="shrink-0 text-right"><strong className={`block text-sm tabular-nums ${item.transaction_type === 'income' ? 'text-emerald-600' : 'text-rose-600'}`}>{item.transaction_type === 'income' ? '+' : '−'}{formatBDTMinor(Number(item.amount_minor))}</strong><span className="text-[10px] ledger-muted">{item.next_due_date < localDateString() ? 'Overdue' : 'Scheduled'}</span></div></div>)}</div> : <div className="mt-6"><EmptyState message="No active recurring payments are due in the next 30 days."/></div>}
      </section>
    ),
  }

  const widgetOrder = preferences.dashboardWidgetOrder || ['summary', 'cashflow', 'spending', 'activity', 'accounts', 'investments', 'upcoming']
  const widgetElements = widgetOrder.filter(key => preferences.dashboardWidgets[key as keyof typeof preferences.dashboardWidgets]).map(key => {
    if (key === 'summary') return <SummaryCards key={key} data={data} income={income} expenses={expenses} previous={previous}/>
    const render = widgetRenderers[key]
    if (!render) return null
    const span = key === 'cashflow' || key === 'activity' ? 'xl:col-span-2' : ''
    return <div key={key} className={span}>{render()}</div>
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><p className="mb-1 text-[11px] font-medium ledger-muted">{formatLedgerDate(localDateString())}</p><div className="flex flex-wrap items-center gap-3"><h1 className="text-[28px] font-semibold tracking-[-0.045em] text-[var(--ledger-heading)]">Overview</h1><span className="rounded-full border border-[var(--ledger-border)] bg-[var(--ledger-surface)] px-2.5 py-1 text-[10px] font-medium ledger-muted">Live account data</span></div><p className="mt-1.5 text-[13px] ledger-muted">A current snapshot of your personal finances.</p></div>
        <div className="flex flex-wrap items-center gap-2"><div className="inline-flex items-center gap-1 rounded-xl border border-[var(--ledger-border)] bg-[var(--ledger-surface)] p-1"><button onClick={() => setSelectedMonth(value => addMonths(value, -1))} disabled={selectedMonth <= earliestMonth} className="rounded-lg p-2 text-[var(--ledger-muted)] hover:bg-[var(--ledger-surface-muted)] disabled:opacity-30" aria-label="Previous month"><ChevronLeft size={16}/></button><span className="flex min-w-[145px] items-center justify-center gap-2 px-2 text-xs font-medium text-[var(--ledger-heading)]"><CalendarDays size={14}/>{monthLabel}</span><button onClick={() => setSelectedMonth(value => addMonths(value, 1))} disabled={selectedMonth >= latestMonth} className="rounded-lg p-2 text-[var(--ledger-muted)] hover:bg-[var(--ledger-surface-muted)] disabled:opacity-30" aria-label="Next month"><ChevronRight size={16}/></button></div><button onClick={() => void load(true)} disabled={loading || refreshing} className="rounded-xl border border-[var(--ledger-border)] bg-[var(--ledger-surface)] p-2.5 text-[var(--ledger-muted)] hover:text-[var(--ledger-heading)] disabled:opacity-50" aria-label="Refresh dashboard"><RefreshCw size={16} className={refreshing ? 'animate-spin' : ''}/></button><button onClick={() => navigate('/settings?tab=dashboard')} className="inline-flex items-center gap-2 rounded-xl border border-[var(--ledger-border)] bg-[var(--ledger-surface)] px-3.5 py-2.5 text-xs font-semibold text-[var(--ledger-heading)] hover:bg-[var(--ledger-surface-muted)]"><Settings2 size={15}/> Customize</button></div>
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      {loading && !data ? <div className="ledger-panel flex items-center justify-center gap-3 p-16 text-sm ledger-muted"><RefreshCw size={17} className="animate-spin"/>Loading your financial overview…</div> : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">{widgetElements}</div>
      )}
      {!loading && data && !data.accounts.length && <div className="ledger-panel p-5 text-center"><p className="text-sm font-semibold text-[var(--ledger-heading)]">Start by adding your financial accounts</p><p className="mt-1 text-xs ledger-muted">Once you add accounts and post transactions, your dashboard will show your real financial position.</p><button onClick={() => navigate('/accounts')} className="mt-3 rounded-lg px-4 py-2 text-xs font-semibold text-white" style={{ background: 'var(--ledger-accent)' }}>Add an account</button></div>}
    </div>
  )
}

function SummaryCards({ data, income, expenses, previous }: { data: DashboardData | null; income: number; expenses: number; previous?: MonthlyTotal }) {
  const incomeChange = pctChange(income, previous?.income || 0)
  const expenseChange = pctChange(expenses, previous?.expenses || 0)
  const cards = [
    { label: 'Net worth', value: data ? formatBDTMinor(data.netWorth) : '—', detail: data ? `Assets ${formatBDTMinor(data.assets)} · Liabilities ${formatBDTMinor(data.liabilities)}` : 'Loading', icon: Wallet, dark: true },
    { label: 'Available balance', value: data ? formatBDTMinor(data.availableBalance) : '—', detail: 'Active non-investment asset accounts', icon: Landmark },
    { label: 'Monthly income', value: formatBDTMinor(income), detail: `${incomeChange} vs previous month`, icon: TrendingUp, positive: true },
    { label: 'Monthly expenses', value: formatBDTMinor(expenses), detail: `${expenseChange} vs previous month`, icon: TrendingDown, negative: true },
  ]
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:col-span-3 xl:grid-cols-4">{cards.map(card => <div key={card.label} className={`rounded-[18px] border p-5 shadow-[0_1px_2px_rgba(16,42,67,0.035)] ${card.dark ? 'border-[#173B59] bg-[#102F49] text-white' : 'border-[var(--ledger-border)] bg-[var(--ledger-surface)]'}`}><div className="flex items-center justify-between gap-3"><span className={`text-xs font-semibold ${card.dark ? 'text-white/70' : 'ledger-muted'}`}>{card.label}</span><span className={`flex h-9 w-9 items-center justify-center rounded-xl ${card.dark ? 'bg-white/10 text-white' : 'bg-[var(--ledger-accent-soft)]'}`} style={card.dark ? undefined : { color: 'var(--ledger-accent)' }}><card.icon size={17}/></span></div><p className={`mt-5 break-words text-[25px] font-semibold tracking-[-0.04em] tabular-nums ${card.dark ? 'text-white' : 'text-[var(--ledger-heading)]'}`}>{card.value}</p><p className={`mt-2 text-[10px] ${card.dark ? 'text-white/60' : 'ledger-muted'}`}>{card.detail}</p></div>)}</div>
}

function EmptyState({ message }: { message: string }) {
  return <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--ledger-border)] px-4 text-center"><Activity size={20} className="ledger-muted"/><p className="max-w-[260px] text-xs ledger-muted">{message}</p></div>
}
