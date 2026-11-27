import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  FileSpreadsheet,
  FileText,
  PieChart,
  RefreshCw,
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
} from 'chart.js'
import { Line, Doughnut } from 'react-chartjs-2'
import * as XLSX from 'xlsx'

import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { usePreferences } from '../context/PreferencesContext'
import { formatBDTMinor, formatLedgerDate } from '../lib/preferences'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler
)

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
  status: string
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

type InvestmentActivity = {
  id: string
  instrument_id: string
  activity_type: string
  activity_date: string
  amount_minor: number | string
  fees_minor: number | string
  cost_basis_minor: number | string | null
}

type InvestmentValuation = {
  id: string
  instrument_id: string
  valuation_date: string
  market_value_minor: number | string
}

type CategoryTotal = {
  id: string
  name: string
  amount: number
}

type MonthlyTotal = {
  key: string
  label: string
  income: number
  expenses: number
  net: number
}

type NetWorthPoint = {
  label: string
  assets: number
  liabilities: number
  netWorth: number
}

type InvestmentRow = {
  id: string
  name: string
  type: string
  value: number
  costBasis: number
  unrealized: number
  realized: number
  income: number
}

type DatePreset =
  | 'this_month'
  | 'last_month'
  | 'last_3_months'
  | 'last_6_months'
  | 'this_year'
  | 'last_year'
  | 'custom'

const PAGE_SIZE = 500
const BATCH_SIZE = 200

function localDateString(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getPresetRange(preset: DatePreset) {
  const today = new Date()
  const year = today.getFullYear()
  const month = today.getMonth()

  if (preset === 'this_month') {
    return {
      from: localDateString(new Date(year, month, 1)),
      to: localDateString(today),
    }
  }

  if (preset === 'last_month') {
    return {
      from: localDateString(new Date(year, month - 1, 1)),
      to: localDateString(new Date(year, month, 0)),
    }
  }

  if (preset === 'last_3_months') {
    return {
      from: localDateString(new Date(year, month - 2, 1)),
      to: localDateString(today),
    }
  }

  if (preset === 'last_6_months') {
    return {
      from: localDateString(new Date(year, month - 5, 1)),
      to: localDateString(today),
    }
  }

  if (preset === 'last_year') {
    return {
      from: `${year - 1}-01-01`,
      to: `${year - 1}-12-31`,
    }
  }

  if (preset === 'this_year') {
    return {
      from: `${year}-01-01`,
      to: localDateString(today),
    }
  }

  return {
    from: localDateString(new Date(year, month, 1)),
    to: localDateString(today),
  }
}

function monthKey(date: string) {
  return date.slice(0, 7)
}

function monthLabel(key: string) {
  const [year, month] = key.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('en-BD', {
    month: 'short',
    year: '2-digit',
  })
}

function formatBDT(minor: number) {
  return formatBDTMinor(minor)
}

function formatDate(date: string) {
  return formatLedgerDate(date)
}

function formatType(value: string) {
  const labels: Record<string, string> = {
    fdr: 'FDR',
    dps: 'DPS',
    savings_certificate: 'Savings Certificate',
    stock: 'Stocks',
    mutual_fund: 'Mutual Fund',
    gold: 'Gold',
    gpf: 'GPF',
    other: 'Other',
  }
  return labels[value] || value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

function downloadWorkbook(
  from: string,
  to: string,
  summary: { income: number; expenses: number; net: number; savingsRate: number; assets: number; liabilities: number; netWorth: number },
  monthly: MonthlyTotal[],
  incomeCategories: CategoryTotal[],
  expenseCategories: CategoryTotal[],
  netWorthTrend: NetWorthPoint[],
  investments: InvestmentRow[],
  investmentTotals: { value: number; costBasis: number; unrealized: number; realized: number; income: number }
) {
  const workbook = XLSX.utils.book_new()

  const overviewRows = [
    ['LEDGER — FINANCIAL REPORT'],
    ['Reporting period', `${from} to ${to}`],
    ['Currency', 'BDT'],
    [],
    ['Metric', 'Amount (BDT)'],
    ['Total income', summary.income / 100],
    ['Total expenses', summary.expenses / 100],
    ['Net cash flow', summary.net / 100],
    ['Savings rate (%)', summary.savingsRate],
    ['Total assets', summary.assets / 100],
    ['Total liabilities', summary.liabilities / 100],
    ['Net worth', summary.netWorth / 100],
    [],
    ['Investment metric', 'Amount (BDT)'],
    ['Recorded portfolio value', investmentTotals.value / 100],
    ['Remaining cost basis', investmentTotals.costBasis / 100],
    ['Unrealized gain / loss', investmentTotals.unrealized / 100],
    ['Cumulative realized gain / loss', investmentTotals.realized / 100],
    ['Cumulative investment income', investmentTotals.income / 100],
  ]

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(overviewRows),
    'Overview'
  )

  const monthlyRows = [
    ['Month', 'Income (BDT)', 'Expenses (BDT)', 'Net cash flow (BDT)'],
    ...monthly.map(row => [
      row.label,
      row.income / 100,
      row.expenses / 100,
      row.net / 100,
    ]),
  ]
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(monthlyRows),
    'Monthly Cash Flow'
  )

  const expenseRows = [
    ['Expense category', 'Amount (BDT)'],
    ...expenseCategories.map(item => [item.name, item.amount / 100]),
  ]
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(expenseRows),
    'Expense Categories'
  )

  const incomeRows = [
    ['Income category', 'Amount (BDT)'],
    ...incomeCategories.map(item => [item.name, item.amount / 100]),
  ]
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(incomeRows),
    'Income Categories'
  )

  const netWorthRows = [
    ['Date / Month', 'Assets (BDT)', 'Liabilities (BDT)', 'Net worth (BDT)'],
    ...netWorthTrend.map(item => [
      item.label,
      item.assets / 100,
      item.liabilities / 100,
      item.netWorth / 100,
    ]),
  ]
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(netWorthRows),
    'Net Worth'
  )

  const investmentRows = [
    ['Investment', 'Type', 'Recorded value (BDT)', 'Remaining cost basis (BDT)', 'Unrealized gain / loss (BDT)', 'Realized gain / loss (BDT)', 'Income (BDT)'],
    ...investments.map(item => [
      item.name,
      formatType(item.type),
      item.value / 100,
      item.costBasis / 100,
      item.unrealized / 100,
      item.realized / 100,
      item.income / 100,
    ]),
  ]
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(investmentRows),
    'Investments'
  )

  XLSX.writeFile(workbook, `Ledger_Report_${from}_to_${to}.xlsx`)
}

export default function Reports() {
  const { user } = useAuth()
  const { resolvedTheme } = usePreferences()

  const defaultRange = getPresetRange('this_year')
  const [preset, setPreset] = useState<DatePreset>('this_year')
  const [dateFrom, setDateFrom] = useState(defaultRange.from)
  const [dateTo, setDateTo] = useState(defaultRange.to)

  const [accounts, setAccounts] = useState<Account[]>([])
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [lines, setLines] = useState<JournalLine[]>([])
  const [instruments, setInstruments] = useState<InvestmentInstrument[]>([])
  const [activities, setActivities] = useState<InvestmentActivity[]>([])
  const [valuations, setValuations] = useState<InvestmentValuation[]>([])

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const loadData = useCallback(async (isRefresh = false) => {
    if (!user?.id) {
      setAccounts([])
      setEntries([])
      setLines([])
      setInstruments([])
      setActivities([])
      setValuations([])
      setLoading(false)
      return
    }

    if (isRefresh) setRefreshing(true)
    else setLoading(true)

    setError('')

    try {
      const [accountResult, instrumentResult] = await Promise.all([
        supabase
          .from('ledger_accounts')
          .select('id, name, account_kind, account_type, subtype, include_in_net_worth, is_active')
          .eq('user_id', user.id)
          .order('name', { ascending: true }),

        supabase
          .from('investment_instruments')
          .select('id, name, instrument_type, ledger_account_id, is_active')
          .eq('user_id', user.id)
          .order('name', { ascending: true }),
      ])

      if (accountResult.error) throw accountResult.error
      if (instrumentResult.error) throw instrumentResult.error

      const accountRows = (accountResult.data || []) as Account[]
      const instrumentRows = (instrumentResult.data || []) as InvestmentInstrument[]

      const entryRows: JournalEntry[] = []
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error: queryError } = await supabase
          .from('journal_entries')
          .select('id, entry_date, transaction_type, description, status')
          .eq('user_id', user.id)
          .eq('status', 'posted')
          .lte('entry_date', dateTo)
          .order('entry_date', { ascending: true })
          .order('id', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1)

        if (queryError) throw queryError

        const page = (data || []) as JournalEntry[]
        entryRows.push(...page)
        if (page.length < PAGE_SIZE) break
      }

      const entryIds = entryRows.map(entry => entry.id)
      const lineRows: JournalLine[] = []

      for (let offset = 0; offset < entryIds.length; offset += BATCH_SIZE) {
        const batch = entryIds.slice(offset, offset + BATCH_SIZE)

        for (let lineOffset = 0; ; lineOffset += PAGE_SIZE) {
          const { data, error: lineError } = await supabase
            .from('journal_lines')
            .select('id, journal_entry_id, ledger_account_id, debit_minor, credit_minor')
            .eq('user_id', user.id)
            .in('journal_entry_id', batch)
            .order('id', { ascending: true })
            .range(lineOffset, lineOffset + PAGE_SIZE - 1)

          if (lineError) throw lineError

          const page = (data || []) as JournalLine[]
          lineRows.push(...page)
          if (page.length < PAGE_SIZE) break
        }
      }

      const activityRows: InvestmentActivity[] = []
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error: activityError } = await supabase
          .from('investment_activities')
          .select('id, instrument_id, activity_type, activity_date, amount_minor, fees_minor, cost_basis_minor')
          .eq('user_id', user.id)
          .lte('activity_date', dateTo)
          .order('activity_date', { ascending: true })
          .order('id', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1)

        if (activityError) throw activityError

        const page = (data || []) as InvestmentActivity[]
        activityRows.push(...page)
        if (page.length < PAGE_SIZE) break
      }

      const valuationRows: InvestmentValuation[] = []
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error: valuationError } = await supabase
          .from('investment_valuations')
          .select('id, instrument_id, valuation_date, market_value_minor')
          .eq('user_id', user.id)
          .lte('valuation_date', dateTo)
          .order('valuation_date', { ascending: false })
          .order('id', { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1)

        if (valuationError) throw valuationError

        const page = (data || []) as InvestmentValuation[]
        valuationRows.push(...page)
        if (page.length < PAGE_SIZE) break
      }

      setAccounts(accountRows)
      setEntries(entryRows)
      setLines(lineRows)
      setInstruments(instrumentRows)
      setActivities(activityRows)
      setValuations(valuationRows)
    } catch (err) {
      console.error('Reports loading error:', err)

      // Supabase/PostgREST errors are often plain objects, not Error instances.
      // Read their message, details, hint and code so the real cause is visible.
      const dbError = err as {
        message?: unknown
        details?: unknown
        hint?: unknown
        code?: unknown
      }

      const visibleError = [
        typeof dbError?.message === 'string' ? dbError.message : null,
        typeof dbError?.details === 'string' ? `Details: ${dbError.details}` : null,
        typeof dbError?.hint === 'string' ? `Hint: ${dbError.hint}` : null,
        typeof dbError?.code === 'string' ? `Code: ${dbError.code}` : null,
      ]
        .filter((part): part is string => Boolean(part))
        .join(' — ')

      setError(
        visibleError ||
          (err instanceof Error
            ? err.message
            : 'Unable to load financial reports. Check the browser console for details.')
      )
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [user?.id, dateTo])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const report = useMemo(() => {
    const accountMap = new Map<string, Account>(accounts.map(account => [account.id, account]))
    const linesByEntry = new Map<string, JournalLine[]>()

    for (const line of lines) {
      const current = linesByEntry.get(line.journal_entry_id) || []
      current.push(line)
      linesByEntry.set(line.journal_entry_id, current)
    }

    const monthlyMap = new Map<string, MonthlyTotal>()
    const cursor = new Date(
      Number(dateFrom.slice(0, 4)),
      Number(dateFrom.slice(5, 7)) - 1,
      1
    )
    const lastMonth = new Date(
      Number(dateTo.slice(0, 4)),
      Number(dateTo.slice(5, 7)) - 1,
      1
    )

    while (cursor <= lastMonth) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
      monthlyMap.set(key, {
        key,
        label: monthLabel(key),
        income: 0,
        expenses: 0,
        net: 0,
      })
      cursor.setMonth(cursor.getMonth() + 1)
    }

    const incomeMap = new Map<string, CategoryTotal>()
    const expenseMap = new Map<string, CategoryTotal>()

    const periodEntries = entries.filter(
      entry => entry.entry_date >= dateFrom && entry.entry_date <= dateTo
    )

    for (const entry of periodEntries) {
      const month = monthlyMap.get(monthKey(entry.entry_date))
      const entryLines = linesByEntry.get(entry.id) || []

      for (const line of entryLines) {
        const account = accountMap.get(line.ledger_account_id)
        if (!account || account.account_kind !== 'category') continue

        const debit = Number(line.debit_minor || 0)
        const credit = Number(line.credit_minor || 0)

        if (account.account_type === 'income') {
          const amount = credit - debit
          if (!amount) continue

          if (month) month.income += amount
          const current = incomeMap.get(account.id) || {
            id: account.id,
            name: account.name,
            amount: 0,
          }
          current.amount += amount
          incomeMap.set(account.id, current)
        }

        if (account.account_type === 'expense') {
          const amount = debit - credit
          if (!amount) continue

          if (month) month.expenses += amount
          const current = expenseMap.get(account.id) || {
            id: account.id,
            name: account.name,
            amount: 0,
          }
          current.amount += amount
          expenseMap.set(account.id, current)
        }
      }
    }

    const monthly = [...monthlyMap.values()].map(item => ({
      ...item,
      net: item.income - item.expenses,
    }))

    const incomeCategories = [...incomeMap.values()].sort((a, b) => b.amount - a.amount)
    const expenseCategories = [...expenseMap.values()].sort((a, b) => b.amount - a.amount)

    const accountBalances: Record<string, number> = {}
    const orderedEntries = [...entries].sort((a, b) =>
      a.entry_date.localeCompare(b.entry_date) || a.id.localeCompare(b.id)
    )

    for (const entry of orderedEntries) {
      const entryLines = linesByEntry.get(entry.id) || []
      for (const line of entryLines) {
        const account = accountMap.get(line.ledger_account_id)
        if (!account || account.account_kind !== 'financial') continue

        const debit = Number(line.debit_minor || 0)
        const credit = Number(line.credit_minor || 0)

        if (account.account_type === 'asset') {
          accountBalances[account.id] = (accountBalances[account.id] || 0) + debit - credit
        } else if (account.account_type === 'liability') {
          accountBalances[account.id] = (accountBalances[account.id] || 0) + credit - debit
        }
      }
    }

    const includedAccounts = accounts.filter(
      account =>
        account.account_kind === 'financial' &&
        account.include_in_net_worth &&
        (account.account_type === 'asset' || account.account_type === 'liability')
    )

    const assets = includedAccounts
      .filter(account => account.account_type === 'asset')
      .reduce((sum, account) => sum + (accountBalances[account.id] || 0), 0)

    const liabilities = includedAccounts
      .filter(account => account.account_type === 'liability')
      .reduce((sum, account) => sum + (accountBalances[account.id] || 0), 0)

    const netWorth = assets - liabilities

    const cutoffs: { date: string; label: string }[] = []
    const fromDate = new Date(`${dateFrom}T00:00:00`)
    const startPreviousDay = new Date(fromDate)
    startPreviousDay.setDate(startPreviousDay.getDate() - 1)
    cutoffs.push({
      date: localDateString(startPreviousDay),
      label: 'Start',
    })

    const trendCursor = new Date(
      Number(dateFrom.slice(0, 4)),
      Number(dateFrom.slice(5, 7)) - 1,
      1
    )

    while (trendCursor <= lastMonth) {
      const monthEnd = new Date(
        trendCursor.getFullYear(),
        trendCursor.getMonth() + 1,
        0
      )
      const cutoff = monthKey(localDateString(monthEnd)) === monthKey(dateTo)
        ? dateTo
        : localDateString(monthEnd)

      cutoffs.push({
        date: cutoff,
        label: monthLabel(monthKey(cutoff)),
      })
      trendCursor.setMonth(trendCursor.getMonth() + 1)
    }

    const trendBalances: Record<string, number> = {}
    const netWorthTrend: NetWorthPoint[] = []
    let entryIndex = 0

    for (const cutoff of cutoffs) {
      while (
        entryIndex < orderedEntries.length &&
        orderedEntries[entryIndex].entry_date <= cutoff.date
      ) {
        const entry = orderedEntries[entryIndex]
        const entryLines = linesByEntry.get(entry.id) || []

        for (const line of entryLines) {
          const account = accountMap.get(line.ledger_account_id)
          if (
            !account ||
            account.account_kind !== 'financial' ||
            (account.account_type !== 'asset' && account.account_type !== 'liability')
          ) continue

          const debit = Number(line.debit_minor || 0)
          const credit = Number(line.credit_minor || 0)
          const movement = account.account_type === 'asset'
            ? debit - credit
            : credit - debit

          trendBalances[account.id] = (trendBalances[account.id] || 0) + movement
        }

        entryIndex += 1
      }

      let trendAssets = 0
      let trendLiabilities = 0

      for (const account of includedAccounts) {
        const balance = trendBalances[account.id] || 0
        if (account.account_type === 'asset') trendAssets += balance
        if (account.account_type === 'liability') trendLiabilities += balance
      }

      netWorthTrend.push({
        label: cutoff.label,
        assets: trendAssets,
        liabilities: trendLiabilities,
        netWorth: trendAssets - trendLiabilities,
      })
    }

    const latestValuationByInstrument = new Map<string, InvestmentValuation>()
    for (const valuation of valuations) {
      if (!latestValuationByInstrument.has(valuation.instrument_id)) {
        latestValuationByInstrument.set(valuation.instrument_id, valuation)
      }
    }

    const costBasisByInstrument: Record<string, number> = {}
    const realizedByInstrument: Record<string, number> = {}
    const incomeByInstrument: Record<string, number> = {}

    for (const activity of activities) {
      const amount = Number(activity.amount_minor || 0)
      const costBasis = Number(activity.cost_basis_minor || 0)
      const fees = Number(activity.fees_minor || 0)

      if (activity.activity_type === 'purchase') {
        costBasisByInstrument[activity.instrument_id] =
          (costBasisByInstrument[activity.instrument_id] || 0) + (costBasis || amount)
      } else if (
        activity.activity_type === 'sale' ||
        activity.activity_type === 'maturity'
      ) {
        costBasisByInstrument[activity.instrument_id] =
          (costBasisByInstrument[activity.instrument_id] || 0) - costBasis

        realizedByInstrument[activity.instrument_id] =
          (realizedByInstrument[activity.instrument_id] || 0) +
          amount - costBasis - fees
      } else if (
        activity.activity_type === 'dividend' ||
        activity.activity_type === 'interest'
      ) {
        incomeByInstrument[activity.instrument_id] =
          (incomeByInstrument[activity.instrument_id] || 0) + amount
      }
    }

    const investmentRows: InvestmentRow[] = instruments
      .filter(instrument => instrument.is_active)
      .map(instrument => {
        const bookValue = accountBalances[instrument.ledger_account_id] || 0
        const valuation = latestValuationByInstrument.get(instrument.id)
        const value = instrument.instrument_type === 'gpf'
          ? bookValue
          : valuation
            ? Number(valuation.market_value_minor)
            : bookValue

        const costBasis = instrument.instrument_type === 'gpf'
          ? bookValue
          : Math.max(0, costBasisByInstrument[instrument.id] || 0)

        const realized = realizedByInstrument[instrument.id] || 0
        const income = incomeByInstrument[instrument.id] || 0

        return {
          id: instrument.id,
          name: instrument.name,
          type: instrument.instrument_type,
          value,
          costBasis,
          unrealized: value - costBasis,
          realized,
          income,
        }
      })
      .sort((a, b) => b.value - a.value)

    const investmentTotals = investmentRows.reduce(
      (total, item) => ({
        value: total.value + item.value,
        costBasis: total.costBasis + item.costBasis,
        unrealized: total.unrealized + item.unrealized,
        realized: total.realized + item.realized,
        income: total.income + item.income,
      }),
      { value: 0, costBasis: 0, unrealized: 0, realized: 0, income: 0 }
    )

    const periodActivities = activities.filter(
      activity => activity.activity_date >= dateFrom && activity.activity_date <= dateTo
    )

    const periodInvestmentIncome = periodActivities
      .filter(activity => activity.activity_type === 'dividend' || activity.activity_type === 'interest')
      .reduce((sum, activity) => sum + Number(activity.amount_minor), 0)

    const periodRealized = periodActivities
      .filter(activity => activity.activity_type === 'sale' || activity.activity_type === 'maturity')
      .reduce((sum, activity) =>
        sum +
        Number(activity.amount_minor) -
        Number(activity.cost_basis_minor || 0) -
        Number(activity.fees_minor || 0), 0)

    const totalIncome = monthly.reduce((sum, item) => sum + item.income, 0)
    const totalExpenses = monthly.reduce((sum, item) => sum + item.expenses, 0)
    const net = totalIncome - totalExpenses
    const savingsRate = totalIncome > 0 ? (net / totalIncome) * 100 : 0

    const expenseChartItems = expenseCategories.slice(0, 6)
    const otherExpenses = expenseCategories.slice(6).reduce((sum, item) => sum + item.amount, 0)
    if (otherExpenses > 0) {
      expenseChartItems.push({
        id: 'other',
        name: 'Other',
        amount: otherExpenses,
      })
    }

    const investmentTypeMap = new Map<string, number>()
    for (const item of investmentRows) {
      investmentTypeMap.set(
        item.type,
        (investmentTypeMap.get(item.type) || 0) + item.value
      )
    }

    const investmentTypeTotals = [...investmentTypeMap.entries()]
      .map(([type, amount]) => ({ type, amount }))
      .sort((a, b) => b.amount - a.amount)

    return {
      monthly,
      incomeCategories,
      expenseCategories,
      expenseChartItems,
      netWorthTrend,
      assets,
      liabilities,
      netWorth,
      totalIncome,
      totalExpenses,
      net,
      savingsRate,
      investmentRows,
      investmentTotals,
      investmentTypeTotals,
      periodInvestmentIncome,
      periodRealized,
      periodEntryCount: periodEntries.length,
      includedAccountCount: includedAccounts.length,
    }
  }, [
    accounts,
    entries,
    lines,
    instruments,
    activities,
    valuations,
    dateFrom,
    dateTo,
  ])

  const handlePresetChange = (value: DatePreset) => {
    setPreset(value)
    if (value !== 'custom') {
      const range = getPresetRange(value)
      setDateFrom(range.from)
      setDateTo(range.to)
    }
  }

  const handleExportExcel = () => {
    downloadWorkbook(
      dateFrom,
      dateTo,
      {
        income: report.totalIncome,
        expenses: report.totalExpenses,
        net: report.net,
        savingsRate: report.savingsRate,
        assets: report.assets,
        liabilities: report.liabilities,
        netWorth: report.netWorth,
      },
      report.monthly,
      report.incomeCategories,
      report.expenseCategories,
      report.netWorthTrend,
      report.investmentRows,
      report.investmentTotals
    )
  }

  const periodInvalid = !dateFrom || !dateTo || dateFrom > dateTo

  const cashFlowChartData = {
    labels: report.monthly.map(item => item.label),
    datasets: [
      {
        label: 'Income',
        data: report.monthly.map(item => item.income / 100),
        borderColor: '#16834A',
        backgroundColor: 'rgba(22, 131, 74, 0.10)',
        fill: true,
        tension: 0.35,
        pointRadius: 3,
      },
      {
        label: 'Expenses',
        data: report.monthly.map(item => item.expenses / 100),
        borderColor: '#D64545',
        backgroundColor: 'rgba(214, 69, 69, 0.06)',
        fill: true,
        tension: 0.35,
        pointRadius: 3,
      },
    ],
  }

  const netWorthChartData = {
    labels: report.netWorthTrend.map(item => item.label),
    datasets: [
      {
        label: 'Net worth',
        data: report.netWorthTrend.map(item => item.netWorth / 100),
        borderColor: '#173A5E',
        backgroundColor: 'rgba(23, 58, 94, 0.10)',
        fill: true,
        tension: 0.3,
        pointRadius: 3,
      },
      {
        label: 'Assets',
        data: report.netWorthTrend.map(item => item.assets / 100),
        borderColor: '#16834A',
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.3,
        pointRadius: 2,
      },
      {
        label: 'Liabilities',
        data: report.netWorthTrend.map(item => item.liabilities / 100),
        borderColor: '#D97706',
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.3,
        pointRadius: 2,
      },
    ],
  }

  const expenseChartData = {
    labels: report.expenseChartItems.map(item => item.name),
    datasets: [
      {
        data: report.expenseChartItems.map(item => item.amount / 100),
        backgroundColor: [
          '#173A5E',
          '#16834A',
          '#E9A23B',
          '#6D8EBA',
          '#A78BFA',
          '#D97706',
          '#CBD5E1',
        ],
        borderWidth: 0,
        hoverOffset: 5,
      },
    ],
  }

  const investmentChartData = {
    labels: report.investmentTypeTotals.map(item => formatType(item.type)),
    datasets: [
      {
        data: report.investmentTypeTotals.map(item => Math.max(0, item.amount / 100)),
        backgroundColor: [
          '#173A5E',
          '#16834A',
          '#E9A23B',
          '#6D8EBA',
          '#A78BFA',
          '#D97706',
          '#0F766E',
          '#CBD5E1',
        ],
        borderWidth: 0,
        hoverOffset: 5,
      },
    ],
  }

  const chartTextColor = resolvedTheme === 'dark' ? '#A1B0C3' : '#8290A3'
  const chartGridColor = resolvedTheme === 'dark' ? '#2A3B52' : '#EEF2F7'
  const chartTooltipColor = resolvedTheme === 'dark' ? '#17263A' : '#102A43'

  const lineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' as const },
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: { usePointStyle: true, boxWidth: 7, padding: 18, color: chartTextColor },
      },
      tooltip: {
        backgroundColor: chartTooltipColor,
        titleColor: '#FFFFFF',
        bodyColor: '#FFFFFF',
        callbacks: {
          label: (context: any) => `${context.dataset.label}: ${formatBDT(Number(context.raw) * 100)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: { color: chartTextColor },
      },
      y: {
        beginAtZero: false,
        grid: { color: chartGridColor },
        border: { display: false },
        ticks: {
          color: chartTextColor,
          callback: (value: string | number) => {
            const amount = Number(value)
            return amount >= 1000000
              ? `৳${(amount / 1000000).toFixed(1)}m`
              : amount >= 1000
                ? `৳${(amount / 1000).toFixed(0)}k`
                : `৳${amount}`
          },
        },
      },
    },
  }

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '68%',
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: { usePointStyle: true, boxWidth: 7, padding: 16, color: chartTextColor },
      },
      tooltip: {
        backgroundColor: chartTooltipColor,
        titleColor: '#FFFFFF',
        bodyColor: '#FFFFFF',
        callbacks: {
          label: (context: any) => `${context.label}: ${formatBDT(Number(context.raw) * 100)}`,
        },
      },
    },
  }

  return (
    <div className="space-y-6">
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 12mm; }
          body { background: #fff !important; }
          .reports-print-hide { display: none !important; }
          .reports-print-card { break-inside: avoid; box-shadow: none !important; }
          main { max-width: none !important; padding: 0 !important; }
        }
      `}</style>

      {/* PAGE HEADER AND FILTERS */}
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-ledger-navy">
            <Activity size={17} />
            <span>Financial insights and analysis</span>
          </div>
          <h2 className="text-3xl font-bold text-slate-900">Reports & Analytics</h2>
          <p className="mt-1 text-sm text-slate-500">
            Understand your cash flow, net worth and investment performance.
          </p>
        </div>

        <div className="reports-print-hide flex flex-wrap items-center gap-2">
          <button
            onClick={() => void loadData(true)}
            disabled={refreshing || loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <FileText size={16} />
            Save PDF
          </button>
          <button
            onClick={handleExportExcel}
            disabled={loading || periodInvalid}
            className="inline-flex items-center gap-2 rounded-xl bg-ledger-navy px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 disabled:opacity-50"
          >
            <FileSpreadsheet size={16} />
            Export Excel
          </button>
        </div>
      </div>

      <section className="reports-print-hide rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-1 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <CalendarDays size={17} />
              Reporting period
            </div>
            <select
              value={preset}
              onChange={event => handlePresetChange(event.target.value as DatePreset)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-blue-400"
            >
              <option value="this_month">This month</option>
              <option value="last_month">Last month</option>
              <option value="last_3_months">Last 3 months</option>
              <option value="last_6_months">Last 6 months</option>
              <option value="this_year">This year</option>
              <option value="last_year">Last year</option>
              <option value="custom">Custom range</option>
            </select>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-500">From</span>
              <input
                type="date"
                value={dateFrom}
                onChange={event => {
                  setPreset('custom')
                  setDateFrom(event.target.value)
                }}
                className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-500">To</span>
              <input
                type="date"
                value={dateTo}
                onChange={event => {
                  setPreset('custom')
                  setDateTo(event.target.value)
                }}
                className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400"
              />
            </label>
          </div>
        </div>

        {periodInvalid && (
          <p className="mt-3 text-sm text-red-600">
            Please select a valid reporting period. The start date must not be after the end date.
          </p>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Showing posted ledger activity from {dateFrom ? formatDate(dateFrom) : '—'} to {dateTo ? formatDate(dateTo) : '—'}.
          Draft entries are excluded.
        </p>
      </section>

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="font-semibold">Report loading error:</span>
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-20 text-sm text-slate-500">
          <RefreshCw size={18} className="animate-spin" />
          Preparing your financial reports...
        </div>
      ) : (
        <>
          {/* SUMMARY */}
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-800">Financial summary</h3>
                <p className="text-xs text-slate-500">For the selected reporting period</p>
              </div>
              <span className="text-xs text-slate-400">
                {report.periodEntryCount.toLocaleString('en-BD')} posted entries
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Total income"
                value={formatBDT(report.totalIncome)}
                detail="Posted income-category entries"
                icon={TrendingUp}
                tone="green"
              />
              <MetricCard
                label="Total expenses"
                value={formatBDT(report.totalExpenses)}
                detail="Posted expense-category entries"
                icon={TrendingDown}
                tone="red"
              />
              <MetricCard
                label="Net cash flow"
                value={formatBDT(report.net)}
                detail="Income minus expenses"
                icon={Activity}
                tone={report.net >= 0 ? 'blue' : 'red'}
              />
              <MetricCard
                label="Savings rate"
                value={`${report.savingsRate.toFixed(1)}%`}
                detail="Net cash flow divided by income"
                icon={Wallet}
                tone="purple"
              />
            </div>
          </section>

          {/* CASH FLOW */}
          <section className="grid gap-4 xl:grid-cols-3">
            <div className="reports-print-card rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
              <div className="mb-4">
                <h3 className="font-bold text-slate-800">Income vs expenses</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Monthly comparison for the selected period
                </p>
              </div>
              <div className="h-[300px]">
                {report.monthly.length > 0 ? (
                  <Line data={cashFlowChartData} options={lineOptions} />
                ) : (
                  <EmptyChart message="No monthly activity in this period." />
                )}
              </div>
            </div>

            <div className="reports-print-card rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4">
                <h3 className="font-bold text-slate-800">Expenses by category</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Distribution of posted expenses
                </p>
              </div>
              {report.expenseChartItems.length > 0 ? (
                <>
                  <div className="h-[220px]">
                    <Doughnut data={expenseChartData} options={doughnutOptions} />
                  </div>
                  <p className="mt-3 text-center text-sm font-semibold text-slate-700">
                    {formatBDT(report.totalExpenses)}
                  </p>
                </>
              ) : (
                <EmptyChart message="No expenses recorded in this period." />
              )}
            </div>
          </section>

          {/* CATEGORY BREAKDOWN */}
          <section className="grid gap-4 xl:grid-cols-2">
            <CategoryPanel
              title="Income by category"
              subtitle="Where your money came from"
              rows={report.incomeCategories}
              total={report.totalIncome}
              positive
            />
            <CategoryPanel
              title="Expenses by category"
              subtitle="Where your money was spent"
              rows={report.expenseCategories}
              total={report.totalExpenses}
            />
          </section>

          {/* NET WORTH */}
          <section>
            <div className="mb-3">
              <h3 className="text-lg font-bold text-slate-800">Net worth analysis</h3>
              <p className="text-xs text-slate-500">
                Based on financial accounts marked as included in net worth
              </p>
            </div>

            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <MetricCard
                label="Total assets"
                value={formatBDT(report.assets)}
                detail="Included asset accounts"
                icon={Wallet}
                tone="green"
              />
              <MetricCard
                label="Total liabilities"
                value={formatBDT(report.liabilities)}
                detail="Included liability accounts"
                icon={TrendingDown}
                tone="red"
              />
              <MetricCard
                label="Net worth"
                value={formatBDT(report.netWorth)}
                detail="Assets minus liabilities"
                icon={PieChart}
                tone="blue"
              />
            </div>

            <div className="reports-print-card rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4">
                <h3 className="font-bold text-slate-800">Net worth trend</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Opening position and month-end position during the selected period
                </p>
              </div>
              <div className="h-[300px]">
                {report.netWorthTrend.length > 0 ? (
                  <Line data={netWorthChartData} options={lineOptions} />
                ) : (
                  <EmptyChart message="No account balance history is available." />
                )}
              </div>
              {report.includedAccountCount === 0 && (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  No accounts are currently marked as included in net worth. Update the account setting to include assets or liabilities in this report.
                </p>
              )}
            </div>
          </section>

          {/* INVESTMENTS */}
          <section>
            <div className="mb-3">
              <h3 className="text-lg font-bold text-slate-800">Investment performance</h3>
              <p className="text-xs text-slate-500">
                Recorded portfolio values as of {formatDate(dateTo)}
              </p>
            </div>

            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Recorded portfolio value"
                value={formatBDT(report.investmentTotals.value)}
                detail="Latest valuation or linked ledger balance"
                icon={Wallet}
                tone="blue"
              />
              <MetricCard
                label="Unrealized gain / loss"
                value={formatBDT(report.investmentTotals.unrealized)}
                detail="Recorded value less remaining cost basis"
                icon={Activity}
                tone={report.investmentTotals.unrealized >= 0 ? 'green' : 'red'}
              />
              <MetricCard
                label="Cumulative realized gain / loss"
                value={formatBDT(report.investmentTotals.realized)}
                detail="All recorded sales and maturities"
                icon={TrendingUp}
                tone={report.investmentTotals.realized >= 0 ? 'green' : 'red'}
              />
              <MetricCard
                label="Cumulative investment income"
                value={formatBDT(report.investmentTotals.income)}
                detail="All recorded dividends and interest"
                icon={ArrowUpRight}
                tone="purple"
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              <div className="reports-print-card rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="font-bold text-slate-800">Portfolio by type</h3>
                <p className="mt-1 text-xs text-slate-500">Recorded value of active instruments</p>
                {report.investmentTypeTotals.length > 0 ? (
                  <div className="mt-3 h-[260px]">
                    <Doughnut data={investmentChartData} options={doughnutOptions} />
                  </div>
                ) : (
                  <EmptyChart message="No active investments found." />
                )}
              </div>

              <div className="reports-print-card overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm xl:col-span-2">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h3 className="font-bold text-slate-800">Investment details</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Individual investment values and recorded returns
                  </p>
                </div>

                {report.investmentRows.length === 0 ? (
                  <div className="px-5 py-12 text-center text-sm text-slate-500">
                    No active investment instruments found.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[700px] text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-5 py-3 font-semibold">Investment</th>
                          <th className="px-5 py-3 font-semibold">Type</th>
                          <th className="px-5 py-3 text-right font-semibold">Recorded value</th>
                          <th className="px-5 py-3 text-right font-semibold">Unrealized gain/loss</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {report.investmentRows.map(item => (
                          <tr key={item.id} className="hover:bg-slate-50/70">
                            <td className="px-5 py-3 font-medium text-slate-800">{item.name}</td>
                            <td className="px-5 py-3 text-slate-500">{formatType(item.type)}</td>
                            <td className="px-5 py-3 text-right font-semibold text-slate-800">{formatBDT(item.value)}</td>
                            <td className={`px-5 py-3 text-right font-semibold ${item.unrealized >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                              {formatBDT(item.unrealized)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 border-t border-slate-100 bg-slate-50/70 p-4 text-sm sm:grid-cols-4">
                  <MiniMetric label="Period investment income" value={formatBDT(report.periodInvestmentIncome)} />
                  <MiniMetric label="Period realized gain/loss" value={formatBDT(report.periodRealized)} />
                  <MiniMetric label="Remaining cost basis" value={formatBDT(report.investmentTotals.costBasis)} />
                  <MiniMetric label="Active instruments" value={String(report.investmentRows.length)} />
                </div>
              </div>
            </div>

            <p className="mt-3 text-xs leading-5 text-slate-500">
              Investment values use the latest saved valuation on or before the report end date. If no valuation exists, Ledger uses the linked posted account balance. GPF uses its linked ledger balance. Returns are based on recorded purchase, sale, maturity, dividend and interest activity; they are not independently verified market returns.
            </p>
          </section>

          {/* MONTHLY TABLE */}
          <section className="reports-print-card overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h3 className="font-bold text-slate-800">Monthly cash-flow details</h3>
              <p className="mt-1 text-xs text-slate-500">Income, expenses and net cash flow by month</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Month</th>
                    <th className="px-5 py-3 text-right font-semibold">Income</th>
                    <th className="px-5 py-3 text-right font-semibold">Expenses</th>
                    <th className="px-5 py-3 text-right font-semibold">Net cash flow</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.monthly.map(item => (
                    <tr key={item.key}>
                      <td className="px-5 py-3 font-medium text-slate-700">{item.label}</td>
                      <td className="px-5 py-3 text-right text-emerald-700">{formatBDT(item.income)}</td>
                      <td className="px-5 py-3 text-right text-red-600">{formatBDT(item.expenses)}</td>
                      <td className={`px-5 py-3 text-right font-semibold ${item.net >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                        {formatBDT(item.net)}
                      </td>
                    </tr>
                  ))}
                  {report.monthly.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-5 py-10 text-center text-slate-500">
                        No data for this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <div className="reports-print-hide flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <span>Ledger Reports · BDT · Posted entries only</span>
            <span>Generated {formatDate(localDateString(new Date()))}</span>
          </div>
        </>
      )}
    </div>
  )
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string
  value: string
  detail: string
  icon: LucideIcon
  tone: 'green' | 'red' | 'blue' | 'purple'
}) {
  const tones = {
    green: 'bg-emerald-50 text-emerald-700',
    red: 'bg-red-50 text-red-700',
    blue: 'bg-blue-50 text-blue-700',
    purple: 'bg-violet-50 text-violet-700',
  }

  return (
    <div className="reports-print-card rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">{label}</p>
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${tones[tone]}`}>
          <Icon size={20} />
        </div>
      </div>
      <p className="mt-4 break-words text-2xl font-bold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  )
}

function CategoryPanel({
  title,
  subtitle,
  rows,
  total,
  positive = false,
}: {
  title: string
  subtitle: string
  rows: CategoryTotal[]
  total: number
  positive?: boolean
}) {
  const color = positive ? 'bg-emerald-500' : 'bg-ledger-navy'

  return (
    <div className="reports-print-card rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-800">{title}</h3>
          <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
        </div>
        <span className={`text-sm font-bold ${positive ? 'text-emerald-700' : 'text-slate-800'}`}>
          {formatBDT(total)}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">No category data for this period.</p>
      ) : (
        <div className="space-y-4">
          {rows.slice(0, 8).map(row => {
            const percentage = total > 0 ? (row.amount / total) * 100 : 0
            return (
              <div key={row.id}>
                <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-medium text-slate-700">{row.name}</span>
                  <span className="shrink-0 font-semibold text-slate-800">{formatBDT(row.amount)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${color}`}
                    style={{ width: `${Math.min(100, percentage)}%` }}
                  />
                </div>
                <p className="mt-1 text-right text-[11px] text-slate-400">{percentage.toFixed(1)}%</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-bold text-slate-800">{value}</p>
    </div>
  )
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-[180px] items-center justify-center rounded-xl bg-slate-50 px-4 text-center text-sm text-slate-400">
      {message}
    </div>
  )
}
