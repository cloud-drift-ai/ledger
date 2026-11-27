import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  Download,
  FileJson,
  HardDrive,
  History,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react'

import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatLedgerDateTime } from '../lib/preferences'

const BACKUP_FORMAT = 'ledger-personal-finance-backup'
const BACKUP_VERSION = 1
const PAGE_SIZE = 1000

const BACKUP_TABLES = [
  { name: 'profiles', ownerColumn: 'id', label: 'Profile' },
  { name: 'ledger_accounts', ownerColumn: 'user_id', label: 'Accounts' },
  { name: 'journal_entries', ownerColumn: 'user_id', label: 'Journal entries' },
  { name: 'journal_lines', ownerColumn: 'user_id', label: 'Journal lines' },
  { name: 'investment_instruments', ownerColumn: 'user_id', label: 'Investment instruments' },
  { name: 'investment_activities', ownerColumn: 'user_id', label: 'Investment activities' },
  { name: 'investment_valuations', ownerColumn: 'user_id', label: 'Investment valuations' },
  { name: 'gpf_rate_schedules', ownerColumn: 'user_id', label: 'GPF rate schedules' },
  { name: 'gpf_rate_tiers', ownerColumn: 'user_id', label: 'GPF rate tiers' },
  { name: 'gpf_profiles', ownerColumn: 'user_id', label: 'GPF profiles' },
  { name: 'gpf_calculation_snapshots', ownerColumn: 'user_id', label: 'GPF calculation history' },
  { name: 'category_budgets', ownerColumn: 'user_id', label: 'Budgets' },
  { name: 'financial_goals', ownerColumn: 'user_id', label: 'Financial goals' },
  { name: 'goal_entries', ownerColumn: 'user_id', label: 'Goal contributions and withdrawals' },
  { name: 'recurring_transactions', ownerColumn: 'user_id', label: 'Recurring schedules' },
  { name: 'recurring_transaction_occurrences', ownerColumn: 'user_id', label: 'Recurring history' },
] as const

type BackupTableName = typeof BACKUP_TABLES[number]['name']
type BackupRows = Record<BackupTableName, Record<string, unknown>[]>

type BackupPayload = {
  format: typeof BACKUP_FORMAT
  version: number
  app: string
  owner_user_id: string
  exported_at: string
  table_counts: Record<string, number>
  tables: BackupRows
}

type BackupHistoryItem = {
  id: string
  action_type: 'backup' | 'restore'
  file_name: string
  file_size_bytes: number
  record_counts: Record<string, number>
  created_at: string
}

type RestorePreview = {
  fileName: string
  fileSize: number
  backup: BackupPayload
  counts: Record<string, number>
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(2)} MB`
}

function formatDateTime(value: string | null | undefined) {
  return formatLedgerDateTime(value)
}

function getErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return error instanceof Error ? error.message : 'An unexpected error occurred.'
}

function getTotalRecords(counts: Record<string, number> | undefined) {
  return Object.values(counts || {}).reduce((sum, value) => sum + Number(value || 0), 0)
}

function validateBackup(value: unknown, userId: string): BackupPayload {
  if (!value || typeof value !== 'object') {
    throw new Error('The selected file does not contain a valid backup object.')
  }

  const candidate = value as Record<string, unknown>

  if (candidate.format !== BACKUP_FORMAT) {
    throw new Error('This is not a Ledger backup file.')
  }

  if (candidate.version !== BACKUP_VERSION) {
    throw new Error(`Unsupported backup version. This Ledger version supports backup version ${BACKUP_VERSION}.`)
  }

  if (candidate.owner_user_id !== userId) {
    throw new Error('This backup belongs to a different Ledger account. Sign in to the original account.')
  }

  if (!candidate.tables || typeof candidate.tables !== 'object') {
    throw new Error('The backup is missing its tables section.')
  }

  const tableObject = candidate.tables as Record<string, unknown>
  const counts: Record<string, number> = {}

  for (const table of BACKUP_TABLES) {
    const rows = tableObject[table.name]
    if (!Array.isArray(rows)) {
      throw new Error(`The backup is missing the "${table.name}" table or its data is invalid.`)
    }

    if (rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
      throw new Error(`The "${table.name}" table contains an invalid record.`)
    }

    counts[table.name] = rows.length
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app: String(candidate.app || 'Ledger'),
    owner_user_id: userId,
    exported_at: String(candidate.exported_at || ''),
    table_counts: counts,
    tables: tableObject as BackupRows,
  }
}

export default function BackupRestore() {
  const { user } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [history, setHistory] = useState<BackupHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null)
  const [restoreResult, setRestoreResult] = useState<Record<string, unknown> | null>(null)

  const loadHistory = useCallback(async () => {
    if (!user?.id) {
      setHistory([])
      setLoading(false)
      return
    }

    setLoading(true)
    setHistoryError('')

    const { data, error: queryError } = await supabase
      .from('ledger_backup_history')
      .select('id, action_type, file_name, file_size_bytes, record_counts, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)

    if (queryError) {
      setHistoryError(queryError.message)
      setHistory([])
    } else {
      setHistory((data || []) as BackupHistoryItem[])
    }

    setLoading(false)
  }, [user?.id])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const backupHistory = useMemo(
    () => history.filter(item => item.action_type === 'backup'),
    [history]
  )

  const restoreHistory = useMemo(
    () => history.filter(item => item.action_type === 'restore'),
    [history]
  )

  const lastBackup = backupHistory[0] || null
  const needsBackup = !lastBackup ||
    Date.now() - new Date(lastBackup.created_at).getTime() > 7 * 24 * 60 * 60 * 1000

  const handleCreateBackup = async () => {
    if (!user?.id) return

    setBusy(true)
    setError('')
    setNotice('')
    setRestoreResult(null)

    try {
      const tableRows = {} as BackupRows
      const tableCounts: Record<string, number> = {}

      for (const table of BACKUP_TABLES) {
        const allRows: Record<string, unknown>[] = []
        let offset = 0

        while (true) {
          const { data, error: queryError } = await supabase
            .from(table.name)
            .select('*')
            .eq(table.ownerColumn, user.id)
            .order('id', { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1)

          if (queryError) {
            throw new Error(`Could not back up ${table.label}: ${queryError.message}`)
          }

          const pageRows = (data || []) as Record<string, unknown>[]
          allRows.push(...pageRows)

          if (pageRows.length < PAGE_SIZE) break
          offset += PAGE_SIZE
        }

        tableRows[table.name] = allRows
        tableCounts[table.name] = allRows.length
      }

      const backup: BackupPayload = {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        app: 'Ledger',
        owner_user_id: user.id,
        exported_at: new Date().toISOString(),
        table_counts: tableCounts,
        tables: tableRows,
      }

      const json = JSON.stringify(backup, null, 2)
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const fileName = `Ledger_Backup_${timestamp}.json`
      const downloadUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')

      anchor.href = downloadUrl
      anchor.download = fileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)

      const { error: historyInsertError } = await supabase
        .from('ledger_backup_history')
        .insert({
          user_id: user.id,
          action_type: 'backup',
          file_name: fileName,
          file_size_bytes: blob.size,
          record_counts: tableCounts,
        })

      if (historyInsertError) {
        setNotice(`Backup downloaded successfully, but its history could not be saved: ${historyInsertError.message}`)
      } else {
        setNotice(`Backup created successfully: ${getTotalRecords(tableCounts).toLocaleString()} records across ${BACKUP_TABLES.length} data tables.`)
        await loadHistory()
      }
    } catch (err) {
      console.error('Ledger backup error:', err)
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const handleSelectBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file || !user?.id) return

    setError('')
    setNotice('')
    setRestoreResult(null)
    setRestorePreview(null)

    try {
      if (!file.name.toLowerCase().endsWith('.json')) {
        throw new Error('Please select a Ledger JSON backup file (.json).')
      }

      const parsed = JSON.parse(await file.text()) as unknown
      const backup = validateBackup(parsed, user.id)
      const counts = backup.table_counts

      setRestorePreview({
        fileName: file.name,
        fileSize: file.size,
        backup,
        counts,
      })
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  const handleRestore = async () => {
    if (!user?.id || !restorePreview) return

    const total = getTotalRecords(restorePreview.counts)
    const confirmed = window.confirm(
      `Restore ${total.toLocaleString()} records from "${restorePreview.fileName}"?\n\nThis is a merge restore: missing records will be added. Existing records will not be overwritten or deleted. The backup must belong to this Ledger account.`
    )

    if (!confirmed) return

    setBusy(true)
    setError('')
    setNotice('')
    setRestoreResult(null)

    try {
      const { data, error: restoreError } = await supabase.rpc('restore_ledger_backup', {
        p_backup: restorePreview.backup,
        p_file_name: restorePreview.fileName,
        p_file_size_bytes: restorePreview.fileSize,
      })

      if (restoreError) throw restoreError

      const result = (data || {}) as Record<string, unknown>
      setRestoreResult(result)
      setNotice('Restore completed. Existing records were preserved; missing records were added.')
      setRestorePreview(null)
      await loadHistory()
    } catch (err) {
      console.error('Ledger restore error:', err)
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-ledger-navy">
            <ShieldCheck size={17} />
            <span>Protect your financial records</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 md:text-3xl">
            Backup &amp; Restore
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Create a local copy of your Ledger data and safely restore missing records when needed.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadHistory()}
          disabled={loading || busy}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh history
        </button>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Last backup"
          value={lastBackup ? formatDateTime(lastBackup.created_at) : 'Not created'}
          detail={lastBackup ? lastBackup.file_name : 'Create your first backup'}
          icon={Clock3}
        />
        <SummaryCard
          label="Backup files created"
          value={String(backupHistory.length)}
          detail="Latest 20 history records"
          icon={FileJson}
        />
        <SummaryCard
          label="Restore operations"
          value={String(restoreHistory.length)}
          detail="Latest 20 history records"
          icon={History}
        />
        <SummaryCard
          label="Last backup size"
          value={lastBackup ? formatBytes(Number(lastBackup.file_size_bytes)) : '—'}
          detail="JSON file saved on your device"
          icon={HardDrive}
        />
      </div>

      {needsBackup && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle size={19} className="mt-0.5 shrink-0 text-amber-700" />
          <div>
            <p className="font-semibold text-amber-900">
              {lastBackup ? 'Your last backup is more than 7 days old.' : 'You have not created a backup yet.'}
            </p>
            <p className="mt-1 text-sm text-amber-800">
              Create a fresh backup and keep a copy somewhere safe, such as an encrypted external drive or secure cloud storage.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-blue-50 p-3 text-ledger-navy">
              <Download size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Create a backup</h2>
              <p className="mt-1 text-sm text-slate-500">
                Export your financial records into one JSON file.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-3 rounded-xl bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-700">Included data</p>
            <div className="grid grid-cols-1 gap-2 text-sm text-slate-600 sm:grid-cols-2">
              {BACKUP_TABLES.map(table => (
                <div key={table.name} className="flex items-center gap-2">
                  <CheckCircle2 size={15} className="shrink-0 text-emerald-600" />
                  {table.label}
                </div>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleCreateBackup()}
            disabled={busy || loading}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-ledger-navy px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:opacity-50"
          >
            {busy ? <RefreshCw size={17} className="animate-spin" /> : <Download size={17} />}
            {busy ? 'Processing...' : 'Create and download backup'}
          </button>

          <p className="mt-3 text-xs leading-5 text-slate-400">
            The backup file is generated in your browser and downloaded to your device. For the most consistent snapshot, avoid adding or editing transactions while the export is running. Ledger stores only backup history metadata, not the backup file itself.
          </p>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-emerald-50 p-3 text-emerald-700">
              <Upload size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Restore a backup</h2>
              <p className="mt-1 text-sm text-slate-500">
                Select a previous Ledger JSON backup and review it before restoring.
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
              <LockKeyhole size={16} />
              Safe merge restore
            </div>
            <p className="mt-1 text-xs leading-5 text-amber-800">
              Only missing records are added. Existing records are not overwritten or deleted. Restore is limited to the same Ledger account that created the backup.
            </p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleSelectBackup}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <FileJson size={17} />
            Choose backup file
          </button>

          {restorePreview && (
            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-all text-sm font-semibold text-blue-950">{restorePreview.fileName}</p>
                  <p className="mt-1 text-xs text-blue-800">
                    {formatBytes(restorePreview.fileSize)} · Created {formatDateTime(restorePreview.backup.exported_at)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRestorePreview(null)}
                  className="rounded-lg p-1.5 text-blue-700 hover:bg-blue-100"
                  aria-label="Remove selected backup"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-blue-900">
                {BACKUP_TABLES.map(table => (
                  <div key={table.name} className="flex justify-between gap-2 rounded-lg bg-white/70 px-2.5 py-2">
                    <span>{table.label}</span>
                    <strong>{restorePreview.counts[table.name] || 0}</strong>
                  </div>
                ))}
              </div>

              <p className="mt-3 text-xs text-blue-800">
                {getTotalRecords(restorePreview.counts).toLocaleString()} records found. Review the contents before continuing.
              </p>

              <button
                type="button"
                onClick={() => void handleRestore()}
                disabled={busy}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {busy ? <RefreshCw size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                {busy ? 'Restoring...' : 'Restore missing records'}
              </button>
            </div>
          )}
        </section>
      </div>

      {restoreResult && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex items-center gap-2 font-bold text-emerald-900">
            <CheckCircle2 size={19} />
            Restore completed
          </div>
          <p className="mt-1 text-sm text-emerald-800">
            Existing records were preserved. The counts below show how many rows were added from the backup.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries((restoreResult.restored_counts || {}) as Record<string, number>).map(([table, count]) => (
              <div key={table} className="rounded-lg bg-white/80 px-3 py-2 text-sm">
                <span className="block text-xs text-slate-500">{table.replaceAll('_', ' ')}</span>
                <strong className="text-slate-800">{count}</strong>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="font-bold text-slate-900">Backup history</h2>
            <p className="mt-1 text-xs text-slate-500">Metadata for your latest backup and restore operations.</p>
          </div>
          <span className="text-xs text-slate-400">Last 20 operations</span>
        </div>

        {historyError ? (
          <div className="m-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Could not load backup history: {historyError}
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-12 text-sm text-slate-500">
            <RefreshCw size={16} className="animate-spin" />
            Loading backup history...
          </div>
        ) : history.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
              <History size={22} />
            </div>
            <p className="text-sm text-slate-500">No backup or restore history yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Operation</th>
                  <th className="px-5 py-3 font-semibold">File</th>
                  <th className="px-5 py-3 font-semibold">Date</th>
                  <th className="px-5 py-3 text-right font-semibold">Size</th>
                  <th className="px-5 py-3 text-right font-semibold">Records</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map(item => (
                  <tr key={item.id}>
                    <td className="px-5 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                        item.action_type === 'backup'
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-emerald-50 text-emerald-700'
                      }`}>
                        {item.action_type === 'backup' ? 'Backup' : 'Restore'}
                      </span>
                    </td>
                    <td className="max-w-[260px] truncate px-5 py-3 font-medium text-slate-700" title={item.file_name}>
                      {item.file_name}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-slate-500">{formatDateTime(item.created_at)}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{formatBytes(Number(item.file_size_bytes))}</td>
                    <td className="px-5 py-3 text-right font-semibold text-slate-700">{getTotalRecords(item.record_counts).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Database size={17} />
            What is included?
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Profile settings, accounts, double-entry journal records, investment and GPF records, budgets, goals, and recurring schedules with their occurrence history.
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <LockKeyhole size={17} />
            What is not included?
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Login passwords, authentication sessions, API keys and Supabase project settings are not exported. Your original Ledger account must still exist to restore this account-specific backup.
          </p>
        </div>
      </div>

      <p className="text-xs leading-5 text-slate-400">
        Backup reminders are shown when the last backup is older than seven days. A browser-based app cannot silently download scheduled backups while it is closed. Keep the downloaded JSON file in a secure location; the history shown here stores metadata only.
      </p>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string
  value: string
  detail: string
  icon: LucideIcon
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">{label}</p>
        <div className="rounded-xl bg-blue-50 p-2.5 text-ledger-navy">
          <Icon size={20} />
        </div>
      </div>
      <p className="mt-4 break-words text-lg font-bold text-slate-900">{value}</p>
      <p className="mt-1 truncate text-xs text-slate-500" title={detail}>{detail}</p>
    </div>
  )
}
