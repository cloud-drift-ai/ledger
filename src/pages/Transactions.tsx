import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'
import {
  Plus,
  Search,
  RefreshCw,
  X,
  Wallet,
  TrendingUp,
  TrendingDown,
  CalendarDays,
  ArrowUpRight,
  ArrowDownRight,
  SlidersHorizontal,
  List,
  Table2,
  Save,
  RotateCcw,
  ChevronDown,
  Download,
  Upload,
  Tag,
  FolderOpen,
  CheckSquare,
} from 'lucide-react'

import { supabase } from '../lib/supabase'
import { usePwa } from '../context/PwaContext'
import { useAuth } from '../context/AuthContext'
import { formatBDTCurrencyMinor, formatLedgerDate } from '../lib/preferences'
import { useNavigate, useSearchParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import TransactionImportWizard from '../components/TransactionImportWizard'

type Account = {
  id: string
  name: string
  account_kind: 'financial' | 'category'
  account_type: 'asset' | 'liability' | 'equity' | 'income' | 'expense'
  subtype: string | null
  is_active: boolean
}

type JournalEntry = {
  id: string
  entry_date: string
  transaction_type: 'income' | 'expense'
  description: string | null
  payee: string | null
  notes: string | null
  status: string
  posted_at: string | null
  created_at: string
  tags?: string[] | null
  transaction_group?: string | null
}

type JournalLine = {
  journal_entry_id: string
  ledger_account_id: string
  debit_minor: number | string
  credit_minor: number | string
}

type Transaction = {
  id: string
  date: string
  type: 'income' | 'expense'
  description: string
  payee: string
  notes: string
  amountMinor: number
  accountName: string
  categoryName: string
  accountId: string
  categoryId: string
  tags: string[]
  groupName: string
}

const formatMoney = (minor: number) => formatBDTCurrencyMinor(minor)

const CATEGORY_COLOR_TONES = ['blue', 'teal', 'violet', 'amber', 'rose', 'cyan'] as const

function categoryColorTone(categoryId: string, categoryName: string) {
  const key = categoryId || categoryName
  let hash = 0
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0
  }
  return CATEGORY_COLOR_TONES[Math.abs(hash) % CATEGORY_COLOR_TONES.length]
}

function getLocalDate() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseAmountToMinor(value: string): number | null {
  const cleaned = value.trim()

  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return null
  }

  const [whole, fraction = ''] = cleaned.split('.')
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))

  if (!Number.isSafeInteger(minor) || minor <= 0) {
    return null
  }

  return minor
}

export default function Transactions() {
  const { user } = useAuth()
  const { online, offlineSnapshot, offlineVaultUnlocked, offlineVaultUserId, enqueueOfflineTransaction } = usePwa()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [accounts, setAccounts] = useState<Account[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [transactionType, setTransactionType] = useState<'income' | 'expense'>('expense')
  const [amount, setAmount] = useState('')
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [entryDate, setEntryDate] = useState(getLocalDate())
  const [description, setDescription] = useState('')
  const [payee, setPayee] = useState('')
  const [notes, setNotes] = useState('')

  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [filterAccountId, setFilterAccountId] = useState('all')
  const [filterCategoryId, setFilterCategoryId] = useState('all')
  const [filterTag, setFilterTag] = useState('all')
  const [filterGroup, setFilterGroup] = useState('all')
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<string[]>([])
  const [bulkTagInput, setBulkTagInput] = useState('')
  const [bulkRemoveTag, setBulkRemoveTag] = useState('')
  const [bulkGroupInput, setBulkGroupInput] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)
  const [showImportWizard, setShowImportWizard] = useState(false)
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'highest' | 'lowest'>('newest')
  const [viewMode, setViewMode] = useState<'table' | 'list'>('table')
  const [showMoreDetails, setShowMoreDetails] = useState(false)
  const [showSaveViewModal, setShowSaveViewModal] = useState(false)
  const [newViewName, setNewViewName] = useState('')
  const [savedViews, setSavedViews] = useState<{ id: string; name: string; filters: { filterType: 'all' | 'income' | 'expense'; searchTerm: string; dateFrom: string; dateTo: string; filterAccountId: string; filterCategoryId: string; filterTag?: string; filterGroup?: string; sortBy: 'newest' | 'oldest' | 'highest' | 'lowest' } }[]>(() => {
    try { const parsed = JSON.parse(window.localStorage.getItem('ledger.transactionViews.v1') || '[]'); return Array.isArray(parsed) ? parsed : [] } catch { return [] }
  })

  const [showCategoryForm, setShowCategoryForm] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [categorySaving, setCategorySaving] = useState(false)
  const [categoryError, setCategoryError] = useState('')

  const financialAccounts = useMemo(
    () =>
      accounts.filter(
        account =>
          account.account_kind === 'financial' &&
          account.is_active &&
          (account.account_type === 'asset' || account.account_type === 'liability')
      ),
    [accounts]
  )

  const availableAccounts = useMemo(
    () =>
      financialAccounts.filter(account =>
        transactionType === 'income'
          ? account.account_type === 'asset'
          : account.account_type === 'asset' || account.account_type === 'liability'
      ),
    [financialAccounts, transactionType]
  )

  const availableCategories = useMemo(
    () =>
      accounts.filter(
        account =>
          account.account_kind === 'category' &&
          account.account_type === transactionType &&
          account.is_active
      ),
    [accounts, transactionType]
  )

  const loadData = useCallback(async () => {
    if (!user?.id) {
      setAccounts([])
      setTransactions([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')

    if (!online) {
      if (!offlineVaultUnlocked || offlineVaultUserId !== user.id || !offlineSnapshot) {
        setAccounts([])
        setTransactions([])
        setError('Unlock your encrypted offline vault to view cached transactions and create offline entries.')
        setLoading(false)
        return
      }

      const cachedAccounts: Account[] = [
        ...offlineSnapshot.accounts.map(account => ({
          id: account.id,
          name: account.name,
          account_kind: 'financial' as const,
          account_type: account.accountType,
          subtype: account.subtype,
          is_active: account.isActive,
        })),
        ...(offlineSnapshot.categories || []).map(category => ({
          id: category.id,
          name: category.name,
          account_kind: 'category' as const,
          account_type: category.type,
          subtype: null,
          is_active: category.isActive,
        })),
      ]
      setAccounts(cachedAccounts)
      setTransactions(offlineSnapshot.transactions)
      setLoading(false)
      return
    }

    try {
      // Ensure the user's standard income and expense categories exist.
      const { error: defaultCategoryError } = await supabase.rpc(
        'ensure_default_transaction_categories'
      )

      if (defaultCategoryError) throw defaultCategoryError

      // Load active financial accounts and categories belonging to this user.
      const { data: accountData, error: accountError } = await supabase
        .from('ledger_accounts')
        .select('id, name, account_kind, account_type, subtype, is_active')
        .eq('is_active', true)
        .order('name', { ascending: true })

      if (accountError) throw accountError

      const accountList = (accountData || []) as Account[]
      setAccounts(accountList)

      // Load posted income and expense entries.
      const { data: entryData, error: entryError } = await supabase
        .from('journal_entries')
        .select(
          'id, entry_date, transaction_type, description, payee, notes, status, posted_at, created_at, tags, transaction_group'
        )
        .eq('status', 'posted')
        .in('transaction_type', ['income', 'expense'])
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1000)

      if (entryError) throw entryError

      const entries = (entryData || []) as JournalEntry[]

      if (entries.length === 0) {
        setTransactions([])
        return
      }

      const entryIds = entries.map(entry => entry.id)

      const { data: lineData, error: lineError } = await supabase
        .from('journal_lines')
        .select('journal_entry_id, ledger_account_id, debit_minor, credit_minor')
        .in('journal_entry_id', entryIds)

      if (lineError) throw lineError

      const accountMap = new Map(accountList.map(account => [account.id, account]))
      const linesByEntry = new Map<string, JournalLine[]>()

      for (const line of (lineData || []) as JournalLine[]) {
        const existing = linesByEntry.get(line.journal_entry_id) || []
        existing.push(line)
        linesByEntry.set(line.journal_entry_id, existing)
      }

      const mappedTransactions: Transaction[] = entries.map(entry => {
        const entryLines = linesByEntry.get(entry.id) || []

        const categoryLine = entryLines.find(line => {
          const account = accountMap.get(line.ledger_account_id)
          return account?.account_kind === 'category'
        })

        const financialLine = entryLines.find(line => {
          const account = accountMap.get(line.ledger_account_id)
          return account?.account_kind === 'financial'
        })

        const categoryAccount = categoryLine
          ? accountMap.get(categoryLine.ledger_account_id)
          : undefined

        const financialAccount = financialLine
          ? accountMap.get(financialLine.ledger_account_id)
          : undefined

        const amountMinor = categoryLine
          ? Number(categoryLine.debit_minor) + Number(categoryLine.credit_minor)
          : 0

        return {
          id: entry.id,
          date: entry.entry_date,
          type: entry.transaction_type,
          description: entry.description || (entry.transaction_type === 'income' ? 'Income' : 'Expense'),
          payee: entry.payee || '',
          notes: entry.notes || '',
          amountMinor,
          accountName: financialAccount?.name || 'Account unavailable',
          categoryName: categoryAccount?.name || 'Category unavailable',
          accountId: financialAccount?.id || '',
          categoryId: categoryAccount?.id || '',
          tags: Array.isArray(entry.tags) ? entry.tags : [],
          groupName: entry.transaction_group || '',
        }
      })

      setTransactions(mappedTransactions)
    } catch (err) {
      console.error('Transaction loading error:', err)
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load transactions.'
      )
    } finally {
      setLoading(false)
    }
  }, [user?.id, online, offlineSnapshot, offlineVaultUnlocked, offlineVaultUserId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    if (!availableAccounts.some(account => account.id === selectedAccountId)) {
      setSelectedAccountId(availableAccounts[0]?.id || '')
    }

    if (!availableCategories.some(category => category.id === selectedCategoryId)) {
      setSelectedCategoryId(availableCategories[0]?.id || '')
    }
  }, [
    availableAccounts,
    availableCategories,
    selectedAccountId,
    selectedCategoryId,
  ])

  const totalIncome = transactions
    .filter(transaction => transaction.type === 'income')
    .reduce((sum, transaction) => sum + transaction.amountMinor, 0)

  const totalExpenses = transactions
    .filter(transaction => transaction.type === 'expense')
    .reduce((sum, transaction) => sum + transaction.amountMinor, 0)

  const netCashFlow = totalIncome - totalExpenses

  const filteredTransactions = useMemo(() => {
    const filtered = transactions.filter(transaction => {
      const matchesType = filterType === 'all' || transaction.type === filterType
      const searchableText = [transaction.description, transaction.payee, transaction.categoryName, transaction.accountName, transaction.notes, transaction.groupName, ...transaction.tags].join(' ').toLowerCase()
      const matchesSearch = searchableText.includes(searchTerm.toLowerCase())
      const matchesFrom = !dateFrom || transaction.date >= dateFrom
      const matchesTo = !dateTo || transaction.date <= dateTo
      const matchesAccount = filterAccountId === 'all' || transaction.accountId === filterAccountId
      const matchesCategory = filterCategoryId === 'all' || transaction.categoryId === filterCategoryId
      const matchesTag = filterTag === 'all' || transaction.tags.some(tag => tag.toLowerCase() === filterTag.toLowerCase())
      const matchesGroup = filterGroup === 'all' || transaction.groupName === filterGroup
      return matchesType && matchesSearch && matchesFrom && matchesTo && matchesAccount && matchesCategory && matchesTag && matchesGroup
    })
    return filtered.sort((a, b) => {
      if (sortBy === 'oldest') return a.date.localeCompare(b.date)
      if (sortBy === 'highest') return b.amountMinor - a.amountMinor
      if (sortBy === 'lowest') return a.amountMinor - b.amountMinor
      return b.date.localeCompare(a.date)
    })
  }, [transactions, filterType, searchTerm, dateFrom, dateTo, filterAccountId, filterCategoryId, filterTag, filterGroup, sortBy])

  const knownPayees = useMemo(() => [...new Set(transactions.map(item => item.payee).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [transactions])
  const tagOptions = useMemo(() => [...new Set(transactions.flatMap(item => item.tags))].sort((a, b) => a.localeCompare(b)), [transactions])
  const groupOptions = useMemo(() => [...new Set(transactions.map(item => item.groupName).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [transactions])
  const selectedTransactions = useMemo(() => transactions.filter(item => selectedTransactionIds.includes(item.id)), [transactions, selectedTransactionIds])
  const allVisibleSelected = filteredTransactions.length > 0 && filteredTransactions.every(item => selectedTransactionIds.includes(item.id))

  useEffect(() => {
    setSelectedTransactionIds(current => current.filter(id => transactions.some(item => item.id === id)))
  }, [transactions])

  useEffect(() => {
    try { window.localStorage.setItem('ledger.transactionViews.v1', JSON.stringify(savedViews)) } catch { /* storage may be unavailable */ }
  }, [savedViews])

  const resetFilters = () => {
    setFilterType('all')
    setSearchTerm('')
    setDateFrom('')
    setDateTo('')
    setFilterAccountId('all')
    setFilterCategoryId('all')
    setFilterTag('all')
    setFilterGroup('all')
    setSortBy('newest')
  }

  const applyDatePreset = (preset: 'this_month' | 'last_month' | 'this_year') => {
    const today = new Date()
    if (preset === 'this_month') {
      setDateFrom(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`)
      setDateTo(getLocalDate())
    } else if (preset === 'last_month') {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const end = new Date(today.getFullYear(), today.getMonth(), 0)
      setDateFrom(`${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`)
      setDateTo(`${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`)
    } else {
      setDateFrom(`${today.getFullYear()}-01-01`)
      setDateTo(getLocalDate())
    }
  }

  const saveCurrentView = () => {
    setNewViewName('')
    setShowSaveViewModal(true)
  }

  const confirmSaveView = () => {
    const name = newViewName.trim()
    if (!name) return
    const filters = { filterType, searchTerm, dateFrom, dateTo, filterAccountId, filterCategoryId, filterTag, filterGroup, sortBy }
    setSavedViews(current => [...current.filter(view => view.name.toLowerCase() !== name.toLowerCase()), { id: `${Date.now()}`, name, filters }])
    setShowSaveViewModal(false)
    setNewViewName('')
  }

  const applySavedView = (id: string) => {
    const view = savedViews.find(item => item.id === id)
    if (!view) return
    setFilterType(view.filters.filterType)
    setSearchTerm(view.filters.searchTerm)
    setDateFrom(view.filters.dateFrom)
    setDateTo(view.filters.dateTo)
    setFilterAccountId(view.filters.filterAccountId)
    setFilterCategoryId(view.filters.filterCategoryId)
    setFilterTag(view.filters.filterTag || 'all')
    setFilterGroup(view.filters.filterGroup || 'all')
    setSortBy(view.filters.sortBy)
  }


  const resetForm = () => {
    setAmount('')
    setEntryDate(getLocalDate())
    setDescription('')
    setPayee('')
    setNotes('')
    setShowMoreDetails(false)
    setError('')
    setShowCategoryForm(false)
    setNewCategoryName('')
    setCategoryError('')
  }

  const openTransactionForm = (type: 'income' | 'expense') => {
    setTransactionType(type)
    resetForm()
    setShowForm(true)
  }

  useEffect(() => {
    const requestedType = searchParams.get('new')
    const requestedSearch = searchParams.get('search')
    const requestedFilterType = searchParams.get('type')
    const requestedCategory = searchParams.get('category')
    const requestedAccount = searchParams.get('account')
    const requestedFrom = searchParams.get('from')
    const requestedTo = searchParams.get('to')
    if (requestedSearch !== null) setSearchTerm(requestedSearch)
    if (requestedFilterType === 'income' || requestedFilterType === 'expense') setFilterType(requestedFilterType)
    if (requestedCategory) setFilterCategoryId(requestedCategory)
    if (requestedAccount) setFilterAccountId(requestedAccount)
    if (requestedFrom) setDateFrom(requestedFrom)
    if (requestedTo) setDateTo(requestedTo)
    if (requestedType === 'income' || requestedType === 'expense') openTransactionForm(requestedType)
    if (requestedType || requestedSearch !== null || requestedFilterType || requestedCategory || requestedAccount || requestedFrom || requestedTo) {
      setSearchParams({}, { replace: true })
    }
    // Route query parameters are one-shot commands; clear them after applying.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams])

  const handleCreateTransaction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setSuccess('')

    if (!selectedAccountId) {
      setError('Please create and select a financial account first.')
      return
    }

    if (!selectedCategoryId) {
      setError('Please select a category.')
      return
    }

    const amountMinor = parseAmountToMinor(amount)

    if (amountMinor === null) {
      setError('Enter a valid amount greater than zero, with up to two decimal places.')
      return
    }

    setSaving(true)

    try {
      if (!online) {
        await enqueueOfflineTransaction({
          operation: 'income_expense',
          transactionType,
          amountMinor,
          accountId: selectedAccountId,
          categoryId: selectedCategoryId,
          date: entryDate,
          description,
          payee,
          notes,
        })
        setShowForm(false)
        resetForm()
        setSuccess(`${transactionType === 'income' ? 'Income' : 'Expense'} saved securely on this device. It will synchronize when your connection returns.`)
        return
      }

      const { error: transactionError } = await supabase.rpc(
        'create_income_expense_transaction',
        {
          p_transaction_type: transactionType,
          p_amount_minor: amountMinor,
          p_financial_account_id: selectedAccountId,
          p_category_account_id: selectedCategoryId,
          p_entry_date: entryDate,
          p_description: description.trim() || null,
          p_payee: payee.trim() || null,
          p_notes: notes.trim() || null,
        }
      )

      if (transactionError) throw transactionError

      setShowForm(false)
      resetForm()
      setSuccess(
        `${transactionType === 'income' ? 'Income' : 'Expense'} recorded successfully.`
      )

      await loadData()
    } catch (err) {
      console.error('Transaction creation error:', err)
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to save this transaction.'
      )
    } finally {
      setSaving(false)
    }
  }

  const handleCreateCategory = async () => {
    setCategoryError('')
    if (!online) {
      setCategoryError('Categories can only be created while online. Use one of the categories cached in your offline vault.')
      return
    }

    const trimmedName = newCategoryName.trim()

    if (!trimmedName) {
      setCategoryError('Enter a category name.')
      return
    }

    setCategorySaving(true)

    try {
      const { data, error: createError } = await supabase.rpc(
        'create_transaction_category',
        {
          p_name: trimmedName,
          p_category_type: transactionType,
        }
      )

      if (createError) throw createError

      await loadData()

      if (typeof data === 'string') {
        setSelectedCategoryId(data)
      }

      setNewCategoryName('')
      setShowCategoryForm(false)
    } catch (err) {
      console.error('Category creation error:', err)
      setCategoryError(
        err instanceof Error
          ? err.message
          : 'Unable to create category.'
      )
    } finally {
      setCategorySaving(false)
    }
  }


  const toggleTransactionSelection = (id: string) => {
    if (selectedTransactionIds.includes(id)) {
      setSelectedTransactionIds(current => current.filter(item => item !== id))
      return
    }
    if (selectedTransactionIds.length >= 500) {
      setError('Bulk actions support up to 500 selected transactions at a time.')
      return
    }
    setSelectedTransactionIds(current => [...current, id])
  }

  const toggleVisibleSelection = (checked: boolean) => {
    const visibleIds = filteredTransactions.map(item => item.id)
    if (!checked) {
      setSelectedTransactionIds(current => current.filter(id => !visibleIds.includes(id)))
      return
    }
    const next = [...new Set([...selectedTransactionIds, ...visibleIds])]
    if (next.length > 500) {
      setError('Bulk actions support up to 500 selected transactions. The first 500 have been selected.')
      setSelectedTransactionIds(next.slice(0, 500))
      return
    }
    setSelectedTransactionIds(next)
  }

  const exportTransactions = (items: Transaction[], label: string) => {
    if (!items.length) {
      setError('There are no transactions to export.')
      return
    }
    const exportRows = items.map(item => ({
      Date: item.date,
      Type: item.type,
      Description: item.description,
      Payee: item.payee,
      Account: item.accountName,
      Category: item.categoryName,
      Amount_BDT: Number((item.amountMinor / 100).toFixed(2)),
      Tags: item.tags.join(', '),
      Group: item.groupName,
      Notes: item.notes,
    }))
    const worksheet = XLSX.utils.json_to_sheet(exportRows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Transactions')
    XLSX.writeFile(workbook, `Ledger_${label}_${getLocalDate()}.xlsx`)
    setSuccess(`${items.length} transaction${items.length === 1 ? '' : 's'} exported to Excel.`)
    setError('')
  }

  const runBulkMetadataUpdate = async (options: { addTag?: string; removeTag?: string; group?: string; clearGroup?: boolean }) => {
    if (!online) {
      setError('Bulk metadata changes require an internet connection.')
      return
    }
    if (!selectedTransactionIds.length || bulkSaving) return
    setBulkSaving(true)
    setError('')
    setSuccess('')
    try {
      const { data, error: updateError } = await supabase.rpc('bulk_update_journal_entry_metadata', {
        p_entry_ids: selectedTransactionIds,
        p_add_tag: options.addTag || null,
        p_remove_tag: options.removeTag || null,
        p_transaction_group: options.group || null,
        p_clear_group: options.clearGroup || false,
      })
      if (updateError) throw updateError
      const updatedCount = Number(data ?? selectedTransactionIds.length)
      setSuccess(`Updated metadata for ${updatedCount} selected transaction${updatedCount === 1 ? '' : 's'}.`)
      setSelectedTransactionIds([])
      setBulkTagInput('')
      setBulkRemoveTag('')
      setBulkGroupInput('')
      await loadData()
    } catch (err) {
      console.error('Bulk transaction metadata update error:', err)
      setError(err instanceof Error ? err.message : 'Unable to update selected transactions.')
    } finally {
      setBulkSaving(false)
    }
  }

  const handleAddBulkTag = () => {
    const tag = bulkTagInput.trim()
    if (!tag || tag.length > 32) {
      setError('Enter a tag between 1 and 32 characters.')
      return
    }
    void runBulkMetadataUpdate({ addTag: tag })
  }

  const handleRemoveBulkTag = () => {
    if (!bulkRemoveTag) return
    void runBulkMetadataUpdate({ removeTag: bulkRemoveTag })
  }

  const handleAssignBulkGroup = () => {
    const group = bulkGroupInput.trim()
    if (!group || group.length > 80) {
      setError('Enter a group name between 1 and 80 characters.')
      return
    }
    void runBulkMetadataUpdate({ group })
  }

  const handleClearBulkGroup = () => void runBulkMetadataUpdate({ clearGroup: true })

  return (
    <div className="min-h-screen bg-ledger-bg p-5 md:p-8">
      <div className="mx-auto max-w-7xl">

        {/* Page heading */}
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">
              Transactions
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Record and review your income and everyday expenses.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setShowImportWizard(true)} disabled={!online} title={!online ? 'Import requires an internet connection.' : undefined} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><Upload size={16}/>Import</button>
            <button type="button" onClick={() => exportTransactions(selectedTransactions.length ? selectedTransactions : filteredTransactions, selectedTransactions.length ? 'Selected_Transactions' : 'Filtered_Transactions')} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Download size={16}/>{selectedTransactions.length ? 'Export selected' : 'Export filtered'}</button>
            <button
              type="button"
              onClick={() => openTransactionForm('expense')}
              className="flex items-center gap-2 rounded-xl bg-ledger-navy px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700"
            >
              <Plus size={18} />
              Add Transaction
            </button>
          </div>
        </div>

        {!online && (
          <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
            <div className="min-w-0">
              <p className="text-xs font-semibold">Offline transaction mode</p>
              <p className="mt-0.5 text-[11px] leading-5">New income and expenses are encrypted on this device and queued for posting when you reconnect.</p>
            </div>
            <button type="button" onClick={() => navigate('/offline-queue')} className="shrink-0 rounded-lg bg-amber-700 px-3 py-2 text-[11px] font-semibold text-white">View offline queue</button>
          </div>
        )}

        {error && !showForm && (
          <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {success && (
          <div role="status" className="mb-5 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-700">
            {success}
          </div>
        )}

        {/* Summary cards */}
        <div className="mb-8 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">Total Income</p>
              <div className="rounded-lg bg-green-50 p-2 text-green-700">
                <TrendingUp size={19} />
              </div>
            </div>
            <h2 className="mt-3 text-2xl font-bold text-green-700">
              {loading ? 'Loading...' : formatMoney(totalIncome)}
            </h2>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">Total Expenses</p>
              <div className="rounded-lg bg-red-50 p-2 text-red-600">
                <TrendingDown size={19} />
              </div>
            </div>
            <h2 className="mt-3 text-2xl font-bold text-red-600">
              {loading ? 'Loading...' : formatMoney(totalExpenses)}
            </h2>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">Net Cash Flow</p>
              <div className="rounded-lg bg-blue-50 p-2 text-ledger-navy">
                <Wallet size={19} />
              </div>
            </div>
            <h2 className={`mt-3 text-2xl font-bold ${
              netCashFlow >= 0 ? 'text-ledger-navy' : 'text-red-600'
            }`}>
              {loading ? 'Loading...' : formatMoney(netCashFlow)}
            </h2>
          </div>
        </div>

        {/* Quick actions */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => openTransactionForm('income')}
            className="flex items-center justify-between rounded-2xl border border-green-200 bg-green-50 p-5 text-left transition hover:border-green-300 hover:bg-green-100"
          >
            <div>
              <p className="font-semibold text-green-800">Record Income</p>
              <p className="mt-1 text-xs text-green-700">Add salary, freelance income or other receipts</p>
            </div>
            <div className="rounded-xl bg-white p-3 text-green-700">
              <ArrowDownRight size={22} />
            </div>
          </button>

          <button
            type="button"
            onClick={() => openTransactionForm('expense')}
            className="flex items-center justify-between rounded-2xl border border-red-200 bg-red-50 p-5 text-left transition hover:border-red-300 hover:bg-red-100"
          >
            <div>
              <p className="font-semibold text-red-800">Record Expense</p>
              <p className="mt-1 text-xs text-red-700">Add purchases, bills and everyday spending</p>
            </div>
            <div className="rounded-xl bg-white p-3 text-red-700">
              <ArrowUpRight size={22} />
            </div>
          </button>
        </div>

        {/* Transaction history */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
            <div>
              <h2 className="text-lg font-bold text-slate-800">
                Transaction History
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Your posted income and expense records.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading}
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw size={15} />
              Refresh
            </button>
          </div>

          <div className="space-y-3 border-b border-slate-100 p-5">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-200 px-3">
                <Search size={17} className="shrink-0 text-slate-400" />
                <input type="search" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="Search description, payee, category, account or notes…" className="w-full bg-transparent py-3 text-sm outline-none" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select value={filterType} onChange={event => setFilterType(event.target.value as 'all' | 'income' | 'expense')} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none" aria-label="Filter transaction type"><option value="all">All types</option><option value="income">Income</option><option value="expense">Expenses</option></select>
                <select value={filterAccountId} onChange={event => setFilterAccountId(event.target.value)} className="max-w-[190px] rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none" aria-label="Filter account"><option value="all">All accounts</option>{financialAccounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select>
                <select value={filterCategoryId} onChange={event => setFilterCategoryId(event.target.value)} className="max-w-[190px] rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none" aria-label="Filter category"><option value="all">All categories</option>{accounts.filter(account => account.account_kind === 'category').map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
                <select value={filterTag} onChange={event => setFilterTag(event.target.value)} className="max-w-[160px] rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none" aria-label="Filter tag"><option value="all">All tags</option>{tagOptions.map(tag => <option key={tag} value={tag}>{tag}</option>)}</select>
                <select value={filterGroup} onChange={event => setFilterGroup(event.target.value)} className="max-w-[160px] rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none" aria-label="Filter group"><option value="all">All groups</option>{groupOptions.map(group => <option key={group} value={group}>{group}</option>)}</select>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium text-slate-400">Date:</span>
                <button type="button" onClick={() => applyDatePreset('this_month')} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50">This month</button>
                <button type="button" onClick={() => applyDatePreset('last_month')} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50">Last month</button>
                <button type="button" onClick={() => applyDatePreset('this_year')} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50">This year</button>
                <input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none" aria-label="From date" title="From date" />
                <input type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none" aria-label="To date" title="To date" />
                <button type="button" onClick={resetFilters} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-slate-500 hover:bg-slate-50"><RotateCcw size={12}/>Clear</button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select defaultValue="" onChange={event => applySavedView(event.target.value)} className="max-w-[170px] rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-600 outline-none"><option value="">Saved views</option>{savedViews.map(view => <option key={view.id} value={view.id}>{view.name}</option>)}</select>
                <button type="button" onClick={saveCurrentView} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Save size={13}/>Save view</button>
                <select value={sortBy} onChange={event => setSortBy(event.target.value as typeof sortBy)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-600 outline-none"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="highest">Highest amount</option><option value="lowest">Lowest amount</option></select>
                <div className="inline-flex rounded-lg border border-slate-200 p-1"><button type="button" onClick={() => setViewMode('table')} aria-pressed={viewMode === 'table'} className={`rounded-md p-1.5 ${viewMode === 'table' ? 'bg-slate-100 text-slate-800' : 'text-slate-400'}`} title="Table view"><Table2 size={15}/></button><button type="button" onClick={() => setViewMode('list')} aria-pressed={viewMode === 'list'} className={`rounded-md p-1.5 ${viewMode === 'list' ? 'bg-slate-100 text-slate-800' : 'text-slate-400'}`} title="List view"><List size={15}/></button></div>
              </div>
            </div>
          </div>


          {selectedTransactionIds.length > 0 && (
            <div className="space-y-3 border-b border-[var(--ledger-border)] bg-[var(--ledger-accent-soft)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ledger-heading)]"><CheckSquare size={16}/>{selectedTransactionIds.length} selected</div>
                <button type="button" onClick={() => setSelectedTransactionIds([])} className="text-xs font-semibold text-[var(--ledger-accent)] hover:underline">Clear selection</button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 rounded-lg border border-[var(--ledger-border)] bg-white px-2.5 py-1.5"><Tag size={13} className="text-[var(--ledger-accent)]"/><input value={bulkTagInput} onChange={event => setBulkTagInput(event.target.value)} maxLength={32} placeholder="Add tag" className="w-28 bg-transparent text-xs outline-none"/><button type="button" onClick={handleAddBulkTag} disabled={!online || bulkSaving || !bulkTagInput.trim()} className="text-xs font-semibold text-[var(--ledger-accent)] disabled:opacity-40">Add</button></div>
                <div className="flex items-center gap-1.5 rounded-lg border border-[var(--ledger-border)] bg-white px-2.5 py-1.5"><select value={bulkRemoveTag} onChange={event => setBulkRemoveTag(event.target.value)} className="max-w-32 bg-transparent text-xs outline-none"><option value="">Remove tag…</option>{tagOptions.map(tag => <option key={tag} value={tag}>{tag}</option>)}</select><button type="button" onClick={handleRemoveBulkTag} disabled={!online || bulkSaving || !bulkRemoveTag} className="text-xs font-semibold text-rose-700 disabled:opacity-40">Remove</button></div>
                <div className="flex items-center gap-1.5 rounded-lg border border-[var(--ledger-border)] bg-white px-2.5 py-1.5"><FolderOpen size={13} className="text-[var(--ledger-accent)]"/><input value={bulkGroupInput} onChange={event => setBulkGroupInput(event.target.value)} maxLength={80} list="ledger-transaction-groups" placeholder="Group name" className="w-32 bg-transparent text-xs outline-none"/><datalist id="ledger-transaction-groups">{groupOptions.map(group => <option key={group} value={group}/>)}</datalist><button type="button" onClick={handleAssignBulkGroup} disabled={!online || bulkSaving || !bulkGroupInput.trim()} className="text-xs font-semibold text-[var(--ledger-accent)] disabled:opacity-40">Assign</button></div>
                <button type="button" onClick={handleClearBulkGroup} disabled={!online || bulkSaving} className="rounded-lg border border-[var(--ledger-border)] bg-white px-2.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">Clear group</button>
                <button type="button" onClick={() => exportTransactions(selectedTransactions, 'Selected_Transactions')} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ledger-border)] bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Download size={13}/>Export</button>
              </div>
              <p className="text-[10px] leading-4 text-[var(--ledger-text)]">Tags and groups are organizational metadata only. They do not alter posted accounting entries or balances.</p>
            </div>
          )}

          {loading ? (
            <div className="p-12 text-center text-sm text-slate-500">
              Loading transactions...
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="p-12 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                <SlidersHorizontal size={25} />
              </div>
              <h3 className="mt-4 font-semibold text-slate-700">
                {transactions.length === 0
                  ? 'No transactions yet'
                  : 'No matching transactions'}
              </h3>
              <p className="mt-2 text-sm text-slate-500">
                {transactions.length === 0
                  ? 'Record your first income or expense to get started.'
                  : 'Try changing your search or filters.'}
              </p>
              {transactions.length === 0 && (
                <button
                  type="button"
                  onClick={() => openTransactionForm('expense')}
                  className="mt-5 rounded-xl bg-ledger-navy px-5 py-3 text-sm font-semibold text-white"
                >
                  Add Your First Transaction
                </button>
              )}
            </div>
          ) : (
            <>
              {viewMode === 'table' ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-left">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-4"><input type="checkbox" checked={allVisibleSelected} onChange={event => toggleVisibleSelection(event.target.checked)} aria-label="Select all visible transactions" /></th>
                        <th className="px-4 py-4 font-semibold">Date</th>
                        <th className="px-4 py-4 font-semibold">Description</th>
                        <th className="px-4 py-4 font-semibold">Category</th>
                        <th className="px-4 py-4 font-semibold">Account</th>
                        <th className="px-4 py-4 font-semibold">Tags / Group</th>
                        <th className="px-4 py-4 text-right font-semibold">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredTransactions.map(transaction => (
                        <tr key={transaction.id} data-type={transaction.type} className="ledger-transaction-row hover:bg-slate-50/70">
                          <td className="px-4 py-4"><input type="checkbox" checked={selectedTransactionIds.includes(transaction.id)} onChange={() => toggleTransactionSelection(transaction.id)} aria-label={`Select ${transaction.description}`} /></td>
                          <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-500">{formatLedgerDate(transaction.date)}</td>
                          <td className="px-4 py-4">
                            <div className="flex items-start gap-2.5">
                              <span data-type={transaction.type} className="ledger-entry-marker mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                                {transaction.type === 'income' ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
                              </span>
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-800">{transaction.description}</p>
                                {transaction.payee && <p className="mt-1 text-xs text-slate-500">{transaction.payee}</p>}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <span data-tone={categoryColorTone(transaction.categoryId, transaction.categoryName)} className="ledger-category-chip">{transaction.categoryName}</span>
                          </td>
                          <td className="px-4 py-4 text-sm text-slate-600">{transaction.accountName}</td>
                          <td className="px-4 py-4"><div className="flex max-w-[220px] flex-wrap gap-1">{transaction.tags.map(tag => <span key={tag} className="rounded-full bg-[var(--ledger-accent-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--ledger-accent)]">{tag}</span>)}{transaction.groupName && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{transaction.groupName}</span>}{!transaction.tags.length && !transaction.groupName && <span className="text-xs text-slate-300">—</span>}</div></td>
                          <td className={`whitespace-nowrap px-4 py-4 text-right text-sm font-bold ${transaction.type === 'income' ? 'text-green-700' : 'text-red-600'}`}>{transaction.type === 'income' ? '+' : '−'}{formatMoney(transaction.amountMinor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {filteredTransactions.map(transaction => (
                    <div key={transaction.id} data-type={transaction.type} className="ledger-transaction-list-row flex items-center justify-between gap-3 p-4 transition hover:bg-slate-50/70">
                      <div className="flex min-w-0 items-center gap-3">
                        <input type="checkbox" checked={selectedTransactionIds.includes(transaction.id)} onChange={() => toggleTransactionSelection(transaction.id)} aria-label={`Select ${transaction.description}`} />
                        <span data-type={transaction.type} className="ledger-entry-marker flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">{transaction.type === 'income' ? <TrendingUp size={17}/> : <TrendingDown size={17}/>}</span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-800">{transaction.description}</p>
                          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                            <span data-tone={categoryColorTone(transaction.categoryId, transaction.categoryName)} className="ledger-category-chip ledger-category-chip-small">{transaction.categoryName}</span>
                            <span className="truncate text-xs text-slate-500">{transaction.accountName}{transaction.payee ? ` · ${transaction.payee}` : ''}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">{transaction.tags.map(tag => <span key={tag} className="rounded-full bg-[var(--ledger-accent-soft)] px-1.5 py-0.5 text-[9px] text-[var(--ledger-accent)]">{tag}</span>)}{transaction.groupName && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-600">{transaction.groupName}</span>}</div>
                          <p className="mt-1 text-[11px] text-slate-400">{formatLedgerDate(transaction.date)}</p>
                        </div>
                      </div>
                      <strong className={`shrink-0 text-sm tabular-nums ${transaction.type === 'income' ? 'text-green-700' : 'text-red-600'}`}>{transaction.type === 'income' ? '+' : '−'}{formatMoney(transaction.amountMinor)}</strong>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">
            Showing {filteredTransactions.length} of {transactions.length} loaded transactions.
          </div>
        </div>
      </div>

      {/* Add transaction modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-6 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-slate-800">
                  Add Transaction
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Record an income or expense in your accounts.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false)
                  setError('')
                }}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
                aria-label="Close transaction form"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mb-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setTransactionType('income')
                  setSelectedCategoryId('')
                }}
                className={`flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-semibold ${
                  transactionType === 'income'
                    ? 'border-green-300 bg-green-50 text-green-800'
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                <TrendingUp size={17} />
                Income
              </button>
              <button
                type="button"
                onClick={() => {
                  setTransactionType('expense')
                  setSelectedCategoryId('')
                }}
                className={`flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-semibold ${
                  transactionType === 'expense'
                    ? 'border-red-300 bg-red-50 text-red-800'
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                <TrendingDown size={17} />
                Expense
              </button>
            </div>

            {error && (
              <div role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={handleCreateTransaction} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Amount (BDT)
                </label>
                <div className="flex items-center rounded-xl border border-slate-200 px-4 focus-within:border-ledger-navy">
                  <span className="text-lg font-semibold text-slate-400">৳</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    required
                    value={amount}
                    onChange={event => setAmount(event.target.value)}
                    placeholder="0.00"
                    className="w-full bg-transparent px-3 py-3 text-lg font-semibold outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Category
                </label>
                <div className="flex gap-2">
                  <select
                    required
                    value={selectedCategoryId}
                    onChange={event => setSelectedCategoryId(event.target.value)}
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-ledger-navy"
                  >
                    <option value="">Select category</option>
                    {availableCategories.map(category => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCategoryForm(value => !value)
                      setCategoryError('')
                    }}
                    disabled={!online}
                    title={!online ? 'Categories must be created while online.' : undefined}
                    className="flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 px-3 text-sm font-medium text-ledger-navy hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus size={16} />
                    Add
                  </button>
                </div>

                {showCategoryForm && (
                  <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3">
                    <label className="mb-2 block text-xs font-semibold text-slate-700">
                      New {transactionType} category
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        maxLength={60}
                        value={newCategoryName}
                        onChange={event => setNewCategoryName(event.target.value)}
                        placeholder="Enter category name"
                        className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void handleCreateCategory()}
                        disabled={categorySaving}
                        className="rounded-lg bg-ledger-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {categorySaving ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                    {categoryError && (
                      <p role="alert" className="mt-2 text-xs text-red-600">
                        {categoryError}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  {transactionType === 'income' ? 'Received Into' : 'Paid From'}
                </label>
                <select
                  required
                  value={selectedAccountId}
                  onChange={event => setSelectedAccountId(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-ledger-navy"
                >
                  <option value="">Select account</option>
                  {availableAccounts.map(account => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                      {account.account_type === 'liability' ? ' (Credit)' : ''}
                    </option>
                  ))}
                </select>
                {availableAccounts.length === 0 && (
                  <p className="mt-2 text-xs text-amber-700">
                    {transactionType === 'income'
                      ? 'Create an asset account before recording income.'
                      : 'Create a bank, cash, wallet or credit account before recording expenses.'}
                  </p>
                )}
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Date
                </label>
                <div className="flex items-center rounded-xl border border-slate-200 px-3">
                  <CalendarDays size={17} className="text-slate-400" />
                  <input
                    type="date"
                    required
                    value={entryDate}
                    onChange={event => setEntryDate(event.target.value)}
                    className="w-full bg-transparent px-3 py-3 text-sm outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Description
                </label>
                <input
                  type="text"
                  maxLength={200}
                  value={description}
                  onChange={event => setDescription(event.target.value)}
                  placeholder={transactionType === 'income' ? 'e.g. Monthly salary' : 'e.g. Grocery shopping'}
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-ledger-navy"
                />
              </div>

              <button type="button" onClick={() => setShowMoreDetails(value => !value)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"><ChevronDown size={14} className={`transition-transform ${showMoreDetails ? 'rotate-180' : ''}`}/>{showMoreDetails ? 'Hide optional details' : 'More details (payee and notes)'}</button>
              {showMoreDetails && <>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  {transactionType === 'income' ? 'Received From' : 'Payee / Merchant'}
                  <span className="ml-1 font-normal text-slate-400">(Optional)</span>
                </label>
                <input
                  type="text"
                  list="ledger-known-payees"
                  maxLength={120}
                  value={payee}
                  onChange={event => setPayee(event.target.value)}
                  placeholder={transactionType === 'income' ? 'Person or organization' : 'Shop, person or organization'}
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-ledger-navy"
                />
                <datalist id="ledger-known-payees">{knownPayees.map(name => <option key={name} value={name}/>)}</datalist>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Notes <span className="font-normal text-slate-400">(Optional)</span>
                </label>
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={notes}
                  onChange={event => setNotes(event.target.value)}
                  placeholder="Additional details..."
                  className="w-full resize-y rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-ledger-navy"
                />
              </div>
              </>}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false)
                    setError('')
                  }}
                  className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || availableAccounts.length === 0 || availableCategories.length === 0}
                  className="flex-1 rounded-xl bg-ledger-navy py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Transaction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showSaveViewModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div><h3 className="text-base font-bold text-slate-800">Save transaction view</h3><p className="mt-1 text-xs text-slate-500">Save your current filters for quick access later.</p></div>
              <button type="button" onClick={() => setShowSaveViewModal(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close save view dialog"><X size={18}/></button>
            </div>
            <label className="block text-xs font-semibold text-slate-700">View name<input autoFocus maxLength={40} value={newViewName} onChange={event => setNewViewName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') confirmSaveView() }} placeholder="e.g. Monthly groceries" className="mt-2 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-indigo-300"/></label>
            <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setShowSaveViewModal(false)} className="rounded-lg border border-slate-200 px-3.5 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Cancel</button><button type="button" onClick={confirmSaveView} disabled={!newViewName.trim()} className="rounded-lg bg-ledger-navy px-3.5 py-2.5 text-xs font-semibold text-white disabled:opacity-40">Save view</button></div>
          </div>
        </div>
      )}

      {showImportWizard && online && (
        <TransactionImportWizard
          accounts={accounts}
          onClose={() => setShowImportWizard(false)}
          onImported={async () => {
            await loadData()
            setSuccess('Imported transactions have been added to your Ledger records.')
          }}
        />
      )}
    </div>
  )
}
