import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'
import {
  Archive,
  Building2,
  CheckCircle2,
  CreditCard,
  Download,
  FileSpreadsheet,
  Printer,
  Eye,
  FileText,
  Landmark,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Smartphone,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'

import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatBDTMinor, formatLedgerDate } from '../lib/preferences'
import { useSearchParams } from 'react-router-dom'
import * as XLSX from 'xlsx'

type AccountType = 'asset' | 'liability'
type AccountSubtype =
  | 'bank'
  | 'cash'
  | 'mobile_wallet'
  | 'savings'
  | 'current'
  | 'credit_card'
  | 'personal_loan'
  | 'other'

type LedgerAccount = {
  id: string
  name: string
  account_kind: 'financial' | 'category'
  account_type: AccountType | 'equity' | 'income' | 'expense'
  subtype: string | null
  parent_id: string | null
  is_active: boolean
  include_in_net_worth: boolean
  created_at: string
  updated_at: string
}

type JournalLine = {
  id: string
  journal_entry_id: string
  ledger_account_id: string
  debit_minor: number | string
  credit_minor: number | string
  description: string | null
  created_at: string
}

type JournalEntry = {
  id: string
  entry_date: string
  transaction_type: string
  description: string | null
  payee: string | null
  notes: string | null
  status: string
  posted_at: string | null
  created_at: string
}

type AccountActivity = {
  id: string
  accountId: string
  entryId: string
  date: string
  createdAt: string
  transactionType: string
  description: string
  notes: string
  debitMinor: number
  creditMinor: number
  movementMinor: number
}

type AccountForm = {
  name: string
  accountType: AccountType
  subtype: AccountSubtype
  openingBalance: string
  includeInNetWorth: boolean
}

const PAGE_SIZE = 1000
const BATCH_SIZE = 300

const ASSET_SUBTYPES: { value: AccountSubtype; label: string }[] = [
  { value: 'bank', label: 'Bank Account' },
  { value: 'mobile_wallet', label: 'Mobile Wallet' },
  { value: 'cash', label: 'Cash' },
  { value: 'savings', label: 'Savings Account' },
  { value: 'current', label: 'Current Account' },
  { value: 'other', label: 'Other Asset' },
]

const LIABILITY_SUBTYPES: { value: AccountSubtype; label: string }[] = [
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'personal_loan', label: 'Personal Loan' },
  { value: 'other', label: 'Other Liability' },
]

const EMPTY_FORM: AccountForm = {
  name: '',
  accountType: 'asset',
  subtype: 'bank',
  openingBalance: '0.00',
  includeInNetWorth: true,
}

function formatBDT(minor: number) {
  return formatBDTMinor(minor)
}

function parseMoneyToMinor(value: string): number | null {
  const cleaned = value.trim() || '0'

  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return null
  }

  const [whole, fraction = ''] = cleaned.split('.')
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))

  if (!Number.isSafeInteger(minor) || minor < 0) {
    return null
  }

  return minor
}

function formatDate(value: string) {
  return formatLedgerDate(value)
}

function subtypeLabel(subtype: string | null) {
  const all = [...ASSET_SUBTYPES, ...LIABILITY_SUBTYPES]
  return all.find(item => item.value === subtype)?.label || 'Other'
}

function transactionTypeLabel(value: string) {
  return value
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function AccountIcon({ subtype }: { subtype: string | null }) {
  const value = (subtype || '').toLowerCase()

  if (value === 'mobile_wallet') return <Smartphone size={21} />
  if (value === 'cash') return <Wallet size={21} />
  if (value === 'credit_card') return <CreditCard size={21} />
  if (value === 'personal_loan') return <FileText size={21} />
  if (value === 'bank' || value === 'savings' || value === 'current') {
    return <Landmark size={21} />
  }

  return <Building2 size={21} />
}

const ACCOUNT_COLOR_TONES = ['blue', 'teal', 'violet', 'amber', 'rose', 'cyan'] as const

function accountColorTone(account: LedgerAccount) {
  if (account.account_type === 'liability') {
    return account.subtype === 'credit_card' ? 'rose' : 'amber'
  }

  // A stable hash gives each account a consistent, restrained accent colour.
  const key = `${account.subtype || 'other'}:${account.name.toLowerCase()}`
  let hash = 0
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0
  }
  return ACCOUNT_COLOR_TONES[Math.abs(hash) % ACCOUNT_COLOR_TONES.length]
}

export default function Accounts() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  const [accounts, setAccounts] = useState<LedgerAccount[]>([])
  const [journalLines, setJournalLines] = useState<JournalLine[]>([])
  const [activities, setActivities] = useState<AccountActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pageError, setPageError] = useState('')
  const [notice, setNotice] = useState('')

  const [showArchived, setShowArchived] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | AccountType>('all')
  const [actionMenuId, setActionMenuId] = useState<string | null>(null)

  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null)
  const [editingAccount, setEditingAccount] = useState<LedgerAccount | null>(null)
  const [form, setForm] = useState<AccountForm>(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<LedgerAccount | null>(null)

  const [statementAccount, setStatementAccount] = useState<LedgerAccount | null>(null)
  const [statementSearch, setStatementSearch] = useState('')
  const [statementFrom, setStatementFrom] = useState('')
  const [statementTo, setStatementTo] = useState('')

  const loadData = useCallback(async () => {
    if (!user?.id) {
      setAccounts([])
      setJournalLines([])
      setActivities([])
      setLoading(false)
      return
    }

    setLoading(true)
    setPageError('')

    try {
      const { data: accountData, error: accountError } = await supabase
        .from('ledger_accounts')
        .select(
          'id, name, account_kind, account_type, subtype, parent_id, is_active, include_in_net_worth, created_at, updated_at'
        )
        .eq('account_kind', 'financial')
        .in('account_type', ['asset', 'liability'])
        .order('created_at', { ascending: false })

      if (accountError) throw accountError

      const accountRows = (accountData || []) as LedgerAccount[]
      setAccounts(accountRows)

      if (accountRows.length === 0) {
        setJournalLines([])
        setActivities([])
        return
      }

      const accountIds = accountRows.map(account => account.id)
      const lineRows: JournalLine[] = []

      // Read every journal line for the user's financial accounts in pages.
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await supabase
          .from('journal_lines')
          .select(
            'id, journal_entry_id, ledger_account_id, debit_minor, credit_minor, description, created_at'
          )
          .in('ledger_account_id', accountIds)
          .order('created_at', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1)

        if (error) throw error

        const page = (data || []) as JournalLine[]
        lineRows.push(...page)

        if (page.length < PAGE_SIZE) break
      }

      setJournalLines(lineRows)

      const entryIds = [...new Set(lineRows.map(line => line.journal_entry_id))]
      const entryMap = new Map<string, JournalEntry>()

      // Fetch posted journal entries in batches. Draft lines do not affect balances.
      for (let offset = 0; offset < entryIds.length; offset += BATCH_SIZE) {
        const batch = entryIds.slice(offset, offset + BATCH_SIZE)

        const { data, error } = await supabase
          .from('journal_entries')
          .select(
            'id, entry_date, transaction_type, description, payee, notes, status, posted_at, created_at'
          )
          .in('id', batch)
          .eq('status', 'posted')

        if (error) throw error

        for (const entry of (data || []) as JournalEntry[]) {
          entryMap.set(entry.id, entry)
        }
      }

      const accountMap = new Map(
        accountRows.map(account => [account.id, account])
      )

      const nextActivities: AccountActivity[] = []

      for (const line of lineRows) {
        const entry = entryMap.get(line.journal_entry_id)
        const account = accountMap.get(line.ledger_account_id)

        if (!entry || !account) continue

        const debit = Number(line.debit_minor)
        const credit = Number(line.credit_minor)

        // Debit increases an asset; credit increases a liability.
        const movement =
          account.account_type === 'asset'
            ? debit - credit
            : credit - debit

        nextActivities.push({
          id: line.id,
          accountId: account.id,
          entryId: entry.id,
          date: entry.entry_date,
          createdAt: entry.created_at,
          transactionType: entry.transaction_type,
          description:
            entry.description ||
            line.description ||
            entry.payee ||
            transactionTypeLabel(entry.transaction_type),
          notes: entry.notes || '',
          debitMinor: debit,
          creditMinor: credit,
          movementMinor: movement,
        })
      }

      setActivities(nextActivities)
    } catch (err) {
      console.error('Accounts loading error:', err)
      setPageError(
        err instanceof Error ? err.message : 'Unable to load your accounts.'
      )
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const balances = useMemo(() => {
    const result: Record<string, number> = {}

    for (const account of accounts) {
      result[account.id] = 0
    }

    for (const activity of activities) {
      result[activity.accountId] =
        (result[activity.accountId] || 0) + activity.movementMinor
    }

    return result
  }, [accounts, activities])

  const historyAccountIds = useMemo(
    () => new Set(journalLines.map(line => line.ledger_account_id)),
    [journalLines]
  )

  const activityCountByAccount = useMemo(() => {
    const result: Record<string, number> = {}

    for (const activity of activities) {
      result[activity.accountId] = (result[activity.accountId] || 0) + 1
    }

    return result
  }, [activities])

  const activeAccounts = accounts.filter(account => account.is_active)
  const archivedAccounts = accounts.filter(account => !account.is_active)

  const visibleAccounts = (showArchived ? archivedAccounts : activeAccounts)
    .filter(account => typeFilter === 'all' || account.account_type === typeFilter)
    .filter(account => {
      const searchable = `${account.name} ${account.subtype || ''} ${account.account_type}`
        .toLowerCase()
      return searchable.includes(searchTerm.toLowerCase())
    })

  const totals = useMemo(() => {
    const includedAccounts = activeAccounts.filter(
      account => account.include_in_net_worth
    )

    const assets = includedAccounts
      .filter(account => account.account_type === 'asset')
      .reduce((sum, account) => sum + (balances[account.id] || 0), 0)

    const liabilities = includedAccounts
      .filter(account => account.account_type === 'liability')
      .reduce((sum, account) => sum + (balances[account.id] || 0), 0)

    return {
      assets,
      liabilities,
      netPosition: assets - liabilities,
    }
  }, [activeAccounts, balances])

  const startCreate = () => {
    setEditingAccount(null)
    setForm(EMPTY_FORM)
    setFormError('')
    setPageError('')
    setNotice('')
    setFormMode('create')
  }

  useEffect(() => {
    const requestedSearch = searchParams.get('search')
    const requestedNew = searchParams.get('new') === 'account'

    if (requestedSearch !== null) setSearchTerm(requestedSearch)
    if (requestedNew) startCreate()
    if (requestedSearch !== null || requestedNew) {
      setSearchParams({}, { replace: true })
    }
    // Search and create query parameters are one-time navigation commands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams])

  const startEdit = (account: LedgerAccount) => {
    setEditingAccount(account)
    setForm({
      name: account.name,
      accountType: account.account_type as AccountType,
      subtype: (account.subtype || 'other') as AccountSubtype,
      openingBalance: '0.00',
      includeInNetWorth: account.include_in_net_worth,
    })
    setFormError('')
    setPageError('')
    setNotice('')
    setActionMenuId(null)
    setFormMode('edit')
  }

  const closeForm = () => {
    if (saving) return
    setFormMode(null)
    setEditingAccount(null)
    setFormError('')
  }

  const handleSaveAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError('')

    const name = form.name.trim()

    if (!name) {
      setFormError('Please enter an account name.')
      return
    }

    setSaving(true)

    try {
      if (formMode === 'create') {
        const openingMinor = parseMoneyToMinor(form.openingBalance)

        if (openingMinor === null) {
          setFormError('Enter a valid opening balance with up to two decimal places.')
          setSaving(false)
          return
        }

        const { error } = await supabase.rpc('create_financial_account', {
          p_name: name,
          p_account_type: form.accountType,
          p_subtype: form.subtype,
          p_opening_balance_minor: openingMinor,
        })

        if (error) throw error

        setNotice(`${name} was created successfully.`)
      } else if (formMode === 'edit' && editingAccount) {
        const { error } = await supabase
          .from('ledger_accounts')
          .update({
            name,
            subtype: form.subtype,
            include_in_net_worth: form.includeInNetWorth,
          })
          .eq('id', editingAccount.id)
          .eq('account_kind', 'financial')

        if (error) throw error

        setNotice(`${name} was updated successfully.`)
      }

      setFormMode(null)
      setEditingAccount(null)
      await loadData()
    } catch (err) {
      console.error('Account save error:', err)
      setFormError(
        err instanceof Error ? err.message : 'Unable to save this account.'
      )
    } finally {
      setSaving(false)
    }
  }

  const handleArchive = async (account: LedgerAccount) => {
    const confirmed = window.confirm(
      `Archive "${account.name}"? It will remain in your records but won't be available for new transactions or transfers.`
    )

    if (!confirmed) return

    setSaving(true)
    setPageError('')
    setNotice('')
    setActionMenuId(null)

    try {
      const { error } = await supabase
        .from('ledger_accounts')
        .update({ is_active: false })
        .eq('id', account.id)
        .eq('account_kind', 'financial')

      if (error) throw error

      setNotice(`${account.name} has been archived.`)
      await loadData()
    } catch (err) {
      console.error('Account archive error:', err)
      setPageError(
        err instanceof Error ? err.message : 'Unable to archive this account.'
      )
    } finally {
      setSaving(false)
    }
  }

  const handleRestore = async (account: LedgerAccount) => {
    setSaving(true)
    setPageError('')
    setNotice('')
    setActionMenuId(null)

    try {
      const { error } = await supabase
        .from('ledger_accounts')
        .update({ is_active: true })
        .eq('id', account.id)
        .eq('account_kind', 'financial')

      if (error) throw error

      setNotice(`${account.name} has been restored.`)
      await loadData()
    } catch (err) {
      console.error('Account restore error:', err)
      setPageError(
        err instanceof Error ? err.message : 'Unable to restore this account.'
      )
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (!deleteTarget) return

    const account = deleteTarget
    setSaving(true)
    setPageError('')
    setNotice('')

    try {
      // Never delete an account that has journal history.
      const { data: lineData, error: lineError } = await supabase
        .from('journal_lines')
        .select('id')
        .eq('ledger_account_id', account.id)
        .limit(1)

      if (lineError) throw lineError

      if ((lineData || []).length > 0) {
        throw new Error(
          'This account has financial history and cannot be deleted. Archive it instead.'
        )
      }

      // Also protect accounts that are referenced as a parent.
      const { data: childData, error: childError } = await supabase
        .from('ledger_accounts')
        .select('id')
        .eq('parent_id', account.id)
        .limit(1)

      if (childError) throw childError

      if ((childData || []).length > 0) {
        throw new Error(
          'This account contains subaccounts and cannot be deleted.'
        )
      }

      const { error: deleteError } = await supabase
        .from('ledger_accounts')
        .delete()
        .eq('id', account.id)
        .eq('account_kind', 'financial')

      if (deleteError) throw deleteError

      setDeleteTarget(null)
      setNotice(`${account.name} was permanently deleted.`)
      await loadData()
    } catch (err) {
      console.error('Account deletion error:', err)
      setPageError(
        err instanceof Error ? err.message : 'Unable to delete this account.'
      )
      setDeleteTarget(null)
    } finally {
      setSaving(false)
    }
  }

  const openStatement = (account: LedgerAccount) => {
    setStatementAccount(account)
    setStatementSearch('')
    setStatementFrom('')
    setStatementTo('')
    setActionMenuId(null)
  }

  const statementRows = useMemo(() => {
    if (!statementAccount) return []

    const accountActivities = activities
      .filter(activity => activity.accountId === statementAccount.id)
      .sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date)
        if (dateCompare !== 0) return dateCompare

        const createdCompare = a.createdAt.localeCompare(b.createdAt)
        if (createdCompare !== 0) return createdCompare

        return a.id.localeCompare(b.id)
      })

    let runningBalance = 0

    return accountActivities.map(activity => {
      runningBalance += activity.movementMinor

      return {
        ...activity,
        runningBalance,
        increaseMinor: Math.max(activity.movementMinor, 0),
        decreaseMinor: Math.max(-activity.movementMinor, 0),
      }
    })
  }, [activities, statementAccount])

  const dateFilteredStatementRows = useMemo(
    () => statementRows.filter(row =>
      (!statementFrom || row.date >= statementFrom) &&
      (!statementTo || row.date <= statementTo)
    ),
    [statementRows, statementFrom, statementTo]
  )

  const filteredStatementRows = dateFilteredStatementRows.filter(row =>
    `${row.description} ${row.transactionType} ${row.notes}`
      .toLowerCase()
      .includes(statementSearch.trim().toLowerCase())
  )

  const statementOpeningBalance = useMemo(() => {
    if (!statementFrom) return 0
    const previousRows = statementRows.filter(row => row.date < statementFrom)
    return previousRows.length ? previousRows[previousRows.length - 1].runningBalance : 0
  }, [statementRows, statementFrom])

  const statementClosingBalance = useMemo(() => {
    const eligibleRows = statementRows.filter(row => !statementTo || row.date <= statementTo)
    return eligibleRows.length
      ? eligibleRows[eligibleRows.length - 1].runningBalance
      : statementOpeningBalance
  }, [statementRows, statementTo, statementOpeningBalance])

  const statementPeriodMovement = dateFilteredStatementRows.reduce(
    (total, row) => total + row.movementMinor,
    0
  )

  const exportStatement = (format: 'xlsx' | 'csv') => {
    if (!statementAccount) return

    const exportRows = filteredStatementRows.map(row => ({
      Date: row.date,
      Description: row.description,
      Type: transactionTypeLabel(row.transactionType),
      Notes: row.notes,
      Increase: row.increaseMinor / 100,
      Decrease: row.decreaseMinor / 100,
      'Running balance': row.runningBalance / 100,
    }))

    const summaryRows = [
      { Item: 'Account', Value: statementAccount.name },
      { Item: 'Period from', Value: statementFrom || 'All history' },
      { Item: 'Period to', Value: statementTo || 'Current' },
      { Item: 'Opening balance', Value: statementOpeningBalance / 100 },
      { Item: 'Period movement', Value: statementPeriodMovement / 100 },
      { Item: 'Closing balance', Value: statementClosingBalance / 100 },
    ]

    const workbook = XLSX.utils.book_new()
    const summarySheet = XLSX.utils.json_to_sheet(summaryRows)
    const activitySheet = XLSX.utils.json_to_sheet(exportRows)
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Statement Summary')
    XLSX.utils.book_append_sheet(workbook, activitySheet, 'Transactions')

    const safeName = statementAccount.name.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 50) || 'Account'
    const period = `${statementFrom || 'all'}_${statementTo || 'current'}`
    if (format === 'xlsx') {
      XLSX.writeFile(workbook, `Ledger_${safeName}_Statement_${period}.xlsx`)
    } else {
      const csv = XLSX.utils.sheet_to_csv(activitySheet)
      const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Ledger_${safeName}_Statement_${period}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }

  const printStatement = () => {
    if (!statementAccount) return

    const escapeHtml = (value: string) => value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')

    const rows = filteredStatementRows.map(row => `
      <tr>
        <td>${escapeHtml(formatDate(row.date))}</td>
        <td>${escapeHtml(row.description)}</td>
        <td>${escapeHtml(transactionTypeLabel(row.transactionType))}</td>
        <td class="num">${row.increaseMinor ? escapeHtml(formatBDT(row.increaseMinor)) : '—'}</td>
        <td class="num">${row.decreaseMinor ? escapeHtml(formatBDT(row.decreaseMinor)) : '—'}</td>
        <td class="num">${escapeHtml(formatBDT(row.runningBalance))}</td>
      </tr>
    `).join('')

    const printWindow = window.open('', '_blank', 'width=1100,height=800')
    if (!printWindow) {
      setPageError('Your browser blocked the print window. Allow pop-ups for Ledger and try again.')
      return
    }

    printWindow.document.open()
    printWindow.document.write(`<!doctype html>
      <html><head><title>${escapeHtml(statementAccount.name)} — Account Statement</title>
      <style>
        body{font-family:Arial,sans-serif;color:#172b45;padding:28px}
        h1{font-size:22px;margin:0 0 5px}p{color:#64748b;font-size:12px;margin:4px 0}
        .summary{display:flex;gap:24px;margin:20px 0;padding:14px;background:#f5f7fb;border:1px solid #e2e8f0}
        .summary span{display:block;color:#64748b;font-size:10px;text-transform:uppercase}
        .summary strong{display:block;margin-top:5px;font-size:14px}
        table{width:100%;border-collapse:collapse;margin-top:18px;font-size:11px}
        th,td{padding:9px 7px;border-bottom:1px solid #e2e8f0;text-align:left}
        th{background:#f5f7fb;text-transform:uppercase;font-size:9px;color:#64748b}
        .num{text-align:right;white-space:nowrap}
        @media print{body{padding:0}.summary{break-inside:avoid}}
      </style></head><body>
      <h1>${escapeHtml(statementAccount.name)} — Account Statement</h1>
      <p>${escapeHtml(subtypeLabel(statementAccount.subtype))} · ${escapeHtml(statementAccount.account_type)}</p>
      <p>Period: ${escapeHtml(statementFrom || 'All history')} to ${escapeHtml(statementTo || 'Current')}</p>
      <div class="summary">
        <div><span>Opening balance</span><strong>${escapeHtml(formatBDT(statementOpeningBalance))}</strong></div>
        <div><span>Period movement</span><strong>${escapeHtml(formatBDT(statementPeriodMovement))}</strong></div>
        <div><span>Closing balance</span><strong>${escapeHtml(formatBDT(statementClosingBalance))}</strong></div>
      </div>
      <table><thead><tr><th>Date</th><th>Description</th><th>Type</th><th class="num">Increase</th><th class="num">Decrease</th><th class="num">Balance</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6">No entries found for this period.</td></tr>'}</tbody></table>
      <p style="margin-top:20px">Generated by Ledger · ${new Date().toLocaleString()}</p>
      </body></html>`)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  const subtypeOptions =
    form.accountType === 'asset' ? ASSET_SUBTYPES : LIABILITY_SUBTYPES

  return (
    <div className="min-h-full bg-[#F6F8FC] px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1440px]">

        {/* Page heading */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-[27px] font-semibold tracking-[-0.035em] text-[#0A2540]">
              Accounts
            </h1>
            <p className="mt-1 text-sm text-[#748196]">
              Manage your banks, mobile wallets, cash and liabilities.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading || saving}
              className="flex items-center gap-2 rounded-lg border border-[#E5EAF1] bg-white px-4 py-2.5 text-sm font-medium text-[#42536A] transition hover:border-[#D5DCE7] hover:bg-[#FAFBFD] disabled:opacity-50"
            >
              <RefreshCw size={16} />
              Refresh
            </button>
            <button
              type="button"
              onClick={startCreate}
              className="flex items-center gap-2 rounded-lg bg-[#635BFF] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_2px_5px_rgba(99,91,255,0.18)] transition hover:bg-[#5148E5]"
            >
              <Plus size={18} />
              Add Account
            </button>
          </div>
        </div>

        {pageError && (
          <div role="alert" className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <span>{pageError}</span>
            <button
              type="button"
              onClick={() => setPageError('')}
              aria-label="Dismiss error"
              className="shrink-0 rounded p-1 hover:bg-red-100"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {notice && (
          <div role="status" className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-[#0B9B78]">
            <span className="flex items-center gap-2">
              <CheckCircle2 size={17} />
              {notice}
            </span>
            <button
              type="button"
              onClick={() => setNotice('')}
              aria-label="Dismiss message"
              className="shrink-0 rounded p-1 hover:bg-green-100"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Financial summary — Stripe-inspired compact metric cards */}
        <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="ledger-panel flex min-w-0 items-start justify-between gap-3 p-5">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-[#748196]">Total assets</p>
              <p className="mt-2 text-[25px] font-semibold tracking-[-0.035em] text-[#0A2540] tabular-nums">
                {loading ? '—' : formatBDT(totals.assets)}
              </p>
              <p className="mt-1.5 text-xs text-[#98A3B2]">Included in net worth</p>
            </div>
            <div className="rounded-xl bg-[#F0EFFF] p-2.5 text-[#635BFF]"><Wallet size={19} /></div>
          </div>
          <div className="ledger-panel flex min-w-0 items-start justify-between gap-3 p-5">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-[#748196]">Total liabilities</p>
              <p className="mt-2 text-[25px] font-semibold tracking-[-0.035em] text-[#D95B70] tabular-nums">
                {loading ? '—' : formatBDT(totals.liabilities)}
              </p>
              <p className="mt-1.5 text-xs text-[#98A3B2]">Outstanding balances</p>
            </div>
            <div className="rounded-xl bg-[#FFF0F2] p-2.5 text-[#D95B70]"><CreditCard size={19} /></div>
          </div>
          <div className="ledger-panel flex min-w-0 items-start justify-between gap-3 p-5">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-[#748196]">Net financial position</p>
              <p className={`mt-2 text-[25px] font-semibold tracking-[-0.035em] tabular-nums ${totals.netPosition < 0 ? 'text-[#D95B70]' : 'text-[#0A2540]'}`}>
                {loading ? '—' : formatBDT(totals.netPosition)}
              </p>
              <p className="mt-1.5 text-xs text-[#98A3B2]">Assets minus liabilities</p>
            </div>
            <div className="rounded-xl bg-[#EAF8F3] p-2.5 text-[#0B9B78]"><Landmark size={19} /></div>
          </div>
          <div className="ledger-panel flex min-w-0 items-start justify-between gap-3 p-5">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-[#748196]">Active accounts</p>
              <p className="mt-2 text-[25px] font-semibold tracking-[-0.035em] text-[#0A2540] tabular-nums">
                {loading ? '—' : activeAccounts.length}
              </p>
              <p className="mt-1.5 text-xs text-[#98A3B2]">{archivedAccounts.length} archived</p>
            </div>
            <div className="rounded-xl bg-[#EEF5FF] p-2.5 text-[#3976C6]"><Building2 size={19} /></div>
          </div>
        </div>

        {/* Account list */}
        <section className="ledger-panel overflow-visible">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EEF1F5] px-5 py-4 sm:px-6">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-[#0A2540]">
                Your Financial Accounts
              </h2>
              <p className="mt-1 text-xs text-[#748196]">
                Account balances are calculated from posted journal entries.
              </p>
            </div>

            <div className="flex rounded-lg bg-[#F3F5F8] p-1">
              <button
                type="button"
                onClick={() => setShowArchived(false)}
                className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                  !showArchived
                    ? 'bg-white text-[#635BFF] shadow-sm'
                    : 'text-[#748196] hover:text-[#0A2540]'
                }`}
              >
                Active ({activeAccounts.length})
              </button>
              <button
                type="button"
                onClick={() => setShowArchived(true)}
                className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                  showArchived
                    ? 'bg-white text-[#635BFF] shadow-sm'
                    : 'text-[#748196] hover:text-[#0A2540]'
                }`}
              >
                Archived ({archivedAccounts.length})
              </button>
            </div>
          </div>

          <div className="grid gap-3 border-b border-[#EEF1F5] px-5 py-4 sm:px-6 md:grid-cols-[1fr_auto]">
            <div className="flex items-center gap-2 rounded-lg border border-[#E5EAF1] bg-white px-3 transition focus-within:border-[#A9A4FF] focus-within:ring-4 focus-within:ring-[#635BFF]/[0.08]">
              <Search size={17} className="shrink-0 text-[#98A3B2]" />
              <input
                type="search"
                value={searchTerm}
                onChange={event => setSearchTerm(event.target.value)}
                placeholder="Search accounts..."
                className="w-full bg-transparent py-3 text-sm outline-none"
              />
            </div>

            <select
              value={typeFilter}
              onChange={event =>
                setTypeFilter(event.target.value as 'all' | AccountType)
              }
              aria-label="Filter account type"
              className="rounded-lg border border-[#E5EAF1] bg-white px-4 py-2.5 text-sm text-[#42536A] outline-none transition focus:border-[#A9A4FF] focus:ring-4 focus:ring-[#635BFF]/[0.08]"
            >
              <option value="all">All account types</option>
              <option value="asset">Assets</option>
              <option value="liability">Liabilities</option>
            </select>
          </div>

          {loading ? (
            <div className="p-12 text-center text-sm text-[#748196]">
              Loading your accounts and balances...
            </div>
          ) : visibleAccounts.length === 0 ? (
            <div className="p-12 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F3F5F8] text-[#98A3B2]">
                <Wallet size={26} />
              </div>
              <h3 className="mt-4 font-semibold text-[#42536A]">
                {showArchived ? 'No archived accounts' : 'No accounts found'}
              </h3>
              <p className="mx-auto mt-2 max-w-md text-sm text-[#748196]">
                {showArchived
                  ? 'Accounts you archive will appear here. You can restore them at any time.'
                  : 'Create your first bank, mobile wallet, cash or liability account to get started.'}
              </p>
              {!showArchived && (
                <button
                  type="button"
                  onClick={startCreate}
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#635BFF] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#5148E5]"
                >
                  <Plus size={17} />
                  Add Your First Account
                </button>
              )}
            </div>
          ) : (
            <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
              {visibleAccounts.map(account => {
                const balance = balances[account.id] || 0
                const hasHistory = historyAccountIds.has(account.id)
                const count = activityCountByAccount[account.id] || 0

                return (
                  <article
                    key={account.id}
                    data-tone={accountColorTone(account)}
                    className="ledger-account-card relative rounded-xl border border-[#E7EBF1] bg-white p-5 transition duration-150 hover:-translate-y-0.5 hover:border-[#C8C4FF] hover:shadow-[0_8px_24px_rgba(26,33,58,0.06)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div data-tone={accountColorTone(account)} className="ledger-account-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-xl">
                          <AccountIcon subtype={account.subtype} />
                        </div>
                        <div className="min-w-0">
                          <h3 className="truncate font-semibold tracking-[-0.02em] text-[#0A2540]">
                            {account.name}
                          </h3>
                          <p className="mt-1 text-xs text-[#748196]">
                            {subtypeLabel(account.subtype)}
                          </p>
                        </div>
                      </div>

                      <div className="relative">
                        <button
                          type="button"
                          onClick={() =>
                            setActionMenuId(
                              actionMenuId === account.id ? null : account.id
                            )
                          }
                          aria-label={`Actions for ${account.name}`}
                          className="rounded-lg p-2 text-[#8995A6] transition hover:bg-[#F3F5F8] hover:text-[#0A2540]"
                        >
                          <MoreHorizontal size={20} />
                        </button>

                        {actionMenuId === account.id && (
                          <div className="absolute right-0 top-10 z-20 w-52 rounded-xl border border-[#E7EBF1] bg-white p-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.14)]">
                            <button
                              type="button"
                              onClick={() => startEdit(account)}
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-[#42536A] transition hover:bg-[#F6F8FC]"
                            >
                              <Pencil size={16} />
                              Edit account
                            </button>

                            {account.is_active ? (
                              <button
                                type="button"
                                onClick={() => void handleArchive(account)}
                                disabled={saving}
                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-[#42536A] transition hover:bg-[#F6F8FC] disabled:opacity-50"
                              >
                                <Archive size={16} />
                                Archive account
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void handleRestore(account)}
                                disabled={saving}
                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-[#0B9B78] hover:bg-green-50 disabled:opacity-50"
                              >
                                <RotateCcw size={16} />
                                Restore account
                              </button>
                            )}

                            <div className="my-1 border-t border-[#EEF1F5]"/>

                            <button
                              type="button"
                              disabled={hasHistory || saving}
                              onClick={() => {
                                setDeleteTarget(account)
                                setActionMenuId(null)
                              }}
                              title={
                                hasHistory
                                  ? 'This account has journal history. Archive it instead.'
                                  : 'Permanently delete this account'
                              }
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-[#D95B70] hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Trash2 size={16} />
                              {hasHistory ? 'Delete unavailable' : 'Delete account'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-5">
                      <p className="text-xs font-medium text-[#748196]">
                        {account.account_type === 'liability'
                          ? 'Outstanding balance'
                          : 'Current balance'}
                      </p>
                      <p className={`mt-1 text-2xl font-bold ${
                        balance < 0 ? 'text-[#D95B70]' : 'text-[#0A2540]'
                      }`}>
                        {formatBDT(balance)}
                      </p>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        account.is_active
                          ? 'bg-[#EAF8F3] text-[#0B9B78]'
                          : 'bg-[#F3F5F8] text-[#748196]'
                      }`}>
                        {account.is_active ? 'Active' : 'Archived'}
                      </span>
                      <span data-tone={accountColorTone(account)} className="ledger-account-type-badge rounded-md px-2.5 py-1 text-xs font-semibold capitalize">
                        {account.account_type}
                      </span>
                      {account.include_in_net_worth && (
                        <span className="rounded-md bg-[#F0EFFF] px-2.5 py-1 text-xs font-medium text-[#635BFF]">
                          In net worth
                        </span>
                      )}
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-[#EEF1F5] pt-4">
                      <span className="text-xs text-[#98A3B2]">
                        {count} posted {count === 1 ? 'entry' : 'entries'}
                      </span>
                      <button
                        type="button"
                        onClick={() => openStatement(account)}
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#635BFF] transition hover:text-[#5148E5]"
                      >
                        <Eye size={16} />
                        Statement
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}

          <div className="border-t border-[#EEF1F5] px-5 py-3 text-xs text-[#98A3B2]">
            Showing {visibleAccounts.length} of {showArchived ? archivedAccounts.length : activeAccounts.length} {showArchived ? 'archived' : 'active'} accounts.
          </div>
        </section>

        <p className="mt-4 text-xs leading-5 text-[#98A3B2]">
          Account balances are derived from posted journal lines. Accounts with financial history cannot be permanently deleted; archive them to preserve your records.
        </p>
      </div>

      {/* Create / edit account modal */}
      {formMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A2540]/45 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#E7EBF1] bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.18)]">
            <div className="mb-6 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.02em] text-[#0A2540]">
                  {formMode === 'create' ? 'Add Financial Account' : 'Edit Account'}
                </h2>
                <p className="mt-1 text-sm text-[#748196]">
                  {formMode === 'create'
                    ? 'Add a bank, wallet, cash or liability account.'
                    : 'Update the account details. Its accounting type cannot be changed.'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeForm}
                disabled={saving}
                aria-label="Close account form"
                className="rounded-lg p-2 text-[#98A3B2] hover:bg-[#F3F5F8] disabled:opacity-50"
              >
                <X size={20} />
              </button>
            </div>

            {formError && (
              <div role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveAccount} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-[#42536A]">
                  Account Name
                </label>
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={form.name}
                  onChange={event =>
                    setForm(previous => ({ ...previous, name: event.target.value }))
                  }
                  placeholder="e.g. DBBL Savings, BRAC Bank Salary, bKash Personal"
                  className="w-full rounded-xl border border-[#E7EBF1] px-4 py-3 text-sm outline-none focus:border-[#A9A4FF] focus:ring-4 focus:ring-[#635BFF]/[0.08]"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#42536A]">
                    Account Type
                  </label>
                  <select
                    value={form.accountType}
                    disabled={formMode === 'edit'}
                    onChange={event => {
                      const accountType = event.target.value as AccountType
                      setForm(previous => ({
                        ...previous,
                        accountType,
                        subtype: accountType === 'asset' ? 'bank' : 'credit_card',
                      }))
                    }}
                    className="w-full rounded-xl border border-[#E7EBF1] bg-white px-4 py-3 text-sm outline-none focus:border-[#A9A4FF] focus:ring-4 focus:ring-[#635BFF]/[0.08] disabled:bg-[#F3F5F8] disabled:text-[#748196]"
                  >
                    <option value="asset">Asset</option>
                    <option value="liability">Liability</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#42536A]">
                    Account Category
                  </label>
                  <select
                    value={form.subtype}
                    onChange={event =>
                      setForm(previous => ({
                        ...previous,
                        subtype: event.target.value as AccountSubtype,
                      }))
                    }
                    className="w-full rounded-xl border border-[#E7EBF1] bg-white px-4 py-3 text-sm outline-none focus:border-[#A9A4FF] focus:ring-4 focus:ring-[#635BFF]/[0.08]"
                  >
                    {subtypeOptions.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {formMode === 'create' && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#42536A]">
                    Opening Balance (BDT)
                  </label>
                  <div className="flex items-center rounded-xl border border-[#E7EBF1] px-4 focus-within:border-[#A9A4FF] focus-within:ring-4 focus-within:ring-[#635BFF]/[0.08]">
                    <span className="text-lg font-semibold text-[#98A3B2]">৳</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={form.openingBalance}
                      onChange={event =>
                        setForm(previous => ({
                          ...previous,
                          openingBalance: event.target.value,
                        }))
                      }
                      placeholder="0.00"
                      className="w-full bg-transparent px-3 py-3 text-lg font-semibold outline-none"
                    />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[#748196]">
                    {form.accountType === 'liability'
                      ? 'Enter the amount you currently owe, as a positive number.'
                      : 'Enter the amount currently available in this account. You can enter 0 if it has no opening balance.'}
                  </p>
                </div>
              )}

              {formMode === 'edit' && (
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#E7EBF1] p-4">
                  <input
                    type="checkbox"
                    checked={form.includeInNetWorth}
                    onChange={event =>
                      setForm(previous => ({
                        ...previous,
                        includeInNetWorth: event.target.checked,
                      }))
                    }
                    className="mt-0.5 h-4 w-4 accent-[#635BFF]"
                  />
                  <span>
                    <span className="block text-sm font-medium text-[#42536A]">
                      Include in net worth
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-[#748196]">
                      When enabled, this account contributes to the net financial position shown in Ledger.
                    </span>
                  </span>
                </label>
              )}

              <div className="rounded-xl bg-[#F2F1FF] p-3 text-xs leading-5 text-[#4B5C79]">
                {formMode === 'create'
                  ? 'Ledger records an opening balance through a balanced journal entry. The balance is not stored as a manually editable number.'
                  : 'Changing an account name or category does not rewrite its historical journal entries.'}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeForm}
                  disabled={saving}
                  className="flex-1 rounded-xl border border-[#E7EBF1] py-3 text-sm font-semibold text-[#5F6E82] hover:bg-[#F6F8FC] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 rounded-xl bg-[#635BFF] py-3 text-sm font-semibold text-white transition hover:bg-[#5148E5] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving
                    ? 'Saving...'
                    : formMode === 'create'
                      ? 'Create Account'
                      : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Account statement modal */}
      {statementAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A2540]/45 p-3 backdrop-blur-sm sm:p-5">
          <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[#E7EBF1] bg-white shadow-[0_24px_70px_rgba(15,23,42,0.18)]">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#EEF1F5] px-5 py-4 sm:px-6">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#F0EFFF] text-[#635BFF]">
                  <AccountIcon subtype={statementAccount.subtype} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold tracking-[-0.02em] text-[#0A2540]">
                    {statementAccount.name}
                  </h2>
                  <p className="mt-1 text-xs text-[#748196]">
                    {subtypeLabel(statementAccount.subtype)} · {statementAccount.account_type}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-[#0A2540]">
                    {statementAccount.account_type === 'liability' ? 'Outstanding: ' : 'Current balance: '}
                    {formatBDT(balances[statementAccount.id] || 0)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setStatementAccount(null)}
                aria-label="Close statement"
                className="rounded-lg p-2 text-[#98A3B2] hover:bg-[#F3F5F8]"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3 border-b border-[#EEF1F5] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex min-w-[190px] flex-1 items-center gap-2 rounded-lg border border-[#E5EAF1] bg-white px-3 transition focus-within:border-[#A9A4FF] focus-within:ring-4 focus-within:ring-[#635BFF]/[0.08]">
                  <Search size={16} className="shrink-0 text-[#98A3B2]"/>
                  <input
                    type="search"
                    value={statementSearch}
                    onChange={event => setStatementSearch(event.target.value)}
                    placeholder="Search this statement..."
                    className="w-full bg-transparent py-2.5 text-sm outline-none"
                  />
                </div>
                <label className="flex items-center gap-2 rounded-lg border border-[#E5EAF1] px-2.5 py-2 text-xs text-[#748196]">
                  From
                  <input type="date" value={statementFrom} onChange={event => setStatementFrom(event.target.value)} className="min-w-0 bg-transparent text-xs text-[#42536A] outline-none"/>
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-[#E5EAF1] px-2.5 py-2 text-xs text-[#748196]">
                  To
                  <input type="date" min={statementFrom || undefined} value={statementTo} onChange={event => setStatementTo(event.target.value)} className="min-w-0 bg-transparent text-xs text-[#42536A] outline-none"/>
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-[#98A3B2]">Filter by date, search, then export or print the visible entries.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => exportStatement('xlsx')} className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5EAF1] px-3 py-2 text-xs font-semibold text-[#42536A] hover:bg-[#F6F8FC]"><FileSpreadsheet size={14}/>Excel</button>
                  <button type="button" onClick={() => exportStatement('csv')} className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5EAF1] px-3 py-2 text-xs font-semibold text-[#42536A] hover:bg-[#F6F8FC]"><Download size={14}/>CSV</button>
                  <button type="button" onClick={printStatement} className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5EAF1] px-3 py-2 text-xs font-semibold text-[#42536A] hover:bg-[#F6F8FC]"><Printer size={14}/>Print</button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl bg-[#F6F8FC] px-3 py-2.5"><p className="text-[10px] font-semibold uppercase tracking-wide text-[#98A3B2]">Opening balance</p><p className="mt-1 text-sm font-semibold text-[#0A2540]">{formatBDT(statementOpeningBalance)}</p></div>
                <div className="rounded-xl bg-[#F6F8FC] px-3 py-2.5"><p className="text-[10px] font-semibold uppercase tracking-wide text-[#98A3B2]">Period movement</p><p className={`mt-1 text-sm font-semibold ${statementPeriodMovement >= 0 ? 'text-[#0B9B78]' : 'text-[#D95B70]'}`}>{formatBDT(statementPeriodMovement)}</p></div>
                <div className="rounded-xl bg-[#F6F8FC] px-3 py-2.5"><p className="text-[10px] font-semibold uppercase tracking-wide text-[#98A3B2]">Closing balance</p><p className="mt-1 text-sm font-semibold text-[#0A2540]">{formatBDT(statementClosingBalance)}</p></div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              {filteredStatementRows.length === 0 ? (
                <div className="p-12 text-center">
                  <FileText size={30} className="mx-auto text-slate-300"/>
                  <p className="mt-3 font-semibold text-[#42536A]">
                    No statement entries found
                  </p>
                  <p className="mt-1 text-sm text-[#748196]">
                    Posted transactions for this account will appear here.
                  </p>
                </div>
              ) : (
                <table className="w-full min-w-[760px] text-left">
                  <thead className="sticky top-0 bg-[#F6F8FC] text-xs uppercase tracking-wide text-[#748196]">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Date</th>
                      <th className="px-4 py-3 font-semibold">Description</th>
                      <th className="px-4 py-3 font-semibold">Type</th>
                      <th className="px-4 py-3 text-right font-semibold">Increase</th>
                      <th className="px-4 py-3 text-right font-semibold">Decrease</th>
                      <th className="px-4 py-3 text-right font-semibold">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredStatementRows.map(row => (
                      <tr key={row.id} className="hover:bg-[#F6F8FC]/70">
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-[#748196]">
                          {formatDate(row.date)}
                        </td>
                        <td className="max-w-[260px] px-4 py-3">
                          <p className="truncate text-sm font-medium text-[#42536A]">
                            {row.description}
                          </p>
                          {row.notes && (
                            <p className="mt-1 truncate text-xs text-[#98A3B2]">
                              {row.notes}
                            </p>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-[#748196]">
                          {transactionTypeLabel(row.transactionType)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium text-[#0B9B78]">
                          {row.increaseMinor > 0 ? formatBDT(row.increaseMinor) : '—'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium text-[#D95B70]">
                          {row.decreaseMinor > 0 ? formatBDT(row.decreaseMinor) : '—'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-semibold tracking-[-0.02em] text-[#0A2540]">
                          {formatBDT(row.runningBalance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="border-t border-[#EEF1F5] px-5 py-3 text-xs text-[#98A3B2]">
              Showing {filteredStatementRows.length} of {dateFilteredStatementRows.length} entries in this period. Draft entries are excluded.
            </div>
          </div>
        </div>
      )}

      {/* Permanent deletion confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0A2540]/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-[#E7EBF1] bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.18)]">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-[#D95B70]">
              <Trash2 size={22}/>
            </div>
            <h2 className="mt-4 text-lg font-semibold tracking-[-0.02em] text-[#0A2540]">
              Delete account permanently?
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#748196]">
              You are about to delete <strong>{deleteTarget.name}</strong>. This is only allowed when the account has no journal history. This action cannot be undone.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={saving}
                className="flex-1 rounded-xl border border-[#E7EBF1] py-3 text-sm font-semibold text-[#5F6E82] hover:bg-[#F6F8FC]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteAccount()}
                disabled={saving}
                className="flex-1 rounded-xl bg-[#D95B70] py-3 text-sm font-semibold text-white hover:bg-[#C64A61] disabled:opacity-50"
              >
                {saving ? 'Deleting...' : 'Delete Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
