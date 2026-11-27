import { supabase } from './supabase'
import type {
  OfflineAccount,
  OfflineCategory,
  OfflineGpfCalculationSnapshot,
  OfflineGpfProfile,
  OfflineGpfRateTier,
  OfflineInvestment,
  OfflineInvestmentActivity,
  OfflineInvestmentValuation,
  OfflineSnapshot,
  OfflineTransaction,
} from './offlineVault'

type AccountRow = {
  id: string
  name: string
  account_kind: 'financial' | 'category'
  account_type: 'asset' | 'liability' | 'equity' | 'income' | 'expense'
  subtype: string | null
  is_active: boolean
  include_in_net_worth: boolean
}

type EntryRow = {
  id: string
  entry_date: string
  transaction_type: string
  description: string | null
  payee: string | null
  notes: string | null
  status: string
  created_at: string
  tags: string[] | null
  transaction_group: string | null
}

type LineRow = {
  id?: string
  journal_entry_id: string
  ledger_account_id: string
  debit_minor: number | string
  credit_minor: number | string
}

type InstrumentRow = {
  id: string
  ledger_account_id: string
  name: string
  instrument_type: string
  institution: string | null
  ticker_symbol: string | null
  currency: string
  purchase_date: string | null
  maturity_date: string | null
  units: number | string | null
  unit_cost_minor: number | string | null
  notes: string | null
  is_active: boolean
}

type InvestmentActivityRow = {
  id: string
  instrument_id: string
  activity_type: string
  activity_date: string
  amount_minor: number | string
  units: number | string | null
  unit_price_minor: number | string | null
  fees_minor: number | string
  cost_basis_minor: number | string | null
  funding_mode: string | null
  counterparty_account_id: string | null
  counterparty_category_id: string | null
  notes: string | null
  created_at: string
}

type InvestmentValuationRow = {
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

type GpfProfileRow = {
  id: string
  instrument_id: string
  rate_schedule_id: string
  financial_year: string
  financial_year_start: string
  opening_balance_minor: number | string
  monthly_contribution_minor: number | string
  annual_contribution_increase_percent: number | string
  projection_years: number
}

type GpfRateScheduleRow = {
  id: string
  financial_year: string
  effective_from: string
  source_title: string | null
  source_date: string | null
  source_reference: string | null
}

type GpfRateTierRow = {
  id: string
  rate_schedule_id: string
  lower_balance_minor: number | string
  upper_balance_minor: number | string | null
  annual_rate_basis_points: number
  sort_order: number
}

type GpfCalculationSnapshotRow = {
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
  annual_contribution_increase_percent: number | string
  projection_years: number
  total_projected_contributions_minor: number | string
  final_projected_balance_minor: number | string
  total_projected_earnings_minor: number | string
  notes: string | null
  created_at: string
}

const PAGE_SIZE = 1000
const BATCH_SIZE = 250
const TRANSACTION_HISTORY_LIMIT = 1000
const GPF_SNAPSHOT_LIMIT = 100

async function fetchAllPages<T>(queryForPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await queryForPage(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    const page = data || []
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  return rows
}

async function fetchFinancialLines(userId: string, accountIds: string[]) {
  const rows: LineRow[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('journal_lines')
      .select('id, journal_entry_id, ledger_account_id, debit_minor, credit_minor')
      .eq('user_id', userId)
      .in('ledger_account_id', accountIds)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) throw error
    const page = (data || []) as LineRow[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  return rows
}

async function fetchPostedEntriesByIds(userId: string, entryIds: string[]) {
  const rows: EntryRow[] = []
  for (let offset = 0; offset < entryIds.length; offset += BATCH_SIZE) {
    const batch = entryIds.slice(offset, offset + BATCH_SIZE)
    const { data, error } = await supabase
      .from('journal_entries')
      .select('id, entry_date, transaction_type, description, payee, notes, status, created_at, tags, transaction_group')
      .eq('user_id', userId)
      .eq('status', 'posted')
      .in('id', batch)

    if (error) throw error
    rows.push(...((data || []) as EntryRow[]))
  }
  return rows
}

async function fetchLinesForEntries(userId: string, entryIds: string[]) {
  const rows: LineRow[] = []
  for (let offset = 0; offset < entryIds.length; offset += BATCH_SIZE) {
    const batch = entryIds.slice(offset, offset + BATCH_SIZE)
    for (let pageOffset = 0; ; pageOffset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('journal_lines')
        .select('journal_entry_id, ledger_account_id, debit_minor, credit_minor')
        .eq('user_id', userId)
        .in('journal_entry_id', batch)
        .order('journal_entry_id', { ascending: true })
        .range(pageOffset, pageOffset + PAGE_SIZE - 1)

      if (error) throw error
      const page = (data || []) as LineRow[]
      rows.push(...page)
      if (page.length < PAGE_SIZE) break
    }
  }
  return rows
}

export async function buildOfflineSnapshot(userId: string): Promise<OfflineSnapshot> {
  if (!navigator.onLine) throw new Error('Connect to the internet before synchronizing offline data.')

  const { data: accountData, error: accountError } = await supabase
    .from('ledger_accounts')
    .select('id, name, account_kind, account_type, subtype, is_active, include_in_net_worth')
    .eq('user_id', userId)
    .order('name', { ascending: true })

  if (accountError) throw accountError
  const accounts = (accountData || []) as AccountRow[]
  const financialAccounts = accounts.filter(account =>
    account.account_kind === 'financial' &&
    (account.account_type === 'asset' || account.account_type === 'liability')
  )
  const accountMap = new Map<string, AccountRow>(accounts.map(account => [account.id, account]))
  const financialAccountIds = financialAccounts.map(account => account.id)

  let financialLines: LineRow[] = []
  if (financialAccountIds.length) financialLines = await fetchFinancialLines(userId, financialAccountIds)

  const financialEntryIds = [...new Set(financialLines.map(line => line.journal_entry_id))]
  const postedEntries = await fetchPostedEntriesByIds(userId, financialEntryIds)
  const postedEntryIds = new Set(postedEntries.map(entry => entry.id))

  const balances: Record<string, number> = {}
  for (const account of financialAccounts) balances[account.id] = 0

  for (const line of financialLines) {
    if (!postedEntryIds.has(line.journal_entry_id)) continue
    const account = accountMap.get(line.ledger_account_id)
    if (!account) continue
    const debit = Number(line.debit_minor || 0)
    const credit = Number(line.credit_minor || 0)
    const movement = account.account_type === 'asset' ? debit - credit : credit - debit
    balances[account.id] = (balances[account.id] || 0) + movement
  }

  // Load investment and GPF records using explicit owner filters. All values
  // are copied into the already encrypted snapshot; none are written to cloud.
  const [instrumentRows, activityRows, valuationRows, profileRows, scheduleRows, tierRows, gpfSnapshotRows] = await Promise.all([
    fetchAllPages<InstrumentRow>((from, to) => supabase
      .from('investment_instruments')
      .select('id, ledger_account_id, name, instrument_type, institution, ticker_symbol, currency, purchase_date, maturity_date, units, unit_cost_minor, notes, is_active')
      .eq('user_id', userId)
      .order('name', { ascending: true })
      .range(from, to)),
    fetchAllPages<InvestmentActivityRow>((from, to) => supabase
      .from('investment_activities')
      .select('id, instrument_id, activity_type, activity_date, amount_minor, units, unit_price_minor, fees_minor, cost_basis_minor, funding_mode, counterparty_account_id, counterparty_category_id, notes, created_at')
      .eq('user_id', userId)
      .order('activity_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, to)),
    fetchAllPages<InvestmentValuationRow>((from, to) => supabase
      .from('investment_valuations')
      .select('id, instrument_id, valuation_date, market_value_minor, unit_price_minor, units, valuation_source, notes, created_at')
      .eq('user_id', userId)
      .order('valuation_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, to)),
    fetchAllPages<GpfProfileRow>((from, to) => supabase
      .from('gpf_profiles')
      .select('id, instrument_id, rate_schedule_id, financial_year, financial_year_start, opening_balance_minor, monthly_contribution_minor, annual_contribution_increase_percent, projection_years')
      .eq('user_id', userId)
      .order('financial_year_start', { ascending: false })
      .range(from, to)),
    fetchAllPages<GpfRateScheduleRow>((from, to) => supabase
      .from('gpf_rate_schedules')
      .select('id, financial_year, effective_from, source_title, source_date, source_reference')
      .eq('user_id', userId)
      .order('effective_from', { ascending: false })
      .range(from, to)),
    fetchAllPages<GpfRateTierRow>((from, to) => supabase
      .from('gpf_rate_tiers')
      .select('id, rate_schedule_id, lower_balance_minor, upper_balance_minor, annual_rate_basis_points, sort_order')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true })
      .range(from, to)),
    supabase
      .from('gpf_calculation_snapshots')
      .select('id, gpf_profile_id, financial_year, calculation_date, opening_balance_minor, monthly_contribution_minor, annual_rate_basis_points, opening_interest_minor, annual_contribution_minor, contribution_interest_minor, withdrawal_minor, closing_balance_minor, annual_contribution_increase_percent, projection_years, total_projected_contributions_minor, final_projected_balance_minor, total_projected_earnings_minor, notes, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(GPF_SNAPSHOT_LIMIT),
  ])

  if (gpfSnapshotRows.error) throw gpfSnapshotRows.error
  const gpfSnapshots = (gpfSnapshotRows.data || []) as GpfCalculationSnapshotRow[]

  const investmentAccountIds = new Set(instrumentRows.map(row => row.ledger_account_id))
  const includedAccounts = financialAccounts.filter(account => account.is_active && account.include_in_net_worth)
  const assetsMinor = includedAccounts
    .filter(account => account.account_type === 'asset')
    .reduce((sum, account) => sum + (balances[account.id] || 0), 0)
  const liabilitiesMinor = includedAccounts
    .filter(account => account.account_type === 'liability')
    .reduce((sum, account) => sum + (balances[account.id] || 0), 0)
  const availableBalanceMinor = financialAccounts
    .filter(account => account.is_active && account.account_type === 'asset' && !investmentAccountIds.has(account.id))
    .reduce((sum, account) => sum + (balances[account.id] || 0), 0)

  const { data: transactionData, error: transactionError } = await supabase
    .from('journal_entries')
    .select('id, entry_date, transaction_type, description, payee, notes, status, created_at, tags, transaction_group')
    .eq('user_id', userId)
    .eq('status', 'posted')
    .in('transaction_type', ['income', 'expense'])
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(TRANSACTION_HISTORY_LIMIT)

  if (transactionError) throw transactionError
  const transactionEntries = (transactionData || []) as EntryRow[]
  const transactionLines = await fetchLinesForEntries(userId, transactionEntries.map(entry => entry.id))
  const linesByEntry = new Map<string, LineRow[]>()
  for (const line of transactionLines) {
    const current = linesByEntry.get(line.journal_entry_id) || []
    current.push(line)
    linesByEntry.set(line.journal_entry_id, current)
  }

  const transactions: OfflineTransaction[] = transactionEntries.map(entry => {
    const lines = linesByEntry.get(entry.id) || []
    const categoryLines = lines.filter(line => accountMap.get(line.ledger_account_id)?.account_kind === 'category')
    const financialLine = lines.find(line => accountMap.get(line.ledger_account_id)?.account_kind === 'financial')
    const categoryNames = [...new Set(categoryLines
      .map(line => accountMap.get(line.ledger_account_id)?.name)
      .filter((name): name is string => Boolean(name)))]
    const amountMinor = categoryLines.reduce((sum, line) =>
      sum + Number(line.debit_minor || 0) + Number(line.credit_minor || 0), 0)
    const categoryId = categoryLines[0]?.ledger_account_id || ''
    const accountId = financialLine?.ledger_account_id || ''

    return {
      id: entry.id,
      date: entry.entry_date,
      type: entry.transaction_type === 'income' ? 'income' : 'expense',
      description: entry.description || (entry.transaction_type === 'income' ? 'Income' : 'Expense'),
      payee: entry.payee || '',
      notes: entry.notes || '',
      amountMinor,
      accountName: accountMap.get(accountId)?.name || 'Account unavailable',
      categoryName: categoryNames.join(', ') || 'Uncategorised',
      accountId,
      categoryId,
      tags: Array.isArray(entry.tags) ? entry.tags : [],
      groupName: entry.transaction_group || '',
    }
  })

  const offlineAccounts: OfflineAccount[] = financialAccounts.map(account => ({
    id: account.id,
    name: account.name,
    accountType: account.account_type as 'asset' | 'liability',
    subtype: account.subtype,
    isActive: account.is_active,
    includeInNetWorth: account.include_in_net_worth,
    balanceMinor: balances[account.id] || 0,
  }))

  const offlineCategories: OfflineCategory[] = accounts
    .filter(account =>
      account.account_kind === 'category' &&
      (account.account_type === 'income' || account.account_type === 'expense')
    )
    .map(account => ({
      id: account.id,
      name: account.name,
      type: account.account_type as 'income' | 'expense',
      isActive: account.is_active,
    }))

  const instrumentById = new Map<string, InstrumentRow>(instrumentRows.map(instrument => [instrument.id, instrument]))
  const latestValuationByInstrument = new Map<string, InvestmentValuationRow>()
  for (const valuation of valuationRows) {
    if (!latestValuationByInstrument.has(valuation.instrument_id)) {
      latestValuationByInstrument.set(valuation.instrument_id, valuation)
    }
  }

  const costBasisByInstrument: Record<string, number> = {}
  const realizedByInstrument: Record<string, number> = {}
  const incomeByInstrument: Record<string, number> = {}
  const activityCountByInstrument: Record<string, number> = {}

  for (const activity of activityRows) {
    const amount = Number(activity.amount_minor || 0)
    const costBasis = Number(activity.cost_basis_minor || 0)
    activityCountByInstrument[activity.instrument_id] = (activityCountByInstrument[activity.instrument_id] || 0) + 1

    if (activity.activity_type === 'purchase') {
      costBasisByInstrument[activity.instrument_id] =
        (costBasisByInstrument[activity.instrument_id] || 0) + (costBasis || amount)
    } else if (activity.activity_type === 'sale' || activity.activity_type === 'maturity') {
      costBasisByInstrument[activity.instrument_id] =
        (costBasisByInstrument[activity.instrument_id] || 0) - costBasis
      realizedByInstrument[activity.instrument_id] =
        (realizedByInstrument[activity.instrument_id] || 0) + amount - costBasis - Number(activity.fees_minor || 0)
    } else if (activity.activity_type === 'dividend' || activity.activity_type === 'interest') {
      incomeByInstrument[activity.instrument_id] =
        (incomeByInstrument[activity.instrument_id] || 0) + amount
    }
  }

  const offlineInvestmentActivities: OfflineInvestmentActivity[] = activityRows.map(activity => ({
    id: activity.id,
    instrumentId: activity.instrument_id,
    instrumentName: instrumentById.get(activity.instrument_id)?.name || 'Investment unavailable',
    activityType: activity.activity_type,
    date: activity.activity_date,
    amountMinor: Number(activity.amount_minor || 0),
    units: activity.units === null ? null : Number(activity.units),
    unitPriceMinor: activity.unit_price_minor === null ? null : Number(activity.unit_price_minor),
    feesMinor: Number(activity.fees_minor || 0),
    costBasisMinor: activity.cost_basis_minor === null ? null : Number(activity.cost_basis_minor),
    fundingMode: activity.funding_mode,
    counterpartyAccountName: activity.counterparty_account_id ? accountMap.get(activity.counterparty_account_id)?.name || 'Account unavailable' : '',
    counterpartyCategoryName: activity.counterparty_category_id ? accountMap.get(activity.counterparty_category_id)?.name || 'Category unavailable' : '',
    notes: activity.notes || '',
    createdAt: activity.created_at,
  }))

  const offlineInvestmentValuations: OfflineInvestmentValuation[] = valuationRows.map(valuation => ({
    id: valuation.id,
    instrumentId: valuation.instrument_id,
    date: valuation.valuation_date,
    marketValueMinor: Number(valuation.market_value_minor || 0),
    unitPriceMinor: valuation.unit_price_minor === null ? null : Number(valuation.unit_price_minor),
    units: valuation.units === null ? null : Number(valuation.units),
    source: valuation.valuation_source,
    notes: valuation.notes || '',
    createdAt: valuation.created_at,
  }))

  const offlineInvestments: OfflineInvestment[] = instrumentRows.map(instrument => {
    const bookValueMinor = balances[instrument.ledger_account_id] || 0
    const latestValuation = latestValuationByInstrument.get(instrument.id)
    const currentValueMinor = instrument.instrument_type === 'gpf'
      ? bookValueMinor
      : latestValuation ? Number(latestValuation.market_value_minor) : bookValueMinor
    const costBasisMinor = instrument.instrument_type === 'gpf'
      ? bookValueMinor
      : Math.max(0, costBasisByInstrument[instrument.id] || 0)

    return {
      id: instrument.id,
      ledgerAccountId: instrument.ledger_account_id,
      name: instrument.name,
      instrumentType: instrument.instrument_type,
      institution: instrument.institution || '',
      tickerSymbol: instrument.ticker_symbol || '',
      currency: instrument.currency,
      purchaseDate: instrument.purchase_date,
      maturityDate: instrument.maturity_date,
      units: instrument.units === null ? null : Number(instrument.units),
      unitCostMinor: instrument.unit_cost_minor === null ? null : Number(instrument.unit_cost_minor),
      notes: instrument.notes || '',
      isActive: instrument.is_active,
      accountName: accountMap.get(instrument.ledger_account_id)?.name || 'Investment account unavailable',
      bookValueMinor,
      currentValueMinor,
      costBasisMinor,
      unrealizedResultMinor: instrument.instrument_type === 'gpf' ? 0 : currentValueMinor - costBasisMinor,
      realizedResultMinor: realizedByInstrument[instrument.id] || 0,
      incomeMinor: incomeByInstrument[instrument.id] || 0,
      latestValuationDate: latestValuation?.valuation_date || null,
      latestValuationSource: latestValuation?.valuation_source || null,
      activityCount: activityCountByInstrument[instrument.id] || 0,
    }
  })

  const schedulesById = new Map<string, GpfRateScheduleRow>(scheduleRows.map(schedule => [schedule.id, schedule]))
  const tiersBySchedule = new Map<string, OfflineGpfRateTier[]>()
  for (const tier of tierRows) {
    const current = tiersBySchedule.get(tier.rate_schedule_id) || []
    current.push({
      id: tier.id,
      lowerBalanceMinor: Number(tier.lower_balance_minor),
      upperBalanceMinor: tier.upper_balance_minor === null ? null : Number(tier.upper_balance_minor),
      annualRateBasisPoints: Number(tier.annual_rate_basis_points),
      sortOrder: Number(tier.sort_order),
    })
    tiersBySchedule.set(tier.rate_schedule_id, current)
  }

  const gpfProfiles: OfflineGpfProfile[] = profileRows.map(profile => {
    const instrument = instrumentById.get(profile.instrument_id)
    const schedule = schedulesById.get(profile.rate_schedule_id)
    return {
      id: profile.id,
      instrumentId: profile.instrument_id,
      instrumentName: instrument?.name || 'GPF account unavailable',
      financialYear: profile.financial_year,
      financialYearStart: profile.financial_year_start,
      openingBalanceMinor: Number(profile.opening_balance_minor),
      monthlyContributionMinor: Number(profile.monthly_contribution_minor),
      annualContributionIncreasePercent: Number(profile.annual_contribution_increase_percent),
      projectionYears: Number(profile.projection_years),
      currentBalanceMinor: instrument ? balances[instrument.ledger_account_id] || 0 : 0,
      rateSchedule: schedule ? {
        financialYear: schedule.financial_year,
        effectiveFrom: schedule.effective_from,
        sourceTitle: schedule.source_title || '',
        sourceDate: schedule.source_date,
        sourceReference: schedule.source_reference || '',
      } : null,
      rateTiers: tiersBySchedule.get(profile.rate_schedule_id) || [],
    }
  })

  const offlineGpfCalculationSnapshots: OfflineGpfCalculationSnapshot[] = gpfSnapshots.map(snapshot => ({
    id: snapshot.id,
    profileId: snapshot.gpf_profile_id,
    financialYear: snapshot.financial_year,
    calculationDate: snapshot.calculation_date,
    openingBalanceMinor: Number(snapshot.opening_balance_minor),
    monthlyContributionMinor: Number(snapshot.monthly_contribution_minor),
    annualRateBasisPoints: Number(snapshot.annual_rate_basis_points),
    openingInterestMinor: Number(snapshot.opening_interest_minor),
    annualContributionMinor: Number(snapshot.annual_contribution_minor),
    contributionInterestMinor: Number(snapshot.contribution_interest_minor),
    withdrawalMinor: Number(snapshot.withdrawal_minor),
    closingBalanceMinor: Number(snapshot.closing_balance_minor),
    annualContributionIncreasePercent: Number(snapshot.annual_contribution_increase_percent),
    projectionYears: Number(snapshot.projection_years),
    totalProjectedContributionsMinor: Number(snapshot.total_projected_contributions_minor),
    finalProjectedBalanceMinor: Number(snapshot.final_projected_balance_minor),
    totalProjectedEarningsMinor: Number(snapshot.total_projected_earnings_minor),
    notes: snapshot.notes || '',
    createdAt: snapshot.created_at,
  }))

  return {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    accounts: offlineAccounts,
    categories: offlineCategories,
    transactions,
    pendingTransactions: [],
    summary: {
      assetsMinor,
      liabilitiesMinor,
      netWorthMinor: assetsMinor - liabilitiesMinor,
      availableBalanceMinor,
    },
    transactionLimit: TRANSACTION_HISTORY_LIMIT,
    investments: offlineInvestments,
    investmentActivities: offlineInvestmentActivities,
    investmentValuations: offlineInvestmentValuations,
    gpfProfiles,
    gpfCalculationSnapshots: offlineGpfCalculationSnapshots,
  }
}
