import { useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowDownUp,
  CheckCircle2,
  Clock3,
  CloudUpload,
  Database,
  RefreshCw,
  RotateCcw,
  Trash2,
  TrendingDown,
  TrendingUp,
  WifiOff,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePwa } from '../context/PwaContext'
import { formatBDTCurrencyMinor, formatLedgerDate } from '../lib/preferences'
import type { PendingOfflineTransaction } from '../lib/offlineVault'

function statusStyle(status: PendingOfflineTransaction['status']) {
  if (status === 'synced') return 'bg-emerald-50 text-emerald-700'
  if (status === 'failed') return 'bg-rose-50 text-rose-700'
  if (status === 'syncing') return 'bg-blue-50 text-blue-700'
  return 'bg-amber-50 text-amber-800'
}

function statusLabel(status: PendingOfflineTransaction['status']) {
  if (status === 'synced') return 'Synced'
  if (status === 'failed') return 'Needs attention'
  if (status === 'syncing') return 'Synchronizing'
  return 'Pending'
}

export default function OfflineTransactions() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const {
    online,
    offlineVaultUnlocked,
    offlineVaultUserId,
    offlineSnapshot,
    syncPendingTransactions,
    retryOfflineTransaction,
    removePendingOfflineTransaction,
  } = usePwa()
  const [busyId, setBusyId] = useState('')
  const [syncingAll, setSyncingAll] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const vaultReady = Boolean(
    user?.id &&
    offlineVaultUnlocked &&
    offlineVaultUserId === user.id &&
    offlineSnapshot
  )
  const queue = useMemo(
    () => [...(offlineSnapshot?.pendingTransactions || [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [offlineSnapshot?.pendingTransactions]
  )
  const pendingCount = queue.filter(item => item.status === 'pending').length
  const failedCount = queue.filter(item => item.status === 'failed').length
  const syncingCount = queue.filter(item => item.status === 'syncing').length
  const syncedCount = queue.filter(item => item.status === 'synced').length

  const accountName = (id: string | null) =>
    id ? offlineSnapshot?.accounts.find(account => account.id === id)?.name || 'Account unavailable' : '—'
  const categoryName = (id: string | null) =>
    id ? offlineSnapshot?.categories?.find(category => category.id === id)?.name || 'Category unavailable' : '—'

  const handleSyncAll = async () => {
    if (!user?.id) return
    setError('')
    setMessage('')
    setSyncingAll(true)
    try {
      const attempted = await syncPendingTransactions(user.id)
      setMessage(attempted ? 'Synchronization attempt completed. Review the status of each item below.' : 'There are no pending transactions to synchronize.')
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Unable to synchronize pending transactions.')
    } finally {
      setSyncingAll(false)
    }
  }

  const handleRetry = async (item: PendingOfflineTransaction) => {
    setBusyId(item.id)
    setError('')
    setMessage('')
    try {
      await retryOfflineTransaction(item.id)
      setMessage('Retry submitted using the original idempotency key.')
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : 'Unable to retry this transaction.')
    } finally {
      setBusyId('')
    }
  }

  const handleRemove = async (item: PendingOfflineTransaction) => {
    if (!window.confirm('Remove this local transaction draft? This does not affect posted cloud transactions.')) return
    setBusyId(item.id)
    setError('')
    setMessage('')
    try {
      await removePendingOfflineTransaction(item.id)
      setMessage('Local transaction draft removed.')
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Unable to remove this transaction.')
    } finally {
      setBusyId('')
    }
  }

  return (
    <div className="min-h-screen bg-ledger-bg p-5 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ledger-muted)]">Offline 3.0</p>
            <h1 className="text-2xl font-bold text-[var(--ledger-heading)]">Pending transactions</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--ledger-muted)]">
              Review transactions saved in your encrypted local queue. They are posted only after the server validates them.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleSyncAll()}
            disabled={!vaultReady || !online || pendingCount === 0 || syncingAll}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--ledger-accent)] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {syncingAll ? <RefreshCw size={16} className="animate-spin" /> : <CloudUpload size={16} />}
            Synchronize pending
          </button>
        </div>

        {!online && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
            <WifiOff size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold">You're offline</p>
              <p className="mt-1 text-[11px] leading-5">Transactions are safely stored in the encrypted vault. Synchronization will start when the connection returns.</p>
            </div>
          </div>
        )}

        {!vaultReady ? (
          <section className="rounded-2xl border border-[var(--ledger-border)] bg-[var(--ledger-surface)] p-8 text-center shadow-sm">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--ledger-accent-soft)] text-[var(--ledger-accent)]"><Database size={22} /></span>
            <h2 className="mt-4 text-base font-semibold text-[var(--ledger-heading)]">Unlock your offline vault</h2>
            <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-[var(--ledger-muted)]">The pending queue is encrypted on this device. Unlock your existing offline vault to view and manage its transactions.</p>
            <button type="button" onClick={() => navigate('/offline')} className="mt-5 rounded-lg bg-[var(--ledger-accent)] px-4 py-2.5 text-xs font-semibold text-white">Open Offline Data</button>
          </section>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-[var(--ledger-border)] bg-[var(--ledger-surface)] p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ledger-muted)]">Pending</p>
                <p className="mt-2 text-2xl font-bold text-amber-700">{pendingCount}</p>
              </div>
              <div className="rounded-xl border border-[var(--ledger-border)] bg-[var(--ledger-surface)] p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ledger-muted)]">Needs attention</p>
                <p className="mt-2 text-2xl font-bold text-rose-700">{failedCount}</p>
              </div>
              <div className="rounded-xl border border-[var(--ledger-border)] bg-[var(--ledger-surface)] p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ledger-muted)]">Synchronizing</p>
                <p className="mt-2 text-2xl font-bold text-blue-700">{syncingCount}</p>
              </div>
              <div className="rounded-xl border border-[var(--ledger-border)] bg-[var(--ledger-surface)] p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ledger-muted)]">Successfully posted</p>
                <p className="mt-2 text-2xl font-bold text-emerald-700">{syncedCount}</p>
              </div>
            </div>

            {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}
            {message && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">{message}</div>}

            <section className="overflow-hidden rounded-2xl border border-[var(--ledger-border)] bg-[var(--ledger-surface)] shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ledger-border)] px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--ledger-heading)]">Local transaction queue</h2>
                  <p className="mt-1 text-[10px] text-[var(--ledger-muted)]">Newest first · Synced history retains the latest 250 records</p>
                </div>
                <span className="rounded-full bg-[var(--ledger-surface-muted)] px-2.5 py-1 text-[10px] font-semibold text-[var(--ledger-muted)]">{queue.length} records</span>
              </div>

              {queue.length === 0 ? (
                <div className="p-12 text-center">
                  <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--ledger-surface-muted)] text-[var(--ledger-muted)]"><CheckCircle2 size={22} /></span>
                  <h3 className="mt-4 text-sm font-semibold text-[var(--ledger-heading)]">Your queue is clear</h3>
                  <p className="mt-1 text-xs text-[var(--ledger-muted)]">When you're offline, create an income, expense or transfer and it will appear here.</p>
                </div>
              ) : (
                <div className="divide-y divide-[var(--ledger-border)]">
                  {queue.map(item => {
                    const isTransfer = item.operation === 'transfer'
                    const title = isTransfer
                      ? item.description || 'Account Transfer'
                      : item.description || (item.transactionType === 'income' ? 'Income' : 'Expense')
                    return (
                      <article key={item.id} className="p-4 sm:p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-3">
                            <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${isTransfer ? 'bg-blue-50 text-blue-700' : item.transactionType === 'income' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                              {isTransfer ? <ArrowDownUp size={17}/> : item.transactionType === 'income' ? <TrendingUp size={17}/> : <TrendingDown size={17}/>}
                            </span>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="truncate text-sm font-semibold text-[var(--ledger-heading)]">{title}</h3>
                                <span className={`rounded-full px-2 py-1 text-[9px] font-semibold ${statusStyle(item.status)}`}>{statusLabel(item.status)}</span>
                              </div>
                              <p className="mt-1 text-[10px] text-[var(--ledger-muted)]">{formatLedgerDate(item.date)} · {item.operation === 'transfer' ? 'Account transfer' : item.transactionType === 'income' ? 'Income' : 'Expense'}</p>
                              <p className="mt-1 text-[10px] text-[var(--ledger-muted)]">
                                {isTransfer
                                  ? `${accountName(item.fromAccountId)} → ${accountName(item.toAccountId)}`
                                  : `${categoryName(item.categoryId)} · ${accountName(item.accountId)}`}
                                {item.payee ? ` · ${item.payee}` : ''}
                              </p>
                              {item.notes && <p className="mt-1 text-[10px] text-[var(--ledger-muted)]">Note: {item.notes}</p>}
                            </div>
                          </div>
                          <div className="ml-12 text-right sm:ml-0">
                            <p className="text-base font-bold tabular-nums text-[var(--ledger-heading)]">{formatBDTCurrencyMinor(item.amountMinor)}</p>
                            <p className="mt-1 text-[9px] text-[var(--ledger-muted)]">{item.attempts} sync attempts</p>
                          </div>
                        </div>

                        {item.lastError && (
                          <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-100 bg-rose-50 p-3 text-[10px] leading-5 text-rose-800">
                            <AlertCircle size={13} className="mt-0.5 shrink-0"/>
                            <span>{item.lastError}</span>
                          </div>
                        )}
                        {item.outcomeUnknown && (
                          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[10px] leading-5 text-amber-900">
                            The server may already have posted this transaction but its response was not received. Retry this exact item; do not create it again or remove it.
                          </div>
                        )}
                        {item.status === 'synced' && (
                          <p className="mt-2 text-[10px] text-emerald-700">
                            Posted successfully {item.syncedAt ? `· ${new Date(item.syncedAt).toLocaleString()}` : ''}
                            {item.serverEntryId ? ` · Journal ID ${item.serverEntryId}` : ''}
                          </p>
                        )}

                        {(item.status === 'pending' || item.status === 'failed') && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {(item.status === 'failed' || item.outcomeUnknown) && (
                              <button type="button" onClick={() => void handleRetry(item)} disabled={!online || busyId === item.id} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--ledger-accent)] px-3 py-2 text-[10px] font-semibold text-white disabled:opacity-40">
                                <RotateCcw size={12}/> Retry safely
                              </button>
                            )}
                            {!item.outcomeUnknown && (
                              <button type="button" onClick={() => void handleRemove(item)} disabled={busyId === item.id} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-[10px] font-semibold text-rose-700 disabled:opacity-40">
                                <Trash2 size={12}/> Remove local draft
                              </button>
                            )}
                          </div>
                        )}
                        {item.status === 'pending' && !item.outcomeUnknown && (
                          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-700"><Clock3 size={12}/> Waiting for a connection</div>
                        )}
                      </article>
                    )
                  })}
                </div>
              )}
            </section>

            <div className="rounded-xl border border-[var(--ledger-border)] bg-[var(--ledger-surface)] p-4 text-[10px] leading-5 text-[var(--ledger-muted)]">
              <strong className="text-[var(--ledger-heading)]">Important:</strong> Pending items are encrypted on this device. The server validates every account, category, amount and available transfer balance before posting. A failed request with an unknown outcome must be retried with its original idempotency key to prevent duplicates.
            </div>
          </>
        )}
      </div>
    </div>
  )
}
