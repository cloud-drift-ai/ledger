import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import {
  CalendarDays,
  Activity,
  Archive,
  ArrowUpRight,
  BriefcaseBusiness,
  CheckCircle2,
  CircleDollarSign,
  Coins,
  Download,
  FileText,
  Grid2X2,
  History,
  Landmark,
  LineChart,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Table2,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react'
import * as XLSX from 'xlsx'

import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatBDTMinor, formatLedgerDate } from '../lib/preferences'
import { useSearchParams } from 'react-router-dom'

// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------

type InstrumentType =
  | 'fdr'
  | 'dps'
  | 'savings_certificate'
  | 'stock'
  | 'mutual_fund'
  | 'gold'
  | 'other'
  | 'gpf'

type ActivityType =
  | 'purchase'
  | 'sale'
  | 'contribution'
  | 'withdrawal'
  | 'dividend'
  | 'interest'
  | 'fee'
  | 'maturity'
  | 'adjustment'

type InvestmentInstrument = {
  id: string
  user_id: string
  ledger_account_id: string
  name: string
  instrument_type: InstrumentType
  institution: string | null
  ticker_symbol: string | null
  currency: string
  purchase_date: string | null
  maturity_date: string | null
  units: number | string | null
  unit_cost_minor: number | string | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

type LedgerAccount = {
  id: string
  name: string
  account_kind: 'financial' | 'category'
  account_type: 'asset' | 'liability' | 'equity' | 'income' | 'expense'
  subtype: string | null
  is_active: boolean
}

type InvestmentActivity = {
  id: string
  user_id: string
  instrument_id: string
  journal_entry_id: string | null
  activity_type: ActivityType
  activity_date: string
  amount_minor: number | string
  units: number | string | null
  unit_price_minor: number | string | null
  fees_minor: number | string
  funding_mode: string | null
  counterparty_account_id: string | null
  counterparty_category_id: string | null
  cost_basis_minor: number | string | null
  notes: string | null
  created_at: string
}

type InvestmentValuation = {
  id: string
  instrument_id: string
  valuation_date: string
  market_value_minor: number | string
  unit_price_minor: number | string | null
  units: number | string | null
  valuation_source: string
  notes: string | null
  created_at: string
}

type GpfProfile = {
  id: string
  user_id: string
  instrument_id: string
  rate_schedule_id: string
  financial_year: string
  financial_year_start: string
  opening_balance_minor: number | string
  monthly_contribution_minor: number | string
  annual_contribution_increase_percent: number | string
  projection_years: number
}

type GpfRateSchedule = {
  id: string
  financial_year: string
  effective_from: string
  source_title: string | null
  source_date: string | null
  source_reference: string | null
}

type GpfRateTier = {
  id: string
  rate_schedule_id: string
  lower_balance_minor: number | string
  upper_balance_minor: number | string | null
  annual_rate_basis_points: number
  sort_order: number
}

type GpfSnapshot = {
  id: string
  gpf_profile_id: string
  financial_year: string
  calculation_date: string
  opening_balance_minor: number | string
  monthly_contribution_minor: number | string
  annual_rate_basis_points: number
  opening_interest_minor: number | string
  annual_contribution_minor: number | string
  contribution_interest_minor: number | string
  withdrawal_minor: number | string
  closing_balance_minor: number | string
  projection_years: number
  final_projected_balance_minor: number | string
  total_projected_earnings_minor: number | string
  created_at: string
}

type ProjectionRow = {
  year: number
  openingBalance: number
  monthlyContribution: number
  annualContribution: number
  rate: number
  openingInterest: number
  contributionInterest: number
  withdrawal: number
  closingBalance: number
}

type ModalType =
  | 'investment'
  | 'gpf'
  | 'purchase'
  | 'sale'
  | 'income'
  | 'fee'
  | 'valuation'
  | 'gpfContribution'
  | 'gpfWithdrawal'
  | 'gpfInterest'
  | null

type TabType = 'overview' | 'investments' | 'gpf' | 'history'
type InvestmentViewMode = 'cards' | 'table'
type InvestmentSortMode = 'value_desc' | 'name_asc' | 'maturity_asc' | 'return_desc'
type GpfHistoryPeriod = 'current' | 'previous' | 'all'

type InvestmentForm = {
  name: string
  instrumentType: InstrumentType
  institution: string
  tickerSymbol: string
  purchaseDate: string
  maturityDate: string
  notes: string
  instrumentId: string
  amount: string
  units: string
  unitPrice: string
  fees: string
  sourceAccountId: string
  destinationAccountId: string
  incomeCategoryId: string
  gainCategoryId: string
  lossCategoryId: string
  feeCategoryId: string
  expenseCategoryId: string
  activityDate: string
  marketValue: string
  valuationDate: string
  monthlyContribution: string
  openingBalance: string
  annualIncrease: string
  projectionYears: string
  financialYear: string
  financialYearStart: string
  fundingMode: 'account_transfer' | 'payroll_deduction'
  salaryCategoryId: string
  incomeType: 'interest' | 'dividend'
  saleActivityType: 'sale' | 'maturity'
}

const PAGE_SIZE = 1000
const BATCH_SIZE = 300

const INSTRUMENT_TYPES: { value: InstrumentType; label: string }[] = [
  { value: 'fdr', label: 'Fixed Deposit (FDR)' },
  { value: 'dps', label: 'DPS' },
  { value: 'savings_certificate', label: 'Savings Certificate' },
  { value: 'stock', label: 'Stocks / Shares' },
  { value: 'mutual_fund', label: 'Mutual Fund' },
  { value: 'gold', label: 'Gold' },
  { value: 'other', label: 'Other Investment' },
]

const EMPTY_FORM = (): InvestmentForm => ({
  name: '',
  instrumentType: 'fdr',
  institution: '',
  tickerSymbol: '',
  purchaseDate: todayString(),
  maturityDate: '',
  notes: '',
  instrumentId: '',
  amount: '',
  units: '1',
  unitPrice: '',
  fees: '0',
  sourceAccountId: '',
  destinationAccountId: '',
  incomeCategoryId: '',
  gainCategoryId: '',
  lossCategoryId: '',
  feeCategoryId: '',
  expenseCategoryId: '',
  activityDate: todayString(),
  marketValue: '',
  valuationDate: todayString(),
  monthlyContribution: '',
  openingBalance: '',
  annualIncrease: '5',
  projectionYears: '30',
  financialYear: '2026-27',
  financialYearStart: '2026-07-01',
  fundingMode: 'account_transfer',
  salaryCategoryId: '',
  incomeType: 'interest',
  saleActivityType: 'sale',
})

// -----------------------------------------------------------------------------
// FORMATTING AND CALCULATION HELPERS
// -----------------------------------------------------------------------------

function todayString() {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatBDT(minorValue: number | string | null | undefined) {
  return formatBDTMinor(minorValue)
}

function formatBDTValue(amount: number) {
  return formatBDT(Math.round(amount * 100))
}

function minorToInput(value: number | string | null | undefined) {
  return (Number(value || 0) / 100).toFixed(2)
}

function parseMoneyToMinor(value: string): number | null {
  const cleaned = value.trim()

  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null

  const [whole, fraction = ''] = cleaned.split('.')
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))

  if (!Number.isSafeInteger(minor) || minor < 0) return null
  return minor
}

function parsePositiveMoney(value: string, label: string) {
  const minor = parseMoneyToMinor(value)

  if (minor === null || minor <= 0) {
    throw new Error(`${label} must be greater than zero and have up to two decimal places.`)
  }

  return minor
}

function parseOptionalMoney(value: string, label: string) {
  const minor = parseMoneyToMinor(value || '0')

  if (minor === null) {
    throw new Error(`${label} must be a valid amount with up to two decimal places.`)
  }

  return minor
}

function formatDate(value: string | null | undefined) {
  return formatLedgerDate(value)
}

function shiftIsoYear(value: string, years: number) {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return ''
  const [year, month, day] = value.split('-').map(Number)
  const targetYear = year + years
  const target = new Date(targetYear, month - 1, day)
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`
}

function daysUntilDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  const target = new Date(year, month - 1, day)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

function instrumentTypeLabel(value: InstrumentType) {
  return INSTRUMENT_TYPES.find(item => item.value === value)?.label ||
    (value === 'gpf' ? 'General Provident Fund' : 'Other Investment')
}

function investmentColorTone(value: InstrumentType) {
  const tones: Record<InstrumentType, string> = {
    fdr: 'blue',
    dps: 'teal',
    savings_certificate: 'amber',
    stock: 'violet',
    mutual_fund: 'cyan',
    gold: 'gold',
    other: 'slate',
    gpf: 'green',
  }
  return tones[value] || 'slate'
}

function activityTypeLabel(value: ActivityType) {
  const labels: Record<ActivityType, string> = {
    purchase: 'Purchase',
    sale: 'Sale',
    contribution: 'Contribution',
    withdrawal: 'Withdrawal',
    dividend: 'Dividend',
    interest: 'Interest',
    fee: 'Fee',
    maturity: 'Maturity',
    adjustment: 'Adjustment',
  }

  return labels[value] || value
}

function roundToTwo(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function getRateForBalance(
  openingBalance: number,
  tiers: GpfRateTier[]
): number | null {
  const balanceMinor = Math.round(openingBalance * 100)

  const tier = [...tiers]
    .sort((a, b) => a.sort_order - b.sort_order)
    .find(item => {
      const lower = Number(item.lower_balance_minor)
      const upper = item.upper_balance_minor === null
        ? null
        : Number(item.upper_balance_minor)

      return balanceMinor >= lower && (upper === null || balanceMinor <= upper)
    })

  return tier ? Number(tier.annual_rate_basis_points) / 100 : null
}

function calculateGpfProjection(
  openingBalance: number,
  startingMonthlyContribution: number,
  annualIncreasePercent: number,
  withdrawal: number,
  projectionYears: number,
  tiers: GpfRateTier[]
) {
  const rows: ProjectionRow[] = []
  let balance = openingBalance
  let monthlyContribution = startingMonthlyContribution
  let totalContributions = 0

  for (let year = 1; year <= projectionYears; year += 1) {
    if (year > 1) {
      monthlyContribution = roundToTwo(
        monthlyContribution * (1 + annualIncreasePercent / 100)
      )
    }

    const rate = getRateForBalance(balance, tiers)
    if (rate === null) {
      return {
        rows: [],
        error: `No interest-rate tier covers the opening balance for projection year ${year}.`,
        totalContributions: 0,
        totalEarnings: 0,
        finalBalance: 0,
        firstYearInterest: 0,
      }
    }

    const openingInterest = balance * rate / 100
    const annualContribution = monthlyContribution * 12
    const contributionInterest = monthlyContribution * rate / 100 * 6.5
    const yearWithdrawal = year === 1 ? withdrawal : 0
    const closingBalance =
      balance +
      openingInterest +
      annualContribution +
      contributionInterest -
      yearWithdrawal

    if (closingBalance < 0) {
      return {
        rows: [],
        error: `The withdrawal entered for year 1 exceeds the calculated closing balance.`,
        totalContributions: 0,
        totalEarnings: 0,
        finalBalance: 0,
        firstYearInterest: 0,
      }
    }

    rows.push({
      year,
      openingBalance: balance,
      monthlyContribution,
      annualContribution,
      rate,
      openingInterest,
      contributionInterest,
      withdrawal: yearWithdrawal,
      closingBalance,
    })

    totalContributions += annualContribution
    balance = closingBalance
  }

  const first = rows[0]
  const finalBalance = rows.length ? rows[rows.length - 1].closingBalance : 0
  const totalEarnings =
    finalBalance - openingBalance - totalContributions + withdrawal

  return {
    rows,
    error: '',
    totalContributions,
    totalEarnings,
    finalBalance,
    firstYearInterest: first
      ? first.openingInterest + first.contributionInterest
      : 0,
  }
}

function getInvestmentIcon(type: InstrumentType) {
  if (type === 'gpf') return <ShieldCheck size={21} />
  if (type === 'fdr' || type === 'dps') return <Landmark size={21} />
  if (type === 'stock' || type === 'mutual_fund') return <LineChart size={21} />
  if (type === 'gold') return <Coins size={21} />
  if (type === 'savings_certificate') return <FileText size={21} />
  return <BriefcaseBusiness size={21} />
}

// -----------------------------------------------------------------------------
// SMALL UI COMPONENTS
// -----------------------------------------------------------------------------

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-5 text-slate-500">{hint}</span>}
    </label>
  )
}

function ModalShell({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-3 sm:p-6">
      <div className={`max-h-[92vh] w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} overflow-y-auto rounded-2xl bg-white shadow-2xl`}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-100 bg-white px-5 py-4 sm:px-6">
          <div>
            <h2 className="text-lg font-bold text-slate-800">{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close dialog"
          >
            <X size={19} />
          </button>
        </div>
        <div className="p-5 sm:p-6">{children}</div>
      </div>
    </div>
  )
}

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-800 outline-none transition focus:border-ledger-navy focus:ring-2 focus:ring-blue-100'

const selectClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-800 outline-none focus:border-ledger-navy focus:ring-2 focus:ring-blue-100'

// -----------------------------------------------------------------------------
// MAIN PAGE
// -----------------------------------------------------------------------------

export default function Investments() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  const [instruments, setInstruments] = useState<InvestmentInstrument[]>([])
  const [activities, setActivities] = useState<InvestmentActivity[]>([])
  const [valuations, setValuations] = useState<InvestmentValuation[]>([])
  const [profiles, setProfiles] = useState<GpfProfile[]>([])
  const [rateSchedules, setRateSchedules] = useState<GpfRateSchedule[]>([])
  const [rateTiers, setRateTiers] = useState<GpfRateTier[]>([])
  const [snapshots, setSnapshots] = useState<GpfSnapshot[]>([])
  const [assetAccounts, setAssetAccounts] = useState<LedgerAccount[]>([])
  const [incomeCategories, setIncomeCategories] = useState<LedgerAccount[]>([])
  const [expenseCategories, setExpenseCategories] = useState<LedgerAccount[]>([])
  const [accountBalances, setAccountBalances] = useState<Record<string, number>>({})

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pageError, setPageError] = useState('')
  const [notice, setNotice] = useState('')

  const [activeTab, setActiveTab] = useState<TabType>('overview')
  const [showArchived, setShowArchived] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [investmentViewMode, setInvestmentViewMode] = useState<InvestmentViewMode>('cards')
  const [investmentTypeFilter, setInvestmentTypeFilter] = useState<InstrumentType | 'all'>('all')
  const [investmentSortMode, setInvestmentSortMode] = useState<InvestmentSortMode>('value_desc')
  const [gpfHistoryPeriod, setGpfHistoryPeriod] = useState<GpfHistoryPeriod>('current')
  const [modalType, setModalType] = useState<ModalType>(null)
  const [modalError, setModalError] = useState('')
  const [form, setForm] = useState<InvestmentForm>(EMPTY_FORM())
  const [showRateEditor, setShowRateEditor] = useState(false)
  const [rateEdits, setRateEdits] = useState<Record<string, string>>({})

  const [gpfInputs, setGpfInputs] = useState({
    openingBalance: '',
    monthlyContribution: '',
    annualIncrease: '5',
    withdrawal: '0',
    projectionYears: '30',
  })

  const loadData = useCallback(async () => {
    if (!user?.id) {
      setInstruments([])
      setActivities([])
      setValuations([])
      setProfiles([])
      setRateSchedules([])
      setRateTiers([])
      setSnapshots([])
      setAssetAccounts([])
      setIncomeCategories([])
      setExpenseCategories([])
      setAccountBalances({})
      setLoading(false)
      return
    }

    setLoading(true)
    setPageError('')

    try {
      const [
        instrumentResult,
        profileResult,
        scheduleResult,
        tierResult,
        snapshotResult,
        assetResult,
        categoryResult,
      ] = await Promise.all([
        supabase
          .from('investment_instruments')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase.from('gpf_profiles').select('*'),
        supabase.from('gpf_rate_schedules').select('*'),
        supabase
          .from('gpf_rate_tiers')
          .select('*')
          .order('sort_order', { ascending: true }),
        supabase
          .from('gpf_calculation_snapshots')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100),
        supabase
          .from('ledger_accounts')
          .select('id, name, account_kind, account_type, subtype, is_active')
          .eq('account_kind', 'financial')
          .eq('account_type', 'asset')
          .eq('is_active', true)
          .order('name', { ascending: true }),
        supabase
          .from('ledger_accounts')
          .select('id, name, account_kind, account_type, subtype, is_active')
          .eq('account_kind', 'category')
          .in('account_type', ['income', 'expense'])
          .eq('is_active', true)
          .order('name', { ascending: true }),
      ])

      const results = [
        instrumentResult,
        profileResult,
        scheduleResult,
        tierResult,
        snapshotResult,
        assetResult,
        categoryResult,
      ]

      for (const result of results) {
        if (result.error) throw result.error
      }

      // Load the complete activity and valuation histories in pages. A single
      // `.limit(2000)` can still be truncated by the Supabase project row cap,
      // which would understate cost basis and investment income over time.
      const activityRows: InvestmentActivity[] = []
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await supabase
          .from('investment_activities')
          .select('*')
          .order('activity_date', { ascending: false })
          .order('created_at', { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1)

        if (error) throw error
        const page = (data || []) as InvestmentActivity[]
        activityRows.push(...page)
        if (page.length < PAGE_SIZE) break
      }

      const valuationRows: InvestmentValuation[] = []
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await supabase
          .from('investment_valuations')
          .select('*')
          .order('valuation_date', { ascending: false })
          .order('created_at', { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1)

        if (error) throw error
        const page = (data || []) as InvestmentValuation[]
        valuationRows.push(...page)
        if (page.length < PAGE_SIZE) break
      }

      const instrumentRows = (instrumentResult.data || []) as InvestmentInstrument[]
      setInstruments(instrumentRows)
      setActivities(activityRows)
      setValuations(valuationRows)

      const profileRows = (profileResult.data || []) as GpfProfile[]
      setProfiles(profileRows)
      setRateSchedules((scheduleResult.data || []) as GpfRateSchedule[])
      const tierRows = (tierResult.data || []) as GpfRateTier[]
      setRateTiers(tierRows)
      setSnapshots((snapshotResult.data || []) as GpfSnapshot[])

      const assets = (assetResult.data || []) as LedgerAccount[]
      const categories = (categoryResult.data || []) as LedgerAccount[]
      setAssetAccounts(assets.filter(item => item.subtype !== 'investment'))
      setIncomeCategories(categories.filter(item => item.account_type === 'income'))
      setExpenseCategories(categories.filter(item => item.account_type === 'expense'))

      // Calculate posted balances for every investment's linked asset account.
      const accountIds = instrumentRows.map(item => item.ledger_account_id)
      const balanceMap: Record<string, number> = {}

      if (accountIds.length > 0) {
        const allLines: {
          id: string
          journal_entry_id: string
          ledger_account_id: string
          debit_minor: number | string
          credit_minor: number | string
        }[] = []

        for (let offset = 0; ; offset += PAGE_SIZE) {
          const { data, error } = await supabase
            .from('journal_lines')
            .select('id, journal_entry_id, ledger_account_id, debit_minor, credit_minor')
            .in('ledger_account_id', accountIds)
            .order('created_at', { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1)

          if (error) throw error

          const page = data || []
          allLines.push(...page)

          if (page.length < PAGE_SIZE) break
        }

        const entryIds = [...new Set(allLines.map(line => line.journal_entry_id))]
        const postedEntryIds = new Set<string>()

        for (let offset = 0; offset < entryIds.length; offset += BATCH_SIZE) {
          const batch = entryIds.slice(offset, offset + BATCH_SIZE)
          const { data, error } = await supabase
            .from('journal_entries')
            .select('id')
            .in('id', batch)
            .eq('status', 'posted')

          if (error) throw error

          for (const entry of data || []) postedEntryIds.add(entry.id)
        }

        for (const line of allLines) {
          if (!postedEntryIds.has(line.journal_entry_id)) continue

          const movement =
            Number(line.debit_minor) - Number(line.credit_minor)

          balanceMap[line.ledger_account_id] =
            (balanceMap[line.ledger_account_id] || 0) + movement
        }
      }

      setAccountBalances(balanceMap)

      setRateEdits(
        Object.fromEntries(
          tierRows.map(tier => [
            tier.id,
            (Number(tier.annual_rate_basis_points) / 100).toString(),
          ])
        )
      )
    } catch (err) {
      console.error('Investment data loading error:', err)
      setPageError(
        err instanceof Error ? err.message : 'Unable to load investment data.'
      )
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const instrumentById = useMemo(
    () => new Map(instruments.map(item => [item.id, item])),
    [instruments]
  )

  const activeInstruments = useMemo(
    () => instruments.filter(item => item.is_active),
    [instruments]
  )

  const archivedInstruments = useMemo(
    () => instruments.filter(item => !item.is_active),
    [instruments]
  )

  const visibleInstruments = useMemo(() => {
    const source = showArchived ? archivedInstruments : activeInstruments
    const query = searchTerm.trim().toLowerCase()

    return source.filter(item => {
      const matchesQuery = !query ||
        `${item.name} ${item.institution || ''} ${instrumentTypeLabel(item.instrument_type)}`
          .toLowerCase()
          .includes(query)
      const matchesType = investmentTypeFilter === 'all' ||
        item.instrument_type === investmentTypeFilter

      return matchesQuery && matchesType
    })
  }, [
    showArchived,
    archivedInstruments,
    activeInstruments,
    searchTerm,
    investmentTypeFilter,
  ])

  const latestValuationByInstrument = useMemo(() => {
    const map = new Map<string, InvestmentValuation>()

    for (const valuation of valuations) {
      if (!map.has(valuation.instrument_id)) {
        map.set(valuation.instrument_id, valuation)
      }
    }

    return map
  }, [valuations])

  const costBasisByInstrument = useMemo(() => {
    const map: Record<string, number> = {}

    for (const activity of activities) {
      const amount = Number(activity.amount_minor)
      const costBasis = Number(activity.cost_basis_minor || 0)

      if (activity.activity_type === 'purchase') {
        map[activity.instrument_id] =
          (map[activity.instrument_id] || 0) + (costBasis || amount)
      } else if (
        activity.activity_type === 'sale' ||
        activity.activity_type === 'maturity'
      ) {
        map[activity.instrument_id] =
          (map[activity.instrument_id] || 0) - costBasis
      }
    }

    return map
  }, [activities])

  const realizedResultByInstrument = useMemo(() => {
    const map: Record<string, number> = {}

    for (const activity of activities) {
      if (
        activity.activity_type !== 'sale' &&
        activity.activity_type !== 'maturity'
      ) continue

      const result =
        Number(activity.amount_minor) -
        Number(activity.cost_basis_minor || 0) -
        Number(activity.fees_minor || 0)

      map[activity.instrument_id] =
        (map[activity.instrument_id] || 0) + result
    }

    return map
  }, [activities])

  const incomeByInstrument = useMemo(() => {
    const map: Record<string, number> = {}

    for (const activity of activities) {
      if (
        activity.activity_type !== 'dividend' &&
        activity.activity_type !== 'interest'
      ) continue

      map[activity.instrument_id] =
        (map[activity.instrument_id] || 0) + Number(activity.amount_minor)
    }

    return map
  }, [activities])

  const instrumentValue = useCallback(
    (instrument: InvestmentInstrument) => {
      const bookValue = accountBalances[instrument.ledger_account_id] || 0
      if (instrument.instrument_type === 'gpf') return bookValue

      const valuation = latestValuationByInstrument.get(instrument.id)
      return valuation
        ? Number(valuation.market_value_minor)
        : bookValue
    },
    [accountBalances, latestValuationByInstrument]
  )

  const sortedVisibleInstruments = useMemo(() => {
    const items = [...visibleInstruments]

    items.sort((a, b) => {
      if (investmentSortMode === 'name_asc') {
        return a.name.localeCompare(b.name)
      }

      if (investmentSortMode === 'maturity_asc') {
        if (!a.maturity_date && !b.maturity_date) return a.name.localeCompare(b.name)
        if (!a.maturity_date) return 1
        if (!b.maturity_date) return -1
        return a.maturity_date.localeCompare(b.maturity_date)
      }

      if (investmentSortMode === 'return_desc') {
        const aCost = Math.max(0, costBasisByInstrument[a.id] || 0)
        const bCost = Math.max(0, costBasisByInstrument[b.id] || 0)
        const aReturn = a.instrument_type === 'gpf' || aCost === 0
          ? Number.NEGATIVE_INFINITY
          : (instrumentValue(a) - aCost) / aCost
        const bReturn = b.instrument_type === 'gpf' || bCost === 0
          ? Number.NEGATIVE_INFINITY
          : (instrumentValue(b) - bCost) / bCost
        return bReturn - aReturn
      }

      return instrumentValue(b) - instrumentValue(a)
    })

    return items
  }, [
    visibleInstruments,
    investmentSortMode,
    instrumentValue,
    costBasisByInstrument,
  ])

  const portfolioTotals = useMemo(() => {
    let currentValue = 0
    let remainingCost = 0
    let realized = 0
    let income = 0

    for (const instrument of activeInstruments) {
      currentValue += instrumentValue(instrument)
      remainingCost += instrument.instrument_type === 'gpf'
        ? (accountBalances[instrument.ledger_account_id] || 0)
        : Math.max(0, costBasisByInstrument[instrument.id] || 0)
      realized += realizedResultByInstrument[instrument.id] || 0
      income += incomeByInstrument[instrument.id] || 0
    }

    return {
      currentValue,
      remainingCost,
      unrealized: currentValue - remainingCost,
      realized,
      income,
    }
  }, [
    activeInstruments,
    instrumentValue,
    accountBalances,
    costBasisByInstrument,
    realizedResultByInstrument,
    incomeByInstrument,
  ])

  const allocationByType = useMemo(() => {
    const totals = new Map<InstrumentType, number>()

    for (const instrument of activeInstruments) {
      totals.set(
        instrument.instrument_type,
        (totals.get(instrument.instrument_type) || 0) + instrumentValue(instrument)
      )
    }

    return [...totals.entries()]
      .map(([type, value]) => ({ type, value }))
      .sort((a, b) => b.value - a.value)
  }, [activeInstruments, instrumentValue])

  const upcomingMaturities = useMemo(() => {
    return activeInstruments
      .filter(item => item.instrument_type !== 'gpf' && item.maturity_date)
      .map(item => ({
        instrument: item,
        days: daysUntilDate(item.maturity_date as string),
      }))
      .filter(item => item.days >= -30 && item.days <= 90)
      .sort((a, b) => a.days - b.days)
      .slice(0, 6)
  }, [activeInstruments])

  const gpfProfile = profiles[0] || null

  useEffect(() => {
    if (!gpfProfile) return

    setGpfInputs(previous => ({
      ...previous,
      openingBalance: minorToInput(gpfProfile.opening_balance_minor),
      monthlyContribution: minorToInput(gpfProfile.monthly_contribution_minor),
      annualIncrease: String(gpfProfile.annual_contribution_increase_percent),
      projectionYears: String(gpfProfile.projection_years),
    }))
  }, [
    gpfProfile?.id,
    gpfProfile?.opening_balance_minor,
    gpfProfile?.monthly_contribution_minor,
    gpfProfile?.annual_contribution_increase_percent,
    gpfProfile?.projection_years,
  ])

  const gpfInstrument = gpfProfile
    ? instrumentById.get(gpfProfile.instrument_id) || null
    : null
  const gpfSchedule = gpfProfile
    ? rateSchedules.find(item => item.id === gpfProfile.rate_schedule_id) || null
    : null
  const gpfTiers = gpfProfile
    ? rateTiers.filter(item => item.rate_schedule_id === gpfProfile.rate_schedule_id)
    : []
  const gpfCurrentBalance = gpfInstrument
    ? accountBalances[gpfInstrument.ledger_account_id] || 0
    : 0

  const gpfYearStart = gpfProfile?.financial_year_start || ''
  const gpfYearEnd = gpfYearStart ? shiftIsoYear(gpfYearStart, 1) : ''
  const gpfPreviousYearStart = gpfYearStart ? shiftIsoYear(gpfYearStart, -1) : ''

  const gpfActivities = useMemo(() => {
    if (!gpfInstrument) return []
    return activities
      .filter(item => item.instrument_id === gpfInstrument.id)
      .sort((a, b) => {
        const dateOrder = b.activity_date.localeCompare(a.activity_date)
        return dateOrder || b.created_at.localeCompare(a.created_at)
      })
  }, [activities, gpfInstrument?.id])

  const gpfFilteredActivities = useMemo(() => {
    if (gpfHistoryPeriod === 'all' || !gpfYearStart || !gpfYearEnd) {
      return gpfActivities
    }

    if (gpfHistoryPeriod === 'previous') {
      return gpfActivities.filter(item =>
        item.activity_date >= gpfPreviousYearStart &&
        item.activity_date < gpfYearStart
      )
    }

    return gpfActivities.filter(item =>
      item.activity_date >= gpfYearStart &&
      item.activity_date < gpfYearEnd
    )
  }, [
    gpfActivities,
    gpfHistoryPeriod,
    gpfYearStart,
    gpfYearEnd,
    gpfPreviousYearStart,
  ])

  const gpfActivityTotals = useMemo(() => {
    return gpfFilteredActivities.reduce((totals, item) => {
      const amount = Number(item.amount_minor || 0)

      if (item.activity_type === 'contribution') totals.contributions += amount
      if (item.activity_type === 'withdrawal') totals.withdrawals += amount
      if (item.activity_type === 'interest') totals.interest += amount
      if (item.activity_type === 'fee') totals.fees += amount

      return totals
    }, {
      contributions: 0,
      withdrawals: 0,
      interest: 0,
      fees: 0,
    })
  }, [gpfFilteredActivities])

  const projection = useMemo(() => {
    if (!gpfProfile || gpfTiers.length === 0) {
      return {
        rows: [] as ProjectionRow[],
        error: 'Create a GPF profile and configure its interest-rate tiers to calculate a projection.',
        totalContributions: 0,
        totalEarnings: 0,
        finalBalance: 0,
        firstYearInterest: 0,
      }
    }

    const openingMinor = parseMoneyToMinor(gpfInputs.openingBalance)
    const monthlyMinor = parseMoneyToMinor(gpfInputs.monthlyContribution)
    const withdrawalMinor = parseMoneyToMinor(gpfInputs.withdrawal)
    const annualIncrease = Number(gpfInputs.annualIncrease)
    const years = Number(gpfInputs.projectionYears)

    if (
      openingMinor === null ||
      monthlyMinor === null ||
      withdrawalMinor === null ||
      !Number.isFinite(annualIncrease) || annualIncrease < 0 || annualIncrease > 100 ||
      !Number.isInteger(years) || years < 1 || years > 30
    ) {
      return {
        rows: [] as ProjectionRow[],
        error: 'Enter valid amounts with up to two decimal places. Annual increase must be 0–100%, and the projection period must be 1–30 years.',
        totalContributions: 0,
        totalEarnings: 0,
        finalBalance: 0,
        firstYearInterest: 0,
      }
    }

    return calculateGpfProjection(
      openingMinor / 100,
      monthlyMinor / 100,
      annualIncrease,
      withdrawalMinor / 100,
      years,
      gpfTiers
    )
  }, [gpfProfile, gpfTiers, gpfInputs])

  const exportGpfStatement = () => {
    if (!gpfInstrument || !gpfProfile) return

    const periodLabel = gpfHistoryPeriod === 'all'
      ? 'All_History'
      : gpfHistoryPeriod === 'previous'
        ? 'Previous_FY'
        : gpfProfile.financial_year.replace(/[^0-9A-Za-z-]/g, '_')

    const summaryRows = [
      ['Ledger — GPF Statement'],
      ['Account', gpfInstrument.name],
      ['Financial year filter', gpfHistoryPeriod === 'all' ? 'All history' : gpfHistoryPeriod === 'previous' ? 'Previous financial year' : gpfProfile.financial_year],
      ['Actual posted ledger balance (BDT)', gpfCurrentBalance / 100],
      ['Calculator opening balance (BDT)', Number(gpfProfile.opening_balance_minor) / 100],
      ['Monthly contribution assumption (BDT)', Number(gpfProfile.monthly_contribution_minor) / 100],
      ['Annual contribution increase (%)', Number(gpfProfile.annual_contribution_increase_percent)],
      ['Recorded contributions in selected period (BDT)', gpfActivityTotals.contributions / 100],
      ['Recorded withdrawals in selected period (BDT)', gpfActivityTotals.withdrawals / 100],
      ['Interest credited in selected period (BDT)', gpfActivityTotals.interest / 100],
      ['Fees in selected period (BDT)', gpfActivityTotals.fees / 100],
      ['Projected first-year closing balance (BDT)', projection.rows[0]?.closingBalance ?? null],
      ['Projected final balance (BDT)', projection.rows.length ? projection.finalBalance : null],
      ['Note', 'Actual posted balance is from the ledger. Projection values are estimates based on saved assumptions and selected rate tiers.'],
    ]

    const activityRows = gpfFilteredActivities.map(item => ({
      Date: item.activity_date,
      Activity: activityTypeLabel(item.activity_type),
      'Amount (BDT)': Number(item.amount_minor) / 100,
      'Funding mode': item.funding_mode === 'payroll_deduction'
        ? 'Payroll deduction'
        : item.funding_mode === 'account_transfer'
          ? 'Account transfer'
          : '',
      Notes: item.notes || '',
    }))

    const projectionRows = projection.rows.map(row => ({
      Year: row.year,
      'Opening balance (BDT)': row.openingBalance,
      'Monthly contribution (BDT)': row.monthlyContribution,
      'Annual contribution (BDT)': row.annualContribution,
      'Annual rate (%)': row.rate,
      'Opening balance interest (BDT)': row.openingInterest,
      'Contribution interest (BDT)': row.contributionInterest,
      'Withdrawal (BDT)': row.withdrawal,
      'Closing balance (BDT)': row.closingBalance,
    }))

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryRows), 'GPF Summary')
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(activityRows.length ? activityRows : [{ Note: 'No GPF activity in this period.' }]),
      'GPF Activity'
    )
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(projectionRows.length ? projectionRows : [{ Note: 'No valid projection available.' }]),
      'GPF Projection'
    )
    XLSX.writeFile(workbook, `Ledger_GPF_Statement_${periodLabel}.xlsx`)
  }

  const exportPortfolio = () => {
    const rows = sortedVisibleInstruments.map(instrument => {
      const value = instrumentValue(instrument)
      const cost = instrument.instrument_type === 'gpf'
        ? value
        : Math.max(0, costBasisByInstrument[instrument.id] || 0)

      return {
        Investment: instrument.name,
        Type: instrumentTypeLabel(instrument.instrument_type),
        Institution: instrument.institution || '',
        Status: instrument.is_active ? 'Active' : 'Archived',
        'Current value (BDT)': value / 100,
        'Cost basis (BDT)': cost / 100,
        'Unrealized P/L (BDT)': instrument.instrument_type === 'gpf' ? null : (value - cost) / 100,
        'Realized result (BDT)': (realizedResultByInstrument[instrument.id] || 0) / 100,
        'Income received (BDT)': (incomeByInstrument[instrument.id] || 0) / 100,
        'Maturity date': instrument.maturity_date || '',
        'Latest valuation date': latestValuationByInstrument.get(instrument.id)?.valuation_date || '',
      }
    })

    const worksheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: 'No investments match the current filters.' }])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Portfolio')
    XLSX.writeFile(workbook, 'Ledger_Investment_Portfolio.xlsx')
  }

  const activeActivities = useMemo(
    () => activities.filter(item => {
      const instrument = instrumentById.get(item.instrument_id)
      return instrument?.is_active
    }),
    [activities, instrumentById]
  )

  const openModal = (type: ModalType, instrumentId = '') => {
    const nextForm = EMPTY_FORM()
    nextForm.instrumentId = instrumentId
    nextForm.sourceAccountId = assetAccounts[0]?.id || ''
    nextForm.destinationAccountId = assetAccounts[0]?.id || ''
    nextForm.incomeCategoryId = incomeCategories[0]?.id || ''
    nextForm.gainCategoryId = incomeCategories[0]?.id || ''
    nextForm.lossCategoryId = expenseCategories[0]?.id || ''
    nextForm.feeCategoryId = expenseCategories[0]?.id || ''
    nextForm.expenseCategoryId = expenseCategories[0]?.id || ''
    nextForm.salaryCategoryId = incomeCategories[0]?.id || ''

    if (type === 'gpf') {
      nextForm.name = 'General Provident Fund'
      nextForm.openingBalance = '0.00'
      nextForm.monthlyContribution = '0.00'
    }

    if (type === 'gpfInterest' && projection.firstYearInterest > 0) {
      nextForm.amount = projection.firstYearInterest.toFixed(2)
    }

    if (type === 'valuation' && instrumentId) {
      const valuation = latestValuationByInstrument.get(instrumentId)
      if (valuation) {
        nextForm.marketValue = minorToInput(valuation.market_value_minor)
      }
    }

    setForm(nextForm)
    setModalError('')
    setModalType(type)
  }

  useEffect(() => {
    if (loading) return
    const command = searchParams.get('new')
    const requestedSearch = searchParams.get('search')
    if (requestedSearch !== null) {
      setSearchTerm(requestedSearch)
      setActiveTab('investments')
    }
    if (command === 'investment') {
      openModal('investment')
    } else if (command === 'gpfContribution' || command === 'gpfWithdrawal') {
      if (gpfInstrument) {
        openModal(command, gpfInstrument.id)
      } else {
        setActiveTab('gpf')
        setNotice('Set up your GPF account before recording a contribution or withdrawal.')
      }
    }
    if (command === 'investment' || command === 'gpfContribution' || command === 'gpfWithdrawal' || requestedSearch !== null) setSearchParams({}, { replace: true })
    // Wait for investment and GPF data before opening a form with account defaults.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, searchParams, setSearchParams, gpfInstrument?.id])

  const closeModal = () => {
    if (saving) return
    setModalType(null)
    setModalError('')
  }

  const updateForm = (key: keyof InvestmentForm, value: string) => {
    setForm(previous => ({ ...previous, [key]: value } as InvestmentForm))
  }

  const handleSubmitModal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setModalError('')
    setSaving(true)

    try {
      if (!user?.id) throw new Error('Please sign in again.')

      if (modalType === 'investment') {
        const name = form.name.trim()
        if (!name) throw new Error('Enter an investment name.')

        const { error } = await supabase.rpc('create_investment_instrument', {
          p_name: name,
          p_instrument_type: form.instrumentType,
          p_institution: form.institution.trim() || null,
          p_ticker_symbol: form.tickerSymbol.trim() || null,
          p_purchase_date: form.purchaseDate || null,
          p_maturity_date: form.maturityDate || null,
          p_notes: form.notes.trim() || null,
        })

        if (error) throw error
        setNotice(`${name} was added to your investments.`)
      }

      if (modalType === 'gpf') {
        const name = form.name.trim()
        if (!name) throw new Error('Enter a GPF account name.')

        const opening = parseOptionalMoney(form.openingBalance, 'Opening balance')
        const monthly = parseOptionalMoney(form.monthlyContribution, 'Monthly contribution')
        const increase = Number(form.annualIncrease)
        const years = Number(form.projectionYears)

        if (!Number.isFinite(increase) || increase < 0 || increase > 100) {
          throw new Error('Annual contribution increase must be between 0 and 100%.')
        }
        if (!Number.isInteger(years) || years < 1 || years > 30) {
          throw new Error('Projection period must be between 1 and 30 years.')
        }

        const { error } = await supabase.rpc('create_gpf_account', {
          p_name: name,
          p_opening_balance_minor: opening,
          p_monthly_contribution_minor: monthly,
          p_annual_increase_percent: increase,
          p_projection_years: years,
          p_financial_year: form.financialYear.trim() || '2026-27',
          p_financial_year_start: form.financialYearStart,
          p_institution: 'Government Provident Fund',
          p_notes: form.notes.trim() || null,
        })

        if (error) throw error
        setNotice('Your GPF account and calculator profile were created.')
        setActiveTab('gpf')
      }

      if (modalType === 'purchase') {
        if (!form.instrumentId) throw new Error('Select an investment.')
        if (!form.sourceAccountId) throw new Error('Select the funding account.')

        const amount = parsePositiveMoney(form.amount, 'Purchase amount')
        const fees = parseOptionalMoney(form.fees, 'Purchase fees')
        const units = Number(form.units)

        if (!Number.isFinite(units) || units <= 0) {
          throw new Error('Units must be greater than zero.')
        }

        const unitPrice = form.unitPrice.trim()
          ? parsePositiveMoney(form.unitPrice, 'Unit price')
          : null

        const { error } = await supabase.rpc('create_investment_purchase', {
          p_instrument_id: form.instrumentId,
          p_source_account_id: form.sourceAccountId,
          p_amount_minor: amount,
          p_units: units,
          p_unit_price_minor: unitPrice,
          p_fees_minor: fees,
          p_activity_date: form.activityDate,
          p_notes: form.notes.trim() || null,
        })

        if (error) throw error
        setNotice('Investment purchase recorded successfully.')
      }

      if (modalType === 'sale') {
        if (!form.instrumentId) throw new Error('Select an investment.')
        if (!form.destinationAccountId) throw new Error('Select the receiving account.')

        const amount = parsePositiveMoney(form.amount, 'Sale proceeds')
        const fees = parseOptionalMoney(form.fees, 'Sale fees')
        const units = Number(form.units)

        if (!Number.isFinite(units) || units <= 0) {
          throw new Error('Units sold must be greater than zero.')
        }

        const { error } = await supabase.rpc('create_investment_sale', {
          p_instrument_id: form.instrumentId,
          p_destination_account_id: form.destinationAccountId,
          p_gross_proceeds_minor: amount,
          p_units: units,
          p_sale_fees_minor: fees,
          p_realized_gain_category_id: form.gainCategoryId || null,
          p_realized_loss_category_id: form.lossCategoryId || null,
          p_fee_expense_category_id: form.feeCategoryId || null,
          p_activity_date: form.activityDate,
          p_activity_type: form.saleActivityType,
          p_notes: form.notes.trim() || null,
        })

        if (error) throw error
        setNotice('Investment sale recorded successfully.')
      }

      if (modalType === 'income') {
        if (!form.instrumentId) throw new Error('Select an investment.')
        if (!form.destinationAccountId) throw new Error('Select the receiving account.')
        if (!form.incomeCategoryId) throw new Error('Select an income category.')

        const amount = parsePositiveMoney(form.amount, 'Income amount')

        const { error } = await supabase.rpc('create_investment_income', {
          p_instrument_id: form.instrumentId,
          p_destination_account_id: form.destinationAccountId,
          p_income_category_id: form.incomeCategoryId,
          p_amount_minor: amount,
          p_activity_type: form.incomeType,
          p_activity_date: form.activityDate,
          p_notes: form.notes.trim() || null,
        })

        if (error) throw error
        setNotice('Investment income recorded successfully.')
      }

      if (modalType === 'fee') {
        if (!form.instrumentId) throw new Error('Select an investment.')
        if (!form.sourceAccountId) throw new Error('Select the payment account.')
        if (!form.expenseCategoryId) throw new Error('Select an expense category.')

        const amount = parsePositiveMoney(form.amount, 'Fee amount')

        const { error } = await supabase.rpc('create_investment_fee', {
          p_instrument_id: form.instrumentId,
          p_source_account_id: form.sourceAccountId,
          p_expense_category_id: form.expenseCategoryId,
          p_amount_minor: amount,
          p_activity_date: form.activityDate,
          p_notes: form.notes.trim() || null,
        })

        if (error) throw error
        setNotice('Investment fee recorded successfully.')
      }

      if (modalType === 'valuation') {
        if (!form.instrumentId) throw new Error('Select an investment.')

        const marketValue = parseOptionalMoney(form.marketValue, 'Market value')

        const { error } = await supabase
          .from('investment_valuations')
          .upsert(
            {
              user_id: user.id,
              instrument_id: form.instrumentId,
              valuation_date: form.valuationDate,
              market_value_minor: marketValue,
              valuation_source: 'manual',
              notes: form.notes.trim() || null,
            },
            { onConflict: 'instrument_id,valuation_date' }
          )

        if (error) throw error
        setNotice('Investment valuation saved.')
      }

      if (modalType === 'gpfContribution') {
        if (!gpfInstrument) throw new Error('Create a GPF account first.')

        const amount = parsePositiveMoney(form.amount, 'Contribution amount')

        if (
          form.fundingMode === 'account_transfer' &&
          !form.sourceAccountId
        ) {
          throw new Error('Select the bank or wallet funding the contribution.')
        }

        if (
          form.fundingMode === 'payroll_deduction' &&
          !form.salaryCategoryId
        ) {
          throw new Error('Select the salary income category.')
        }

        const { error } = await supabase.rpc('create_gpf_contribution', {
          p_instrument_id: gpfInstrument.id,
          p_amount_minor: amount,
          p_activity_date: form.activityDate,
          p_funding_mode: form.fundingMode,
          p_source_account_id:
            form.fundingMode === 'account_transfer' ? form.sourceAccountId : null,
          p_salary_income_category_id:
            form.fundingMode === 'payroll_deduction' ? form.salaryCategoryId : null,
          p_notes: form.notes.trim() || null,
        })

        if (error) throw error
        setNotice('GPF contribution recorded successfully.')
      }

      if (modalType === 'gpfWithdrawal') {
        if (!gpfInstrument) throw new Error('Create a GPF account first.')
        if (!form.destinationAccountId) throw new Error('Select the receiving account.')

        const amount = parsePositiveMoney(form.amount, 'Withdrawal amount')

        const { error } = await supabase.rpc('create_gpf_withdrawal', {
          p_instrument_id: gpfInstrument.id,
          p_destination_account_id: form.destinationAccountId,
          p_amount_minor: amount,
          p_activity_date: form.activityDate,
          p_notes: form.notes.trim() || null,
        })

        if (error) throw error
        setNotice('GPF withdrawal recorded successfully.')
      }

      if (modalType === 'gpfInterest') {
        if (!gpfInstrument) throw new Error('Create a GPF account first.')
        if (!form.incomeCategoryId) throw new Error('Select an interest income category.')

        const amount = parsePositiveMoney(form.amount, 'Interest credit')

        const { error } = await supabase.rpc('create_gpf_interest_credit', {
          p_instrument_id: gpfInstrument.id,
          p_interest_income_category_id: form.incomeCategoryId,
          p_amount_minor: amount,
          p_activity_date: form.activityDate,
          p_notes: form.notes.trim() || null,
        })

        if (error) throw error
        setNotice('GPF interest credit recorded successfully.')
      }

      setModalType(null)
      setModalError('')
      await loadData()
    } catch (err) {
      console.error('Investment action error:', err)
      setModalError(
        err instanceof Error ? err.message : 'Unable to complete this action.'
      )
    } finally {
      setSaving(false)
    }
  }

  const saveGpfAssumptions = async () => {
    if (!gpfProfile) return

    setSaving(true)
    setPageError('')
    setNotice('')

    try {
      const opening = parseOptionalMoney(gpfInputs.openingBalance, 'Opening balance')
      const monthly = parseOptionalMoney(gpfInputs.monthlyContribution, 'Monthly contribution')
      const increase = Number(gpfInputs.annualIncrease)
      const years = Number(gpfInputs.projectionYears)

      if (!Number.isFinite(increase) || increase < 0 || increase > 100) {
        throw new Error('Annual contribution increase must be between 0 and 100%.')
      }
      if (!Number.isInteger(years) || years < 1 || years > 30) {
        throw new Error('Projection period must be between 1 and 30 years.')
      }

      const { error } = await supabase
        .from('gpf_profiles')
        .update({
          opening_balance_minor: opening,
          monthly_contribution_minor: monthly,
          annual_contribution_increase_percent: increase,
          projection_years: years,
        })
        .eq('id', gpfProfile.id)

      if (error) throw error

      setNotice('GPF calculator assumptions saved. This does not change the actual ledger balance.')
      await loadData()
    } catch (err) {
      console.error('GPF settings update error:', err)
      setPageError(
        err instanceof Error ? err.message : 'Unable to save GPF assumptions.'
      )
    } finally {
      setSaving(false)
    }
  }

  const saveGpfSnapshot = async () => {
    if (!user?.id || !gpfProfile || !gpfSchedule) return
    if (!projection.rows.length || projection.error) {
      setPageError(projection.error || 'There is no valid projection to save.')
      return
    }

    const first = projection.rows[0]
    const last = projection.rows[projection.rows.length - 1]
    const openingMinor = parseOptionalMoney(gpfInputs.openingBalance, 'Opening balance')
    const monthlyMinor = parseOptionalMoney(gpfInputs.monthlyContribution, 'Monthly contribution')
    const withdrawalMinor = parseOptionalMoney(gpfInputs.withdrawal, 'Withdrawal')

    const snapshotRows = projection.rows.map(row => ({
      year: row.year,
      opening_balance: roundToTwo(row.openingBalance),
      monthly_contribution: roundToTwo(row.monthlyContribution),
      annual_contribution: roundToTwo(row.annualContribution),
      annual_rate: row.rate,
      opening_interest: roundToTwo(row.openingInterest),
      contribution_interest: roundToTwo(row.contributionInterest),
      withdrawal: roundToTwo(row.withdrawal),
      closing_balance: roundToTwo(row.closingBalance),
    }))

    setSaving(true)
    setPageError('')
    setNotice('')

    try {
      const { error } = await supabase
        .from('gpf_calculation_snapshots')
        .insert({
          user_id: user.id,
          gpf_profile_id: gpfProfile.id,
          rate_schedule_id: gpfProfile.rate_schedule_id,
          financial_year: gpfProfile.financial_year,
          calculation_date: todayString(),
          opening_balance_minor: openingMinor,
          monthly_contribution_minor: monthlyMinor,
          annual_rate_basis_points: Math.round(first.rate * 100),
          opening_interest_minor: Math.round(first.openingInterest * 100),
          annual_contribution_minor: Math.round(first.annualContribution * 100),
          contribution_interest_minor: Math.round(first.contributionInterest * 100),
          withdrawal_minor: withdrawalMinor,
          closing_balance_minor: Math.round(first.closingBalance * 100),
          annual_contribution_increase_percent: Number(gpfInputs.annualIncrease),
          projection_years: projection.rows.length,
          total_projected_contributions_minor: Math.round(projection.totalContributions * 100),
          final_projected_balance_minor: Math.round(last.closingBalance * 100),
          total_projected_earnings_minor: Math.round(projection.totalEarnings * 100),
          projection_rows: snapshotRows,
        })

      if (error) throw error

      setNotice('GPF calculation saved to your permanent calculation history.')
      await loadData()
    } catch (err) {
      console.error('GPF snapshot save error:', err)
      setPageError(
        err instanceof Error ? err.message : 'Unable to save the GPF calculation.'
      )
    } finally {
      setSaving(false)
    }
  }

  const saveRateChanges = async () => {
    if (!gpfTiers.length) return

    setSaving(true)
    setPageError('')
    setNotice('')

    try {
      for (const tier of gpfTiers) {
        const rate = Number(rateEdits[tier.id])

        if (!Number.isFinite(rate) || rate <= 0 || rate > 100) {
          throw new Error('Each annual interest rate must be greater than 0 and no more than 100%.')
        }

        const { error } = await supabase
          .from('gpf_rate_tiers')
          .update({ annual_rate_basis_points: Math.round(rate * 100) })
          .eq('id', tier.id)

        if (error) throw error
      }

      setShowRateEditor(false)
      setNotice('GPF interest-rate tiers updated. Previous saved calculation snapshots remain unchanged.')
      await loadData()
    } catch (err) {
      console.error('GPF rate update error:', err)
      setPageError(
        err instanceof Error ? err.message : 'Unable to update GPF interest rates.'
      )
    } finally {
      setSaving(false)
    }
  }

  const archiveInstrument = async (instrument: InvestmentInstrument) => {
    const confirmed = window.confirm(
      `Archive "${instrument.name}"? Its history will be preserved, but it will no longer be available for new transactions.`
    )

    if (!confirmed) return

    setSaving(true)
    setPageError('')
    setNotice('')

    try {
      const { error } = await supabase.rpc('set_investment_instrument_active', {
        p_instrument_id: instrument.id,
        p_is_active: false,
      })

      if (error) throw error

      setNotice(`${instrument.name} has been archived.`)
      await loadData()
    } catch (err) {
      console.error('Investment archive error:', err)
      setPageError(
        err instanceof Error ? err.message : 'Unable to archive this investment.'
      )
    } finally {
      setSaving(false)
    }
  }

  const restoreInstrument = async (instrument: InvestmentInstrument) => {
    setSaving(true)
    setPageError('')
    setNotice('')

    try {
      const { error } = await supabase.rpc('set_investment_instrument_active', {
        p_instrument_id: instrument.id,
        p_is_active: true,
      })

      if (error) throw error

      setNotice(`${instrument.name} has been restored.`)
      await loadData()
    } catch (err) {
      console.error('Investment restore error:', err)
      setPageError(
        err instanceof Error ? err.message : 'Unable to restore this investment.'
      )
    } finally {
      setSaving(false)
    }
  }

  const renderInstrumentTable = (items: InvestmentInstrument[]) => {
    if (!items.length) {
      return (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          No investments match the current filters.
        </div>
      )
    }

    return (
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[1050px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Investment</th>
              <th className="px-4 py-3 font-semibold">Type</th>
              <th className="px-4 py-3 text-right font-semibold">Current value</th>
              <th className="px-4 py-3 text-right font-semibold">Cost basis</th>
              <th className="px-4 py-3 text-right font-semibold">Unrealized P/L</th>
              <th className="px-4 py-3 font-semibold">Maturity</th>
              <th className="px-4 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map(instrument => {
              const value = instrumentValue(instrument)
              const cost = instrument.instrument_type === 'gpf'
                ? value
                : Math.max(0, costBasisByInstrument[instrument.id] || 0)
              const unrealized = value - cost
              const valuation = latestValuationByInstrument.get(instrument.id)

              return (
                <tr key={instrument.id} className="text-slate-700 hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-800">{instrument.name}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{instrument.institution || '—'}</div>
                    {valuation && instrument.instrument_type !== 'gpf' && (
                      <div className="mt-0.5 text-[11px] text-slate-400">Valued {formatDate(valuation.valuation_date)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">{instrumentTypeLabel(instrument.instrument_type)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold">{formatBDT(value)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">{formatBDT(cost)}</td>
                  <td className={`whitespace-nowrap px-4 py-3 text-right font-semibold ${
                    instrument.instrument_type === 'gpf'
                      ? 'text-slate-400'
                      : unrealized >= 0 ? 'text-emerald-700' : 'text-red-600'
                  }`}>
                    {instrument.instrument_type === 'gpf'
                      ? '—'
                      : `${unrealized >= 0 ? '+' : ''}${formatBDT(unrealized)}`}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                    {instrument.maturity_date ? formatDate(instrument.maturity_date) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      {instrument.is_active && instrument.instrument_type === 'gpf' ? (
                        <button type="button" onClick={() => setActiveTab('gpf')} className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700">Open GPF</button>
                      ) : instrument.is_active ? (
                        <>
                          <button type="button" onClick={() => openModal('purchase', instrument.id)} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200">Add</button>
                          <button type="button" onClick={() => openModal('valuation', instrument.id)} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200">Value</button>
                        </>
                      ) : (
                        <button type="button" disabled={saving} onClick={() => void restoreInstrument(instrument)} className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700">Restore</button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  const tabs: { id: TabType; label: string; icon: ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <Activity size={16} /> },
    { id: 'investments', label: 'My Investments', icon: <BriefcaseBusiness size={16} /> },
    { id: 'gpf', label: 'GPF Management', icon: <ShieldCheck size={16} /> },
    { id: 'history', label: 'Investment History', icon: <History size={16} /> },
  ]

  const activeRegularInvestments = activeInstruments.filter(
    item => item.instrument_type !== 'gpf'
  )

  const activityRows = activeActivities.slice(0, 100)

  const renderInstrumentCards = (items: InvestmentInstrument[]) => {
    if (!items.length) {
      return (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <BriefcaseBusiness className="mx-auto text-slate-300" size={34} />
          <h3 className="mt-3 font-semibold text-slate-700">No investments found</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            Add your first investment to start tracking its cost, value, income and history.
          </p>
          {!showArchived && (
            <button
              type="button"
              onClick={() => openModal('investment')}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-ledger-navy px-4 py-3 text-sm font-semibold text-white"
            >
              <Plus size={16} />
              Add Investment
            </button>
          )}
        </div>
      )
    }

    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map(instrument => {
          const value = instrumentValue(instrument)
          const cost = instrument.instrument_type === 'gpf'
            ? value
            : Math.max(0, costBasisByInstrument[instrument.id] || 0)
          const unrealized = value - cost
          const latestValuation = latestValuationByInstrument.get(instrument.id)

          return (
            <article
              key={instrument.id}
              data-tone={investmentColorTone(instrument.instrument_type)}
              className="ledger-investment-card rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div data-tone={investmentColorTone(instrument.instrument_type)} className="ledger-investment-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-xl">
                    {getInvestmentIcon(instrument.instrument_type)}
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate font-bold text-slate-800">
                      {instrument.name}
                    </h3>
                    <p className="mt-1 truncate text-xs text-slate-500">
                      {instrument.institution || instrumentTypeLabel(instrument.instrument_type)}
                    </p>
                  </div>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  instrument.is_active
                    ? 'bg-green-50 text-green-700'
                    : 'bg-slate-100 text-slate-500'
                }`}>
                  {instrument.is_active ? 'Active' : 'Archived'}
                </span>
              </div>

              <div className="mt-5">
                <p className="text-xs font-medium text-slate-500">
                  {latestValuation && instrument.instrument_type !== 'gpf'
                    ? 'Latest market value'
                    : 'Current book balance'}
                </p>
                <p className="mt-1 text-2xl font-bold tracking-tight text-slate-800">
                  {formatBDT(value)}
                </p>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
                <div>
                  <p className="text-xs text-slate-500">Cost basis</p>
                  <p className="mt-1 text-sm font-semibold text-slate-700">
                    {formatBDT(cost)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">
                    {instrument.instrument_type === 'gpf' ? 'Interest / income' : 'Unrealized P/L'}
                  </p>
                  <p className={`mt-1 text-sm font-semibold ${
                    instrument.instrument_type === 'gpf'
                      ? 'text-slate-700'
                      : unrealized >= 0 ? 'text-green-700' : 'text-red-600'
                  }`}>
                    {instrument.instrument_type === 'gpf'
                      ? formatBDT(incomeByInstrument[instrument.id] || 0)
                      : `${unrealized >= 0 ? '+' : ''}${formatBDT(unrealized)}`}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span data-tone={investmentColorTone(instrument.instrument_type)} className="ledger-investment-type rounded-full px-2.5 py-1 font-semibold">
                  {instrumentTypeLabel(instrument.instrument_type)}
                </span>
                {instrument.maturity_date && (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">
                    Matures {formatDate(instrument.maturity_date)}
                  </span>
                )}
              </div>

              <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                {instrument.is_active && instrument.instrument_type !== 'gpf' && (
                  <>
                    <button
                      type="button"
                      onClick={() => openModal('purchase', instrument.id)}
                      className="rounded-lg bg-ledger-navy px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700"
                    >
                      Buy / Add
                    </button>
                    <button
                      type="button"
                      onClick={() => openModal('sale', instrument.id)}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      Sell
                    </button>
                    <button
                      type="button"
                      onClick={() => openModal('income', instrument.id)}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      Income
                    </button>
                    <button
                      type="button"
                      onClick={() => openModal('fee', instrument.id)}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      Fee
                    </button>
                    <button
                      type="button"
                      onClick={() => openModal('valuation', instrument.id)}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      Update Value
                    </button>
                  </>
                )}
                {instrument.is_active && instrument.instrument_type === 'gpf' && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('gpf')}
                    className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
                  >
                    Open GPF
                  </button>
                )}
                {instrument.is_active ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void archiveInstrument(instrument)}
                    className="ml-auto rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                    title="Archive investment"
                  >
                    <Archive size={16} />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void restoreInstrument(instrument)}
                    className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-semibold text-green-700 hover:bg-green-50 disabled:opacity-50"
                  >
                    <RotateCcw size={14} />
                    Restore
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </div>
    )
  }

  const renderModal = () => {
    if (!modalType) return null

    const isGpfModal = modalType === 'gpf'
    const titleMap: Record<Exclude<ModalType, null>, string> = {
      investment: 'Add Investment',
      gpf: 'Create GPF Account',
      purchase: 'Record Investment Purchase',
      sale: 'Record Investment Sale',
      income: 'Record Dividend / Interest',
      fee: 'Record Investment Fee',
      valuation: 'Update Investment Valuation',
      gpfContribution: 'Record GPF Contribution',
      gpfWithdrawal: 'Record GPF Withdrawal',
      gpfInterest: 'Credit GPF Interest',
    }

    const subtitleMap: Record<Exclude<ModalType, null>, string> = {
      investment: 'Add an FDR, DPS, savings certificate, stock, mutual fund, gold or other investment.',
      gpf: 'Create a dedicated GPF account and its Excel-based calculator profile.',
      purchase: 'Record the purchase through your double-entry ledger.',
      sale: 'Record sale proceeds, fees and realized gain or loss.',
      income: 'Record income received from this investment.',
      fee: 'Record an investment-related fee paid from an account.',
      valuation: 'Save a manual market valuation for this date.',
      gpfContribution: 'Record a contribution to your General Provident Fund.',
      gpfWithdrawal: 'Transfer a GPF withdrawal to a bank, wallet or cash account.',
      gpfInterest: 'Post the calculated annual GPF interest to the ledger.',
    }

    const investmentSelect = (
      <Field label="Investment">
        <select
          className={selectClass}
          value={form.instrumentId}
          onChange={event => updateForm('instrumentId', event.target.value)}
          required
        >
          <option value="">Select investment</option>
          {activeRegularInvestments.map(item => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </Field>
    )

    const accountSelect = (
      key: 'sourceAccountId' | 'destinationAccountId',
      label: string
    ) => (
      <Field label={label}>
        <select
          className={selectClass}
          value={form[key]}
          onChange={event => updateForm(key, event.target.value)}
          required
        >
          <option value="">Select account</option>
          {assetAccounts.map(account => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </Field>
    )

    const incomeCategorySelect = (
      key: 'incomeCategoryId' | 'gainCategoryId' | 'salaryCategoryId',
      label: string
    ) => (
      <Field label={label}>
        <select
          className={selectClass}
          value={form[key]}
          onChange={event => updateForm(key, event.target.value)}
        >
          <option value="">Select income category</option>
          {incomeCategories.map(category => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </Field>
    )

    const expenseCategorySelect = (
      key: 'lossCategoryId' | 'feeCategoryId' | 'expenseCategoryId',
      label: string
    ) => (
      <Field label={label}>
        <select
          className={selectClass}
          value={form[key]}
          onChange={event => updateForm(key, event.target.value)}
        >
          <option value="">Select expense category</option>
          {expenseCategories.map(category => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </Field>
    )

    return (
      <ModalShell
        title={titleMap[modalType]}
        subtitle={subtitleMap[modalType]}
        onClose={closeModal}
        wide={modalType === 'sale' || modalType === 'gpf' || modalType === 'investment'}
      >
        <form onSubmit={handleSubmitModal} className="space-y-4">
          {modalError && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {modalError}
            </div>
          )}

          {modalType === 'investment' && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Investment name">
                  <input
                    className={inputClass}
                    value={form.name}
                    onChange={event => updateForm('name', event.target.value)}
                    placeholder="e.g. DBBL FDR"
                    required
                  />
                </Field>
                <Field label="Investment type">
                  <select
                    className={selectClass}
                    value={form.instrumentType}
                    onChange={event => updateForm('instrumentType', event.target.value)}
                  >
                    {INSTRUMENT_TYPES.map(item => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Bank / institution">
                  <input
                    className={inputClass}
                    value={form.institution}
                    onChange={event => updateForm('institution', event.target.value)}
                    placeholder="e.g. Dutch-Bangla Bank"
                  />
                </Field>
                <Field label="Ticker symbol (optional)">
                  <input
                    className={inputClass}
                    value={form.tickerSymbol}
                    onChange={event => updateForm('tickerSymbol', event.target.value)}
                    placeholder="e.g. GP"
                  />
                </Field>
                <Field label="Purchase / start date">
                  <input
                    className={inputClass}
                    type="date"
                    value={form.purchaseDate}
                    onChange={event => updateForm('purchaseDate', event.target.value)}
                  />
                </Field>
                <Field label="Maturity date (optional)">
                  <input
                    className={inputClass}
                    type="date"
                    value={form.maturityDate}
                    onChange={event => updateForm('maturityDate', event.target.value)}
                  />
                </Field>
              </div>
              <Field label="Notes">
                <textarea
                  className={inputClass}
                  rows={2}
                  value={form.notes}
                  onChange={event => updateForm('notes', event.target.value)}
                  placeholder="Optional details"
                />
              </Field>
            </>
          )}

          {isGpfModal && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="GPF account name">
                  <input
                    className={inputClass}
                    value={form.name}
                    onChange={event => updateForm('name', event.target.value)}
                    required
                  />
                </Field>
                <Field label="Financial year">
                  <input
                    className={inputClass}
                    value={form.financialYear}
                    onChange={event => updateForm('financialYear', event.target.value)}
                    placeholder="2026-27"
                    required
                  />
                </Field>
                <Field label="Financial year starts">
                  <input
                    className={inputClass}
                    type="date"
                    value={form.financialYearStart}
                    onChange={event => updateForm('financialYearStart', event.target.value)}
                    required
                  />
                </Field>
                <Field label="Opening balance (BDT)">
                  <input
                    className={inputClass}
                    inputMode="decimal"
                    value={form.openingBalance}
                    onChange={event => updateForm('openingBalance', event.target.value)}
                    placeholder="0.00"
                    required
                  />
                </Field>
                <Field label="Monthly GPF contribution (BDT)">
                  <input
                    className={inputClass}
                    inputMode="decimal"
                    value={form.monthlyContribution}
                    onChange={event => updateForm('monthlyContribution', event.target.value)}
                    placeholder="0.00"
                    required
                  />
                </Field>
                <Field label="Annual contribution increase (%)">
                  <input
                    className={inputClass}
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={form.annualIncrease}
                    onChange={event => updateForm('annualIncrease', event.target.value)}
                  />
                </Field>
                <Field label="Projection period (years)">
                  <input
                    className={inputClass}
                    type="number"
                    min="1"
                    max="30"
                    step="1"
                    value={form.projectionYears}
                    onChange={event => updateForm('projectionYears', event.target.value)}
                  />
                </Field>
              </div>
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-800">
                The opening balance is also posted to your Ledger asset account as its opening balance. The calculator assumptions can be changed later without changing that ledger entry.
              </div>
              <Field label="Notes">
                <textarea
                  className={inputClass}
                  rows={2}
                  value={form.notes}
                  onChange={event => updateForm('notes', event.target.value)}
                />
              </Field>
            </>
          )}

          {modalType === 'purchase' && (
            <>
              {investmentSelect}
              <div className="grid gap-4 sm:grid-cols-2">
                {accountSelect('sourceAccountId', 'Pay from account')}
                <Field label="Purchase date">
                  <input
                    className={inputClass}
                    type="date"
                    value={form.activityDate}
                    onChange={event => updateForm('activityDate', event.target.value)}
                    required
                  />
                </Field>
                <Field label="Purchase amount (BDT)">
                  <input
                    className={inputClass}
                    inputMode="decimal"
                    value={form.amount}
                    onChange={event => updateForm('amount', event.target.value)}
                    placeholder="0.00"
                    required
                  />
                </Field>
                <Field label="Units purchased">
                  <input
                    className={inputClass}
                    type="number"
                    min="0.00000001"
                    step="any"
                    value={form.units}
                    onChange={event => updateForm('units', event.target.value)}
                    required
                  />
                </Field>
                <Field label="Unit price (optional, BDT)">
                  <input
                    className={inputClass}
                    inputMode="decimal"
                    value={form.unitPrice}
                    onChange={event => updateForm('unitPrice', event.target.value)}
                    placeholder="Calculated if blank"
                  />
                </Field>
                <Field label="Purchase fees (BDT)">
                  <input
                    className={inputClass}
                    inputMode="decimal"
                    value={form.fees}
                    onChange={event => updateForm('fees', event.target.value)}
                  />
                </Field>
              </div>
              <Field label="Notes">
                <textarea className={inputClass} rows={2} value={form.notes} onChange={event => updateForm('notes', event.target.value)} />
              </Field>
            </>
          )}

          {modalType === 'sale' && (
            <>
              {investmentSelect}
              <div className="grid gap-4 sm:grid-cols-2">
                {accountSelect('destinationAccountId', 'Deposit proceeds into')}
                <Field label="Transaction type">
                  <select className={selectClass} value={form.saleActivityType} onChange={event => updateForm('saleActivityType', event.target.value)}>
                    <option value="sale">Sale</option>
                    <option value="maturity">Maturity / encashment</option>
                  </select>
                </Field>
                <Field label="Sale / maturity date">
                  <input className={inputClass} type="date" value={form.activityDate} onChange={event => updateForm('activityDate', event.target.value)} required />
                </Field>
                <Field label="Gross proceeds (BDT)">
                  <input className={inputClass} inputMode="decimal" value={form.amount} onChange={event => updateForm('amount', event.target.value)} required />
                </Field>
                <Field label="Units sold">
                  <input className={inputClass} type="number" min="0.00000001" step="any" value={form.units} onChange={event => updateForm('units', event.target.value)} required />
                </Field>
                <Field label="Sale fees (BDT)">
                  <input className={inputClass} inputMode="decimal" value={form.fees} onChange={event => updateForm('fees', event.target.value)} />
                </Field>
                {expenseCategorySelect('feeCategoryId', 'Sale-fee expense category')}
                {incomeCategorySelect('gainCategoryId', 'Realized-gain income category')}
                {expenseCategorySelect('lossCategoryId', 'Realized-loss expense category')}
              </div>
              <p className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                Select the gain category if the sale produces a profit, or the loss category if it produces a loss. A fee category is required only when sale fees are entered.
              </p>
              <Field label="Notes">
                <textarea className={inputClass} rows={2} value={form.notes} onChange={event => updateForm('notes', event.target.value)} />
              </Field>
            </>
          )}

          {modalType === 'income' && (
            <>
              {investmentSelect}
              <div className="grid gap-4 sm:grid-cols-2">
                {accountSelect('destinationAccountId', 'Deposit into account')}
                {incomeCategorySelect('incomeCategoryId', 'Income category')}
                <Field label="Income type">
                  <select className={selectClass} value={form.incomeType} onChange={event => updateForm('incomeType', event.target.value)}>
                    <option value="interest">Interest</option>
                    <option value="dividend">Dividend</option>
                  </select>
                </Field>
                <Field label="Received date">
                  <input className={inputClass} type="date" value={form.activityDate} onChange={event => updateForm('activityDate', event.target.value)} required />
                </Field>
                <Field label="Amount (BDT)">
                  <input className={inputClass} inputMode="decimal" value={form.amount} onChange={event => updateForm('amount', event.target.value)} required />
                </Field>
              </div>
              <Field label="Notes">
                <textarea className={inputClass} rows={2} value={form.notes} onChange={event => updateForm('notes', event.target.value)} />
              </Field>
            </>
          )}

          {modalType === 'fee' && (
            <>
              {investmentSelect}
              <div className="grid gap-4 sm:grid-cols-2">
                {accountSelect('sourceAccountId', 'Pay from account')}
                {expenseCategorySelect('expenseCategoryId', 'Expense category')}
                <Field label="Fee date">
                  <input className={inputClass} type="date" value={form.activityDate} onChange={event => updateForm('activityDate', event.target.value)} required />
                </Field>
                <Field label="Fee amount (BDT)">
                  <input className={inputClass} inputMode="decimal" value={form.amount} onChange={event => updateForm('amount', event.target.value)} required />
                </Field>
              </div>
              <Field label="Notes">
                <textarea className={inputClass} rows={2} value={form.notes} onChange={event => updateForm('notes', event.target.value)} />
              </Field>
            </>
          )}

          {modalType === 'valuation' && (
            <>
              {investmentSelect}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Valuation date">
                  <input className={inputClass} type="date" value={form.valuationDate} onChange={event => updateForm('valuationDate', event.target.value)} required />
                </Field>
                <Field label="Market value (BDT)">
                  <input className={inputClass} inputMode="decimal" value={form.marketValue} onChange={event => updateForm('marketValue', event.target.value)} required />
                </Field>
              </div>
              <Field label="Notes">
                <textarea className={inputClass} rows={2} value={form.notes} onChange={event => updateForm('notes', event.target.value)} />
              </Field>
            </>
          )}

          {modalType === 'gpfContribution' && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Contribution date">
                  <input className={inputClass} type="date" value={form.activityDate} onChange={event => updateForm('activityDate', event.target.value)} required />
                </Field>
                <Field label="Contribution amount (BDT)">
                  <input className={inputClass} inputMode="decimal" value={form.amount} onChange={event => updateForm('amount', event.target.value)} required />
                </Field>
                <Field label="Funding method">
                  <select className={selectClass} value={form.fundingMode} onChange={event => updateForm('fundingMode', event.target.value)}>
                    <option value="account_transfer">Transfer from bank / wallet</option>
                    <option value="payroll_deduction">Payroll deduction</option>
                  </select>
                </Field>
                {form.fundingMode === 'account_transfer'
                  ? accountSelect('sourceAccountId', 'Contribution paid from')
                  : incomeCategorySelect('salaryCategoryId', 'Salary income category')}
              </div>
              <p className="rounded-xl bg-blue-50 p-3 text-xs leading-5 text-blue-800">
                Use payroll deduction only if your salary was recorded net of GPF. Otherwise, choose a bank or wallet transfer.
              </p>
              <Field label="Notes">
                <textarea className={inputClass} rows={2} value={form.notes} onChange={event => updateForm('notes', event.target.value)} />
              </Field>
            </>
          )}

          {modalType === 'gpfWithdrawal' && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                {accountSelect('destinationAccountId', 'Deposit withdrawal into')}
                <Field label="Withdrawal date">
                  <input className={inputClass} type="date" value={form.activityDate} onChange={event => updateForm('activityDate', event.target.value)} required />
                </Field>
                <Field label="Withdrawal amount (BDT)">
                  <input className={inputClass} inputMode="decimal" value={form.amount} onChange={event => updateForm('amount', event.target.value)} required />
                </Field>
              </div>
              <Field label="Notes">
                <textarea className={inputClass} rows={2} value={form.notes} onChange={event => updateForm('notes', event.target.value)} />
              </Field>
            </>
          )}

          {modalType === 'gpfInterest' && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                {incomeCategorySelect('incomeCategoryId', 'Interest income category')}
                <Field label="Interest credit date">
                  <input className={inputClass} type="date" value={form.activityDate} onChange={event => updateForm('activityDate', event.target.value)} required />
                </Field>
                <Field label="Interest to credit (BDT)">
                  <input className={inputClass} inputMode="decimal" value={form.amount} onChange={event => updateForm('amount', event.target.value)} required />
                </Field>
              </div>
              <p className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                The suggested amount is the first-year interest from the calculator (opening-balance interest plus contribution interest). Check it against the actual GPF statement before posting. Posting creates a permanent journal entry.
              </p>
              <Field label="Notes">
                <textarea className={inputClass} rows={2} value={form.notes} onChange={event => updateForm('notes', event.target.value)} />
              </Field>
            </>
          )}

          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={closeModal}
              disabled={saving}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-ledger-navy px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </ModalShell>
    )
  }

  return (
    <div className="min-h-screen bg-ledger-bg p-5 md:p-8">
      <div className="mx-auto max-w-7xl">
        {/* Page header */}
        <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Investments</h1>
            <p className="mt-1 text-sm text-slate-500">
              Track your portfolio, returns, income and General Provident Fund.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading || saving}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw size={16} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => openModal('investment')}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Plus size={16} />
              Add Investment
            </button>
            {!gpfProfile && (
              <button
                type="button"
                onClick={() => openModal('gpf')}
                className="inline-flex items-center gap-2 rounded-xl bg-ledger-navy px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700"
              >
                <ShieldCheck size={16} />
                Add GPF
              </button>
            )}
          </div>
        </div>

        {pageError && (
          <div role="alert" className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <span>{pageError}</span>
            <button type="button" onClick={() => setPageError('')} aria-label="Dismiss error" className="rounded p-1 hover:bg-red-100">
              <X size={16} />
            </button>
          </div>
        )}

        {notice && (
          <div role="status" className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-700">
            <span className="flex items-center gap-2">
              <CheckCircle2 size={17} />
              {notice}
            </span>
            <button type="button" onClick={() => setNotice('')} aria-label="Dismiss notice" className="rounded p-1 hover:bg-green-100">
              <X size={16} />
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2.5 text-sm font-semibold transition ${
                activeTab === tab.id
                  ? 'bg-ledger-navy text-white shadow-sm'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-14 text-center text-sm text-slate-500">
            Loading your investment records...
          </div>
        ) : (
          <>
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-slate-500">Portfolio value</p>
                      <span className="rounded-xl bg-blue-50 p-2.5 text-ledger-navy"><Wallet size={20} /></span>
                    </div>
                    <p className="mt-4 text-2xl font-bold text-slate-800">{formatBDT(portfolioTotals.currentValue)}</p>
                    <p className="mt-2 text-xs text-slate-400">Latest valuation or book balance</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-slate-500">Remaining cost basis</p>
                      <span className="rounded-xl bg-indigo-50 p-2.5 text-indigo-700"><BriefcaseBusiness size={20} /></span>
                    </div>
                    <p className="mt-4 text-2xl font-bold text-slate-800">{formatBDT(portfolioTotals.remainingCost)}</p>
                    <p className="mt-2 text-xs text-slate-400">Current book cost of holdings</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-slate-500">Unrealized P/L</p>
                      <span className={`rounded-xl p-2.5 ${portfolioTotals.unrealized >= 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                        {portfolioTotals.unrealized >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
                      </span>
                    </div>
                    <p className={`mt-4 text-2xl font-bold ${portfolioTotals.unrealized >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                      {portfolioTotals.unrealized >= 0 ? '+' : ''}{formatBDT(portfolioTotals.unrealized)}
                    </p>
                    <p className="mt-2 text-xs text-slate-400">Based on latest manual valuations</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-slate-500">Income received</p>
                      <span className="rounded-xl bg-emerald-50 p-2.5 text-emerald-700"><CircleDollarSign size={20} /></span>
                    </div>
                    <p className="mt-4 text-2xl font-bold text-slate-800">{formatBDT(portfolioTotals.income)}</p>
                    <p className="mt-2 text-xs text-slate-400">Recorded interest and dividends</p>
                  </div>
                </div>

                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-bold text-slate-800">Your portfolio</h2>
                      <p className="mt-1 text-xs text-slate-500">
                        {activeInstruments.length} active investment record(s), including GPF.
                      </p>
                    </div>
                    <button type="button" onClick={() => setActiveTab('investments')} className="text-sm font-semibold text-ledger-navy hover:underline">
                      View all investments
                    </button>
                  </div>
                  {renderInstrumentCards(activeInstruments.slice(0, 6))}
                </section>

                <div className="grid gap-5 xl:grid-cols-2">
                  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <h2 className="font-bold text-slate-800">Portfolio allocation</h2>
                        <p className="mt-1 text-xs text-slate-500">Current value by investment type</p>
                      </div>
                      <span className="text-xs font-semibold text-slate-400">{allocationByType.length} categories</span>
                    </div>
                    {allocationByType.length === 0 ? (
                      <p className="py-6 text-center text-sm text-slate-500">Add investments to see your allocation.</p>
                    ) : (
                      <div className="space-y-4">
                        {allocationByType.map(item => {
                          const share = portfolioTotals.currentValue > 0
                            ? Math.max(0, item.value / portfolioTotals.currentValue * 100)
                            : 0

                          return (
                            <div key={item.type}>
                              <div className="mb-1.5 flex items-center justify-between gap-3">
                                <span className="text-sm font-medium text-slate-700">{instrumentTypeLabel(item.type)}</span>
                                <span className="text-right text-sm font-semibold text-slate-800">{formatBDT(item.value)} <span className="text-xs font-normal text-slate-400">({share.toFixed(1)}%)</span></span>
                              </div>
                              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                                <div className="h-full rounded-full" style={{ width: `${Math.min(100, share)}%`, backgroundColor: 'var(--ledger-accent)' }} />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <h2 className="font-bold text-slate-800">Maturity watch</h2>
                        <p className="mt-1 text-xs text-slate-500">Maturity dates within the next 90 days and recently passed dates</p>
                      </div>
                      <span className="rounded-xl bg-amber-50 p-2 text-amber-700"><CalendarDays size={18} /></span>
                    </div>
                    {upcomingMaturities.length === 0 ? (
                      <p className="py-6 text-center text-sm text-slate-500">No investment maturity dates in this window.</p>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {upcomingMaturities.map(({ instrument, days }) => (
                          <div key={instrument.id} className="flex items-center justify-between gap-3 py-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-700">{instrument.name}</p>
                              <p className="mt-0.5 text-xs text-slate-500">{instrument.institution || instrumentTypeLabel(instrument.instrument_type)} · {formatDate(instrument.maturity_date)}</p>
                            </div>
                            <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                              days < 0 ? 'bg-red-50 text-red-700' : days === 0 ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
                            }`}>
                              {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : `${days}d left`}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>

                <div className="grid gap-5 xl:grid-cols-2">
                  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-4 flex items-center justify-between">
                      <div>
                        <h2 className="font-bold text-slate-800">Recent investment activity</h2>
                        <p className="mt-1 text-xs text-slate-500">Latest posted investment records</p>
                      </div>
                      <button type="button" onClick={() => setActiveTab('history')} className="text-xs font-semibold text-ledger-navy hover:underline">See history</button>
                    </div>
                    {activityRows.length === 0 ? (
                      <p className="py-8 text-center text-sm text-slate-500">No investment activity recorded yet.</p>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {activityRows.slice(0, 6).map(activity => {
                          const instrument = instrumentById.get(activity.instrument_id)
                          return (
                            <div key={activity.id} className="flex items-center justify-between gap-3 py-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-700">{instrument?.name || 'Investment'}</p>
                                <p className="mt-1 text-xs text-slate-500">{activityTypeLabel(activity.activity_type)} · {formatDate(activity.activity_date)}</p>
                              </div>
                              <p className="shrink-0 text-sm font-semibold text-slate-800">{formatBDT(activity.amount_minor)}</p>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="font-bold text-slate-800">General Provident Fund</h2>
                        <p className="mt-1 text-xs text-slate-500">Your dedicated GPF calculator and contribution records</p>
                      </div>
                      <span className="rounded-xl bg-emerald-50 p-2.5 text-emerald-700"><ShieldCheck size={20} /></span>
                    </div>
                    {gpfProfile && gpfInstrument ? (
                      <>
                        <p className="mt-5 text-xs text-slate-500">Current ledger balance</p>
                        <p className="mt-1 text-2xl font-bold text-slate-800">{formatBDT(gpfCurrentBalance)}</p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button type="button" onClick={() => setActiveTab('gpf')} className="rounded-lg bg-ledger-navy px-3 py-2 text-xs font-semibold text-white">Open GPF Management</button>
                          <button type="button" onClick={() => openModal('gpfContribution')} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">Add contribution</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="mt-5 text-sm leading-6 text-slate-600">Set up your GPF opening balance and monthly contribution to start calculating annual interest and long-term projections.</p>
                        <button type="button" onClick={() => openModal('gpf')} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-ledger-navy px-3 py-2.5 text-xs font-semibold text-white"><Plus size={15} /> Set up GPF</button>
                      </>
                    )}
                  </section>
                </div>
              </div>
            )}

            {activeTab === 'investments' && (
              <div className="space-y-5">
                <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-slate-200 px-3">
                      <Search size={17} className="text-slate-400" />
                      <input
                        type="search"
                        value={searchTerm}
                        onChange={event => setSearchTerm(event.target.value)}
                        placeholder="Search investments..."
                        className="w-full bg-transparent py-3 text-sm outline-none"
                      />
                    </div>
                    <select
                      aria-label="Filter investment type"
                      value={investmentTypeFilter}
                      onChange={event => setInvestmentTypeFilter(event.target.value as InstrumentType | 'all')}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700"
                    >
                      <option value="all">All investment types</option>
                      {INSTRUMENT_TYPES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                      <option value="gpf">General Provident Fund</option>
                    </select>
                    <select
                      aria-label="Sort investments"
                      value={investmentSortMode}
                      onChange={event => setInvestmentSortMode(event.target.value as InvestmentSortMode)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700"
                    >
                      <option value="value_desc">Highest value</option>
                      <option value="name_asc">Name A–Z</option>
                      <option value="maturity_asc">Maturity date</option>
                      <option value="return_desc">Highest unrealized return (%)</option>
                    </select>
                    <div className="flex items-center rounded-xl border border-slate-200 p-1">
                      <button type="button" aria-label="Card view" aria-pressed={investmentViewMode === 'cards'} onClick={() => setInvestmentViewMode('cards')} className={`rounded-lg p-2 ${investmentViewMode === 'cards' ? 'bg-ledger-navy text-white' : 'text-slate-500 hover:bg-slate-100'}`}><Grid2X2 size={17} /></button>
                      <button type="button" aria-label="Table view" aria-pressed={investmentViewMode === 'table'} onClick={() => setInvestmentViewMode('table')} className={`rounded-lg p-2 ${investmentViewMode === 'table' ? 'bg-ledger-navy text-white' : 'text-slate-500 hover:bg-slate-100'}`}><Table2 size={17} /></button>
                    </div>
                    <button type="button" onClick={exportPortfolio} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Download size={16} /> Export</button>
                    <button type="button" onClick={() => openModal('investment')} className="inline-flex items-center gap-2 rounded-xl bg-ledger-navy px-4 py-3 text-sm font-semibold text-white"><Plus size={16} /> Add Investment</button>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setShowArchived(false)} className={`rounded-lg px-3 py-2 text-xs font-semibold ${!showArchived ? 'bg-ledger-navy text-white' : 'bg-slate-100 text-slate-600'}`}>Active ({activeInstruments.length})</button>
                      <button type="button" onClick={() => setShowArchived(true)} className={`rounded-lg px-3 py-2 text-xs font-semibold ${showArchived ? 'bg-ledger-navy text-white' : 'bg-slate-100 text-slate-600'}`}>Archived ({archivedInstruments.length})</button>
                    </div>
                    <p className="text-xs text-slate-400">{sortedVisibleInstruments.length} record(s) shown</p>
                  </div>
                </div>

                {investmentViewMode === 'cards'
                  ? renderInstrumentCards(sortedVisibleInstruments)
                  : renderInstrumentTable(sortedVisibleInstruments)}
              </div>
            )}

            {activeTab === 'gpf' && (
              <div className="space-y-6">
                {!gpfProfile || !gpfInstrument ? (
                  <section className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
                    <ShieldCheck className="mx-auto text-emerald-600" size={42} />
                    <h2 className="mt-4 text-xl font-bold text-slate-800">Set up your GPF account</h2>
                    <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
                      Create a GPF profile to record contributions, withdrawals and interest credits, and calculate the year-end balance using your supplied Excel workbook logic.
                    </p>
                    <button type="button" onClick={() => openModal('gpf')} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-ledger-navy px-5 py-3 text-sm font-semibold text-white"><Plus size={17} /> Create GPF Account</button>
                  </section>
                ) : (
                  <>
                    <section className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
                      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                        <div className="flex items-start gap-3">
                          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><ShieldCheck size={24} /></div>
                          <div>
                            <h2 className="text-lg font-bold text-slate-800">{gpfInstrument.name}</h2>
                            <p className="mt-1 text-sm text-slate-500">Financial year {gpfProfile.financial_year} · {gpfSchedule?.source_title || 'GPF interest schedule'}</p>
                            <p className="mt-1 text-xs text-slate-400">Year starts {formatDate(gpfProfile.financial_year_start)}</p>
                          </div>
                        </div>
                        <div className="md:text-right">
                          <p className="text-xs font-medium text-slate-500">Actual posted GPF balance</p>
                          <p className="mt-1 text-2xl font-bold text-emerald-700">{formatBDT(gpfCurrentBalance)}</p>
                        </div>
                      </div>
                      <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                        <button type="button" onClick={() => openModal('gpfContribution')} className="inline-flex items-center gap-2 rounded-lg bg-ledger-navy px-3 py-2.5 text-xs font-semibold text-white"><Plus size={15} /> Record Contribution</button>
                        <button type="button" onClick={() => openModal('gpfWithdrawal')} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"><ArrowUpRight size={15} /> Record Withdrawal</button>
                        <button type="button" onClick={() => openModal('gpfInterest')} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"><CircleDollarSign size={15} /> Credit Interest</button>
                      </div>
                    </section>

                    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h2 className="font-bold text-slate-800">GPF contribution & withdrawal statement</h2>
                          <p className="mt-1 text-xs text-slate-500">
                            Recorded ledger activity. Actual balance is separate from calculator projections.
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            aria-label="GPF activity period"
                            value={gpfHistoryPeriod}
                            onChange={event => setGpfHistoryPeriod(event.target.value as GpfHistoryPeriod)}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700"
                          >
                            <option value="current">Current FY ({gpfProfile.financial_year})</option>
                            <option value="previous">Previous FY</option>
                            <option value="all">All history</option>
                          </select>
                          <button
                            type="button"
                            onClick={exportGpfStatement}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <Download size={14} /> Export statement
                          </button>
                        </div>
                      </div>

                      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-xl bg-emerald-50 p-3">
                          <p className="text-xs font-medium text-emerald-700">Contributions</p>
                          <p className="mt-1 text-lg font-bold text-emerald-800">{formatBDT(gpfActivityTotals.contributions)}</p>
                        </div>
                        <div className="rounded-xl bg-rose-50 p-3">
                          <p className="text-xs font-medium text-rose-700">Withdrawals / advances</p>
                          <p className="mt-1 text-lg font-bold text-rose-800">{formatBDT(gpfActivityTotals.withdrawals)}</p>
                        </div>
                        <div className="rounded-xl bg-blue-50 p-3">
                          <p className="text-xs font-medium text-blue-700">Interest credited</p>
                          <p className="mt-1 text-lg font-bold text-blue-800">{formatBDT(gpfActivityTotals.interest)}</p>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-3">
                          <p className="text-xs font-medium text-slate-500">Actual posted balance</p>
                          <p className="mt-1 text-lg font-bold text-slate-800">{formatBDT(gpfCurrentBalance)}</p>
                        </div>
                      </div>

                      {gpfFilteredActivities.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                          No GPF activity found for this period.
                        </div>
                      ) : (
                        <>
                          <div className="overflow-x-auto rounded-xl border border-slate-100">
                            <table className="w-full min-w-[720px] text-left text-sm">
                              <thead className="bg-slate-50 text-xs text-slate-500">
                                <tr>
                                  <th className="px-4 py-3 font-semibold">Date</th>
                                  <th className="px-4 py-3 font-semibold">Activity</th>
                                  <th className="px-4 py-3 font-semibold">Funding</th>
                                  <th className="px-4 py-3 text-right font-semibold">Amount</th>
                                  <th className="px-4 py-3 font-semibold">Notes</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {gpfFilteredActivities.slice(0, 100).map(item => {
                                  const isOutflow = item.activity_type === 'withdrawal' || item.activity_type === 'fee'
                                  const isInflow = item.activity_type === 'contribution' || item.activity_type === 'interest'

                                  return (
                                    <tr key={item.id}>
                                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(item.activity_date)}</td>
                                      <td className="px-4 py-3">
                                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                          isOutflow ? 'bg-rose-50 text-rose-700' : isInflow ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                                        }`}>{activityTypeLabel(item.activity_type)}</span>
                                      </td>
                                      <td className="px-4 py-3 text-xs text-slate-500">
                                        {item.funding_mode === 'payroll_deduction' ? 'Payroll deduction' : item.funding_mode === 'account_transfer' ? 'Account transfer' : '—'}
                                      </td>
                                      <td className={`whitespace-nowrap px-4 py-3 text-right font-semibold ${
                                        isOutflow ? 'text-rose-700' : isInflow ? 'text-emerald-700' : 'text-slate-700'
                                      }`}>
                                        {isOutflow ? '−' : isInflow ? '+' : ''}{formatBDT(item.amount_minor)}
                                      </td>
                                      <td className="max-w-[240px] truncate px-4 py-3 text-xs text-slate-500">{item.notes || '—'}</td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                          {gpfFilteredActivities.length > 100 && (
                            <p className="mt-2 text-right text-xs text-slate-400">
                              Showing the latest 100 of {gpfFilteredActivities.length} records. Export the statement for the complete history.
                            </p>
                          )}
                        </>
                      )}
                    </section>

                    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
                      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h2 className="text-lg font-bold text-slate-800">GPF Calculator</h2>
                            <p className="mt-1 text-xs text-slate-500">Calculated using your Excel workbook's FY 2026–27 method.</p>
                          </div>
                          <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">Automatic rate by opening balance</span>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                          <Field label="Opening balance at previous 30 June (BDT)">
                            <input className={inputClass} inputMode="decimal" value={gpfInputs.openingBalance} onChange={event => setGpfInputs(p => ({ ...p, openingBalance: event.target.value }))} />
                          </Field>
                          <Field label="Monthly GPF contribution (BDT)">
                            <input className={inputClass} inputMode="decimal" value={gpfInputs.monthlyContribution} onChange={event => setGpfInputs(p => ({ ...p, monthlyContribution: event.target.value }))} />
                          </Field>
                          <Field label="Annual contribution increase (%)">
                            <input className={inputClass} type="number" min="0" max="100" step="0.01" value={gpfInputs.annualIncrease} onChange={event => setGpfInputs(p => ({ ...p, annualIncrease: event.target.value }))} />
                          </Field>
                          <Field label="Advance / withdrawal (BDT)">
                            <input className={inputClass} inputMode="decimal" value={gpfInputs.withdrawal} onChange={event => setGpfInputs(p => ({ ...p, withdrawal: event.target.value }))} />
                          </Field>
                          <Field label="Projection years (1–30)">
                            <input className={inputClass} type="number" min="1" max="30" step="1" value={gpfInputs.projectionYears} onChange={event => setGpfInputs(p => ({ ...p, projectionYears: event.target.value }))} />
                          </Field>
                        </div>

                        {projection.error && (
                          <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{projection.error}</div>
                        )}

                        {!projection.error && projection.rows.length > 0 && (
                          <>
                            <div className="mt-5 grid gap-3 sm:grid-cols-3">
                              <div className="rounded-xl bg-slate-50 p-4">
                                <p className="text-xs text-slate-500">First-year interest</p>
                                <p className="mt-1 text-lg font-bold text-slate-800">{formatBDTValue(projection.firstYearInterest)}</p>
                              </div>
                              <div className="rounded-xl bg-slate-50 p-4">
                                <p className="text-xs text-slate-500">Year-end balance</p>
                                <p className="mt-1 text-lg font-bold text-slate-800">{formatBDTValue(projection.rows[0].closingBalance)}</p>
                              </div>
                              <div className="rounded-xl bg-emerald-50 p-4">
                                <p className="text-xs text-emerald-700">Projected final balance</p>
                                <p className="mt-1 text-lg font-bold text-emerald-800">{formatBDTValue(projection.finalBalance)}</p>
                              </div>
                            </div>

                            <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200">
                              <table className="w-full min-w-[720px] text-left text-xs">
                                <thead className="bg-slate-50 text-slate-500">
                                  <tr>
                                    <th className="px-3 py-3 font-semibold">Year</th>
                                    <th className="px-3 py-3 text-right font-semibold">Opening balance</th>
                                    <th className="px-3 py-3 text-right font-semibold">Monthly GPF</th>
                                    <th className="px-3 py-3 text-right font-semibold">Rate</th>
                                    <th className="px-3 py-3 text-right font-semibold">Interest</th>
                                    <th className="px-3 py-3 text-right font-semibold">Withdrawal</th>
                                    <th className="px-3 py-3 text-right font-semibold">Closing balance</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {projection.rows.map(row => (
                                    <tr key={row.year} className="text-slate-700">
                                      <td className="px-3 py-3 font-semibold">{row.year}</td>
                                      <td className="px-3 py-3 text-right">{formatBDTValue(row.openingBalance)}</td>
                                      <td className="px-3 py-3 text-right">{formatBDTValue(row.monthlyContribution)}</td>
                                      <td className="px-3 py-3 text-right">{row.rate.toFixed(2)}%</td>
                                      <td className="px-3 py-3 text-right">{formatBDTValue(row.openingInterest + row.contributionInterest)}</td>
                                      <td className="px-3 py-3 text-right">{formatBDTValue(row.withdrawal)}</td>
                                      <td className="px-3 py-3 text-right font-bold">{formatBDTValue(row.closingBalance)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            <div className="mt-5 flex flex-wrap justify-end gap-2">
                              <button type="button" onClick={() => void saveGpfAssumptions()} disabled={saving} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Save calculator inputs</button>
                              <button type="button" onClick={() => void saveGpfSnapshot()} disabled={saving} className="rounded-xl bg-ledger-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50">Save calculation history</button>
                            </div>
                          </>
                        )}
                      </section>

                      <div className="space-y-5">
                        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <h2 className="font-bold text-slate-800">Government interest tiers</h2>
                              <p className="mt-1 text-xs text-slate-500">One rate applies to the whole opening balance.</p>
                            </div>
                            <button type="button" onClick={() => setShowRateEditor(value => !value)} className="text-xs font-semibold text-ledger-navy hover:underline">{showRateEditor ? 'Cancel' : 'Edit rates'}</button>
                          </div>
                          <div className="mt-4 space-y-3">
                            {gpfTiers.map(tier => {
                              const lower = Number(tier.lower_balance_minor) / 100
                              const upper = tier.upper_balance_minor === null ? null : Number(tier.upper_balance_minor) / 100
                              const band = tier.sort_order === 1
                                ? 'Up to ৳15 lakh'
                                : tier.sort_order === 2
                                  ? 'Above ৳15 lakh to ৳30 lakh'
                                  : 'Above ৳30 lakh'

                              return (
                                <div key={tier.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-3">
                                  <div>
                                    <p className="text-sm font-semibold text-slate-700">{band}</p>
                                    <p className="mt-1 text-[11px] text-slate-400">
                                      {formatBDTValue(lower)}{upper === null ? ' and above' : ` – ${formatBDTValue(upper)}`}
                                    </p>
                                  </div>
                                  {showRateEditor ? (
                                    <div className="flex items-center gap-1">
                                      <input
                                        aria-label={`Rate for ${band}`}
                                        className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-2 text-right text-sm font-bold"
                                        type="number"
                                        min="0.01"
                                        max="100"
                                        step="0.01"
                                        value={rateEdits[tier.id] ?? ''}
                                        onChange={event => setRateEdits(previous => ({ ...previous, [tier.id]: event.target.value }))}
                                      />
                                      <span className="text-sm font-semibold text-slate-500">%</span>
                                    </div>
                                  ) : (
                                    <p className="text-lg font-bold text-emerald-700">{(Number(tier.annual_rate_basis_points) / 100).toFixed(2)}%</p>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                          {showRateEditor && (
                            <button type="button" onClick={() => void saveRateChanges()} disabled={saving} className="mt-4 w-full rounded-xl bg-ledger-navy px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Save interest rates</button>
                          )}
                          <p className="mt-4 text-xs leading-5 text-slate-500">
                            Rates are stored by financial year. Updating this schedule affects future calculations, not saved historical snapshots.
                          </p>
                          {gpfSchedule?.source_reference && (
                            <a href={gpfSchedule.source_reference.split('; ')[1] || gpfSchedule.source_reference} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-xs font-semibold text-ledger-navy hover:underline">
                              View source circular
                            </a>
                          )}
                        </section>

                        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                          <h2 className="font-bold text-slate-800">Projection summary</h2>
                          <div className="mt-4 space-y-3 text-sm">
                            <div className="flex justify-between gap-3"><span className="text-slate-500">Total contributions</span><strong className="text-slate-800">{formatBDTValue(projection.totalContributions)}</strong></div>
                            <div className="flex justify-between gap-3"><span className="text-slate-500">Projected earnings</span><strong className="text-emerald-700">{formatBDTValue(projection.totalEarnings)}</strong></div>
                            <div className="flex justify-between gap-3"><span className="text-slate-500">Final balance</span><strong className="text-slate-800">{formatBDTValue(projection.finalBalance)}</strong></div>
                          </div>
                          <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                            Future years assume the current rate tiers continue. Actual government rates may change through new circulars.
                          </p>
                        </section>
                      </div>
                    </div>

                    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <h2 className="font-bold text-slate-800">Saved GPF calculations</h2>
                          <p className="mt-1 text-xs text-slate-500">Permanent snapshots of previous calculations</p>
                        </div>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{snapshots.length} saved</span>
                      </div>
                      {snapshots.filter(item => item.gpf_profile_id === gpfProfile.id).length === 0 ? (
                        <p className="py-6 text-center text-sm text-slate-500">No saved calculations yet.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[620px] text-left text-sm">
                            <thead className="border-b border-slate-100 text-xs text-slate-500">
                              <tr>
                                <th className="px-3 py-3 font-semibold">Date</th>
                                <th className="px-3 py-3 text-right font-semibold">Opening balance</th>
                                <th className="px-3 py-3 text-right font-semibold">Rate</th>
                                <th className="px-3 py-3 text-right font-semibold">Year-end balance</th>
                                <th className="px-3 py-3 text-right font-semibold">Final projection</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {snapshots.filter(item => item.gpf_profile_id === gpfProfile.id).map(snapshot => (
                                <tr key={snapshot.id}>
                                  <td className="px-3 py-3 text-slate-600">{formatDate(snapshot.calculation_date)}</td>
                                  <td className="px-3 py-3 text-right text-slate-700">{formatBDT(snapshot.opening_balance_minor)}</td>
                                  <td className="px-3 py-3 text-right text-slate-700">{(snapshot.annual_rate_basis_points / 100).toFixed(2)}%</td>
                                  <td className="px-3 py-3 text-right font-semibold text-slate-800">{formatBDT(snapshot.closing_balance_minor)}</td>
                                  <td className="px-3 py-3 text-right font-semibold text-emerald-700">{formatBDT(snapshot.final_projected_balance_minor)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  </>
                )}
              </div>
            )}

            {activeTab === 'history' && (
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 p-5">
                  <h2 className="text-lg font-bold text-slate-800">Investment activity history</h2>
                  <p className="mt-1 text-xs text-slate-500">Posted investment transactions, contributions, withdrawals, fees and income.</p>
                </div>
                {activities.length === 0 ? (
                  <div className="p-12 text-center text-sm text-slate-500">No investment activity has been recorded yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className="bg-slate-50 text-xs text-slate-500">
                        <tr>
                          <th className="px-5 py-3 font-semibold">Date</th>
                          <th className="px-5 py-3 font-semibold">Investment</th>
                          <th className="px-5 py-3 font-semibold">Activity</th>
                          <th className="px-5 py-3 text-right font-semibold">Amount</th>
                          <th className="px-5 py-3 text-right font-semibold">Units</th>
                          <th className="px-5 py-3 font-semibold">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {activities.map(activity => {
                          const instrument = instrumentById.get(activity.instrument_id)
                          return (
                            <tr key={activity.id}>
                              <td className="whitespace-nowrap px-5 py-3 text-slate-600">{formatDate(activity.activity_date)}</td>
                              <td className="px-5 py-3 font-medium text-slate-800">{instrument?.name || 'Investment'}</td>
                              <td className="px-5 py-3"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{activityTypeLabel(activity.activity_type)}</span></td>
                              <td className="whitespace-nowrap px-5 py-3 text-right font-semibold text-slate-800">{formatBDT(activity.amount_minor)}</td>
                              <td className="px-5 py-3 text-right text-slate-600">{activity.units === null ? '—' : Number(activity.units).toLocaleString('en-BD')}</td>
                              <td className="max-w-[220px] truncate px-5 py-3 text-slate-500">{activity.notes || '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>

      {renderModal()}
    </div>
  )
}
