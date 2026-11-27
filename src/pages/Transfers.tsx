import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'
import {
  ArrowDownUp,
  CalendarDays,
  Landmark,
  RefreshCw,
  Search,
  Smartphone,
  Wallet,
  X,
  Plus,
  History,
  CircleDollarSign,
} from 'lucide-react'

import { supabase } from '../lib/supabase'
import { usePwa } from '../context/PwaContext'
import { getOfflineProjectedBalance } from '../lib/offlineVault'
import { useAuth } from '../context/AuthContext'
import { formatBDTCurrencyMinor, formatLedgerDate } from '../lib/preferences'
import { useNavigate, useSearchParams } from 'react-router-dom'

type LedgerAccount = {
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
  transaction_type: string
  description: string | null
  notes: string | null
  status: string
  created_at: string
}

type JournalLine = {
  journal_entry_id: string
  ledger_account_id: string
  debit_minor: number | string
  credit_minor: number | string
}

type Transfer = {
  id: string
  date: string
  description: string
  notes: string
  amountMinor: number
  fromAccount: string
  toAccount: string
}

const PAGE_SIZE = 1000

const formatMoney = (minor: number) => formatBDTCurrencyMinor(minor)

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

function AccountIcon({ subtype }: { subtype: string | null }) {
  const value = (subtype || '').toLowerCase()

  if (
    value.includes('mobile') ||
    value.includes('bkash') ||
    value.includes('nagad') ||
    value.includes('wallet')
  ) {
    return <Smartphone size={19} />
  }

  if (value.includes('cash')) {
    return <Wallet size={19} />
  }

  return <Landmark size={19} />
}

export default function Transfers() {
  const { user } = useAuth()
  const { online, offlineSnapshot, offlineVaultUnlocked, offlineVaultUserId, enqueueOfflineTransaction } = usePwa()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [accounts, setAccounts] = useState<LedgerAccount[]>([])
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [fromAccountId, setFromAccountId] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [entryDate, setEntryDate] = useState(getLocalDate())
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')

  const [searchTerm, setSearchTerm] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const assetAccounts = useMemo(
    () =>
      accounts.filter(
        account =>
          account.account_kind === 'financial' &&
          account.account_type === 'asset' &&
          account.is_active
      ),
    [accounts]
  )

  const selectedFromAccount = assetAccounts.find(
    account => account.id === fromAccountId
  )

  const selectedToAccount = assetAccounts.find(
    account => account.id === toAccountId
  )

  const loadData = useCallback(async () => {
    if (!user?.id) {
      setAccounts([])
      setBalances({})
      setTransfers([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')

    if (!online) {
      if (!offlineVaultUnlocked || offlineVaultUserId !== user.id || !offlineSnapshot) {
        setAccounts([])
        setBalances({})
        setTransfers([])
        setError('Unlock your encrypted offline vault to view cached account balances and create transfers.')
        setLoading(false)
        return
      }

      const cachedAccounts: LedgerAccount[] = offlineSnapshot.accounts.map(account => ({
        id: account.id,
        name: account.name,
        account_kind: 'financial',
        account_type: account.accountType,
        subtype: account.subtype,
        is_active: account.isActive,
      }))
      const cachedBalances: Record<string, number> = {}
      for (const account of offlineSnapshot.accounts) {
        cachedBalances[account.id] = getOfflineProjectedBalance(offlineSnapshot, account.id)
      }
      setAccounts(cachedAccounts)
      setBalances(cachedBalances)
      setTransfers([])
      setLoading(false)
      return
    }

    try {
      // Load financial accounts, including inactive accounts for old history.
      const { data: accountData, error: accountError } = await supabase
        .from('ledger_accounts')
        .select('id, name, account_kind, account_type, subtype, is_active')
        .eq('account_kind', 'financial')
        .order('name', { ascending: true })

      if (accountError) throw accountError

      const accountList = (accountData || []) as LedgerAccount[]
      setAccounts(accountList)

      // Load posted journal entry IDs for account balance calculations.
      const allPostedEntries: { id: string }[] = []

      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error: postedError } = await supabase
          .from('journal_entries')
          .select('id')
          .eq('status', 'posted')
          .range(offset, offset + PAGE_SIZE - 1)

        if (postedError) throw postedError

        const page = data || []
        allPostedEntries.push(...page)

        if (page.length < PAGE_SIZE) break
      }

      const nextBalances: Record<string, number> = {}
      accountList.forEach(account => {
        nextBalances[account.id] = 0
      })

      // Read journal lines in batches to avoid oversized IN requests.
      const postedIds = allPostedEntries.map(entry => entry.id)

      for (let offset = 0; offset < postedIds.length; offset += 300) {
        const batchIds = postedIds.slice(offset, offset + 300)

        const { data: lineData, error: lineError } = await supabase
          .from('journal_lines')
          .select('ledger_account_id, debit_minor, credit_minor')
          .in('journal_entry_id', batchIds)

        if (lineError) throw lineError

        for (const line of (lineData || []) as {
          ledger_account_id: string
          debit_minor: number | string
          credit_minor: number | string
        }[]) {
          const account = accountList.find(
            item => item.id === line.ledger_account_id
          )

          if (!account) continue

          const debit = Number(line.debit_minor)
          const credit = Number(line.credit_minor)

          const movement =
            account.account_type === 'asset' || account.account_type === 'expense'
              ? debit - credit
              : credit - debit

          nextBalances[account.id] =
            (nextBalances[account.id] || 0) + movement
        }
      }

      setBalances(nextBalances)

      // Load posted transfer entries.
      const { data: transferData, error: transferError } = await supabase
        .from('journal_entries')
        .select('id, entry_date, transaction_type, description, notes, status, created_at')
        .eq('status', 'posted')
        .eq('transaction_type', 'transfer')
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1000)

      if (transferError) throw transferError

      const entryList = (transferData || []) as JournalEntry[]

      if (entryList.length === 0) {
        setTransfers([])
        return
      }

      const transferIds = entryList.map(entry => entry.id)
      const transferLines: JournalLine[] = []

      for (let offset = 0; offset < transferIds.length; offset += 300) {
        const batchIds = transferIds.slice(offset, offset + 300)

        const { data: lineData, error: lineError } = await supabase
          .from('journal_lines')
          .select('journal_entry_id, ledger_account_id, debit_minor, credit_minor')
          .in('journal_entry_id', batchIds)

        if (lineError) throw lineError
        transferLines.push(...((lineData || []) as JournalLine[]))
      }

      const accountMap = new Map(
        accountList.map(account => [account.id, account])
      )

      const linesByEntry = new Map<string, JournalLine[]>()

      for (const line of transferLines) {
        const existing = linesByEntry.get(line.journal_entry_id) || []
        existing.push(line)
        linesByEntry.set(line.journal_entry_id, existing)
      }

      const mappedTransfers: Transfer[] = entryList.map(entry => {
        const lines = linesByEntry.get(entry.id) || []

        // The transfer function debits the destination and credits the source.
        const sourceLine = lines.find(line => Number(line.credit_minor) > 0)
        const destinationLine = lines.find(line => Number(line.debit_minor) > 0)

        const source = sourceLine
          ? accountMap.get(sourceLine.ledger_account_id)
          : undefined

        const destination = destinationLine
          ? accountMap.get(destinationLine.ledger_account_id)
          : undefined

        return {
          id: entry.id,
          date: entry.entry_date,
          description: entry.description || 'Account Transfer',
          notes: entry.notes || '',
          amountMinor: sourceLine ? Number(sourceLine.credit_minor) : 0,
          fromAccount: source?.name || 'Account unavailable',
          toAccount: destination?.name || 'Account unavailable',
        }
      })

      setTransfers(mappedTransfers)
    } catch (err) {
      console.error('Transfer loading error:', err)
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load account transfers.'
      )
    } finally {
      setLoading(false)
    }
  }, [user?.id, online, offlineSnapshot, offlineVaultUnlocked, offlineVaultUserId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    if (!assetAccounts.some(account => account.id === fromAccountId)) {
      setFromAccountId(assetAccounts[0]?.id || '')
    }
  }, [assetAccounts, fromAccountId])

  useEffect(() => {
    const availableDestinations = assetAccounts.filter(
      account => account.id !== fromAccountId
    )

    if (!availableDestinations.some(account => account.id === toAccountId)) {
      setToAccountId(availableDestinations[0]?.id || '')
    }
  }, [assetAccounts, fromAccountId, toAccountId])

  const totalMoved = transfers.reduce(
    (sum, transfer) => sum + transfer.amountMinor,
    0
  )

  const filteredTransfers = transfers.filter(transfer => {
    const searchable = [
      transfer.description,
      transfer.fromAccount,
      transfer.toAccount,
      transfer.notes,
    ]
      .join(' ')
      .toLowerCase()

    return (
      searchable.includes(searchTerm.toLowerCase()) &&
      (!dateFrom || transfer.date >= dateFrom) &&
      (!dateTo || transfer.date <= dateTo)
    )
  })

  const resetForm = () => {
    setAmount('')
    setEntryDate(getLocalDate())
    setDescription('')
    setNotes('')
    setError('')
  }

  const openTransferForm = () => {
    resetForm()
    setSuccess('')
    setShowForm(true)
  }

  useEffect(() => {
    if (searchParams.get('new') === 'transfer') {
      openTransferForm()
      setSearchParams({}, { replace: true })
    }
    // The query parameter is a one-time command to open the transfer form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams])

  const handleCreateTransfer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setSuccess('')

    if (assetAccounts.length < 2) {
      setError('You need at least two active asset accounts to make a transfer.')
      return
    }

    if (!fromAccountId || !toAccountId) {
      setError('Please select both source and destination accounts.')
      return
    }

    if (fromAccountId === toAccountId) {
      setError('Source and destination accounts must be different.')
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
          operation: 'transfer',
          fromAccountId,
          toAccountId,
          amountMinor,
          date: entryDate,
          description,
          notes,
        })
        setShowForm(false)
        resetForm()
        setSuccess('Transfer saved securely on this device. It will be validated and posted when your connection returns.')
        return
      }

      const { error: transferError } = await supabase.rpc(
        'create_account_transfer',
        {
          p_from_account_id: fromAccountId,
          p_to_account_id: toAccountId,
          p_amount_minor: amountMinor,
          p_entry_date: entryDate,
          p_description: description.trim() || null,
          p_notes: notes.trim() || null,
        }
      )

      if (transferError) throw transferError

      setShowForm(false)
      resetForm()
      setSuccess('Transfer recorded successfully.')

      await loadData()
    } catch (err) {
      console.error('Transfer creation error:', err)
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to record this transfer.'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-ledger-bg p-5 md:p-8">
      <div className="mx-auto max-w-7xl">

        {/* Page heading */}
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">
              Account Transfers
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Move money between your own bank accounts, wallets and cash.
            </p>
          </div>

          <button
            type="button"
            onClick={openTransferForm}
            disabled={assetAccounts.length < 2}
            className="flex items-center gap-2 rounded-xl bg-ledger-navy px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={18} />
            New Transfer
          </button>
        </div>

        {!online && (
          <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
            <div className="min-w-0">
              <p className="text-xs font-semibold">Offline transfer mode</p>
              <p className="mt-0.5 text-[11px] leading-5">Cached balances include queued transactions. Existing transfer history is not included in this offline view; the server revalidates available funds before posting each new transfer.</p>
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

        {/* Summary */}
        <div className="mb-8 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">Active Asset Accounts</p>
              <div className="rounded-lg bg-blue-50 p-2 text-ledger-navy">
                <Wallet size={19} />
              </div>
            </div>
            <h2 className="mt-3 text-2xl font-bold text-slate-800">
              {loading ? '—' : assetAccounts.length}
            </h2>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">Recorded Transfers</p>
              <div className="rounded-lg bg-violet-50 p-2 text-violet-700">
                <History size={19} />
              </div>
            </div>
            <h2 className="mt-3 text-2xl font-bold text-slate-800">
              {loading ? '—' : transfers.length}
            </h2>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">Total Amount Moved</p>
              <div className="rounded-lg bg-green-50 p-2 text-green-700">
                <CircleDollarSign size={19} />
              </div>
            </div>
            <h2 className="mt-3 text-2xl font-bold text-slate-800">
              {loading ? 'Loading...' : formatMoney(totalMoved)}
            </h2>
          </div>
        </div>

        {/* Account balances */}
        <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-slate-800">Your Asset Accounts</h2>
              <p className="mt-1 text-xs text-slate-500">
                Current balances available for internal transfers.
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

          {loading ? (
            <p className="py-6 text-center text-sm text-slate-500">
              Loading account balances...
            </p>
          ) : assetAccounts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center">
              <Wallet size={30} className="mx-auto text-slate-300" />
              <p className="mt-3 font-semibold text-slate-700">
                No active asset accounts
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Create at least two asset accounts in Accounts before transferring money.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {assetAccounts.map(account => (
                <div
                  key={account.id}
                  className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-ledger-navy shadow-sm">
                    <AccountIcon subtype={account.subtype} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {account.name}
                    </p>
                    <p className="mt-1 text-xs capitalize text-slate-500">
                      {(account.subtype || 'account').replaceAll('_', ' ')}
                    </p>
                    <p className="mt-2 text-sm font-bold text-slate-800">
                      {formatMoney(balances[account.id] || 0)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Transfer history */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
            <div>
              <h2 className="text-lg font-bold text-slate-800">
                Transfer History
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Review money moved between your accounts.
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

          <div className="grid gap-3 border-b border-slate-100 p-5 md:grid-cols-[1fr_auto_auto]">
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3">
              <Search size={17} className="shrink-0 text-slate-400" />
              <input
                type="search"
                value={searchTerm}
                onChange={event => setSearchTerm(event.target.value)}
                placeholder="Search accounts or description..."
                className="w-full bg-transparent py-3 text-sm outline-none"
              />
            </div>
            <input
              type="date"
              value={dateFrom}
              onChange={event => setDateFrom(event.target.value)}
              aria-label="From date"
              title="From date"
              className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none"
            />
            <input
              type="date"
              value={dateTo}
              onChange={event => setDateTo(event.target.value)}
              aria-label="To date"
              title="To date"
              className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none"
            />
          </div>

          {loading ? (
            <div className="p-12 text-center text-sm text-slate-500">
              Loading transfer history...
            </div>
          ) : filteredTransfers.length === 0 ? (
            <div className="p-12 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                <ArrowDownUp size={25} />
              </div>
              <h3 className="mt-4 font-semibold text-slate-700">
                {transfers.length === 0
                  ? 'No transfers yet'
                  : 'No matching transfers'}
              </h3>
              <p className="mt-2 text-sm text-slate-500">
                {transfers.length === 0
                  ? 'Your internal account transfers will appear here.'
                  : 'Try changing your search or date filters.'}
              </p>
              {transfers.length === 0 && assetAccounts.length >= 2 && (
                <button
                  type="button"
                  onClick={openTransferForm}
                  className="mt-5 rounded-xl bg-ledger-navy px-5 py-3 text-sm font-semibold text-white"
                >
                  Make Your First Transfer
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-4 font-semibold">Date</th>
                      <th className="px-5 py-4 font-semibold">From</th>
                      <th className="px-5 py-4 font-semibold">To</th>
                      <th className="px-5 py-4 font-semibold">Description</th>
                      <th className="px-5 py-4 text-right font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredTransfers.map(transfer => (
                      <tr key={transfer.id} className="hover:bg-slate-50/70">
                        <td className="whitespace-nowrap px-5 py-4 text-sm text-slate-500">
                          {formatLedgerDate(transfer.date)}
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-700">
                          {transfer.fromAccount}
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-700">
                          {transfer.toAccount}
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-600">
                          {transfer.description}
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 text-right text-sm font-bold text-slate-800">
                          {formatMoney(transfer.amountMinor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="divide-y divide-slate-100 md:hidden">
                {filteredTransfers.map(transfer => (
                  <div key={transfer.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-800">
                          {transfer.description}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {transfer.fromAccount} → {transfer.toAccount}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          {formatLedgerDate(transfer.date)}
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-bold text-slate-800">
                        {formatMoney(transfer.amountMinor)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">
            Showing {filteredTransfers.length} of {transfers.length} loaded transfers.
          </div>
        </section>
      </div>

      {/* New transfer modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-6 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-slate-800">
                  Transfer Money
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Move funds between two of your own asset accounts.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false)
                  setError('')
                }}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
                aria-label="Close transfer form"
              >
                <X size={20} />
              </button>
            </div>

            {error && (
              <div role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={handleCreateTransfer} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  From Account
                </label>
                <select
                  required
                  value={fromAccountId}
                  onChange={event => setFromAccountId(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-ledger-navy"
                >
                  <option value="">Select source account</option>
                  {assetAccounts.map(account => (
                    <option key={account.id} value={account.id}>
                      {account.name} — {formatMoney(balances[account.id] || 0)}
                    </option>
                  ))}
                </select>
                {selectedFromAccount && (
                  <p className="mt-1 text-xs text-slate-500">
                    Current balance: {formatMoney(balances[selectedFromAccount.id] || 0)}
                  </p>
                )}
              </div>

              <div className="flex justify-center">
                <div className="rounded-full border border-slate-200 bg-slate-50 p-2 text-ledger-navy">
                  <ArrowDownUp size={20} />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  To Account
                </label>
                <select
                  required
                  value={toAccountId}
                  onChange={event => setToAccountId(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-ledger-navy"
                >
                  <option value="">Select destination account</option>
                  {assetAccounts
                    .filter(account => account.id !== fromAccountId)
                    .map(account => (
                      <option key={account.id} value={account.id}>
                        {account.name} — {formatMoney(balances[account.id] || 0)}
                      </option>
                    ))}
                </select>
                {selectedToAccount && (
                  <p className="mt-1 text-xs text-slate-500">
                    Current balance: {formatMoney(balances[selectedToAccount.id] || 0)}
                  </p>
                )}
              </div>

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
                  Transfer Date
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
                  placeholder="e.g. Transfer from DBBL to bKash"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-ledger-navy"
                />
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
                  placeholder="Additional transfer details..."
                  className="w-full resize-y rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-ledger-navy"
                />
              </div>

              <div className="rounded-xl bg-blue-50 p-3 text-xs leading-5 text-blue-800">
                Transfers are recorded as internal movements. They do not count as income or expenses. The amount is recorded in both accounts through a balanced journal entry.
              </div>

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
                  disabled={
                    saving ||
                    assetAccounts.length < 2 ||
                    !fromAccountId ||
                    !toAccountId ||
                    fromAccountId === toAccountId
                  }
                  className="flex-1 rounded-xl bg-ledger-navy py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? 'Processing...' : 'Confirm Transfer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
