import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Download,
  Eye,
  KeyRound,
  LoaderCircle,
  Lock,
  MonitorDown,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  Unlock,
  WifiOff,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { usePwa } from '../context/PwaContext'

function StatusRow({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'success' | 'warning' | 'neutral' | 'danger'
}) {
  const tones = {
    success: 'bg-emerald-50 text-emerald-700',
    warning: 'bg-amber-50 text-amber-700',
    neutral: 'bg-slate-100 text-slate-600',
    danger: 'bg-rose-50 text-rose-700',
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
      <span className="text-[12px] text-[var(--ledger-muted)]">{label}</span>
      <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${tones[tone]}`}>{value}</span>
    </div>
  )
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return 'Never'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export default function PwaSettingsCard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const {
    online,
    installed,
    canInstall,
    serviceWorkerSupported,
    serviceWorkerReady,
    serviceWorkerError,
    updateAvailable,
    installApp,
    checkForUpdates,
    applyUpdate,
    offlineVaultMetadata,
    offlineVaultMetadataUserId,
    offlineVaultUnlocked,
    offlineVaultUserId,
    offlineSnapshot,
    refreshOfflineVault,
    createOfflineVault,
    unlockOfflineVault,
    syncOfflineData,
    syncPendingTransactions,
    lockOfflineVault,
    clearOfflineVault,
  } = usePwa()

  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState('')
  const [vaultLoading, setVaultLoading] = useState(true)
  const [vaultBusy, setVaultBusy] = useState(false)
  const [vaultMessage, setVaultMessage] = useState('')
  const [vaultError, setVaultError] = useState('')
  const [newPassphrase, setNewPassphrase] = useState('')
  const [confirmPassphrase, setConfirmPassphrase] = useState('')
  const [unlockPassphrase, setUnlockPassphrase] = useState('')

  const vaultExists = Boolean(user?.id && offlineVaultMetadataUserId === user.id && offlineVaultMetadata)
  const vaultUnlockedForUser = Boolean(user?.id && offlineVaultUnlocked && offlineVaultUserId === user.id)

  useEffect(() => {
    let active = true
    if (!user?.id) {
      setVaultLoading(false)
      return
    }
    setVaultLoading(true)
    void refreshOfflineVault(user.id)
      .catch(error => {
        if (active) setVaultError(error instanceof Error ? error.message : 'Could not inspect offline storage.')
      })
      .finally(() => {
        if (active) setVaultLoading(false)
      })
    return () => { active = false }
  }, [user?.id, refreshOfflineVault])

  const handleCheckUpdates = async () => {
    setChecking(true)
    setMessage('')
    try {
      await checkForUpdates()
      setMessage('Update check completed.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not check for updates.')
    } finally {
      setChecking(false)
    }
  }

  const handleInstall = async () => {
    setMessage('')
    try {
      await installApp()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The installation prompt could not be opened.')
    }
  }

  const handleCreateVault = async () => {
    if (!user?.id) return
    setVaultError('')
    setVaultMessage('')
    if (newPassphrase.length < 12) {
      setVaultError('Choose an offline passphrase with at least 12 characters.')
      return
    }
    if (newPassphrase !== confirmPassphrase) {
      setVaultError('The two passphrases do not match.')
      return
    }

    setVaultBusy(true)
    try {
      await createOfflineVault(user.id, newPassphrase)
      setNewPassphrase('')
      setConfirmPassphrase('')
      const snapshot = await syncOfflineData(user.id)
      setVaultMessage(`Encrypted offline copy created and synchronized: ${snapshot.accounts.length} accounts, ${snapshot.transactions.length} transactions, ${snapshot.investments?.length ?? 0} investments and ${snapshot.gpfProfiles?.length ?? 0} GPF profiles.`)
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : 'Could not create or synchronize the offline vault.')
    } finally {
      setVaultBusy(false)
    }
  }

  const handleUnlockVault = async () => {
    if (!user?.id) return
    setVaultError('')
    setVaultMessage('')
    setVaultBusy(true)
    try {
      await unlockOfflineVault(user.id, unlockPassphrase)
      setUnlockPassphrase('')
      setVaultMessage('Offline vault unlocked on this device.')
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : 'Could not unlock the offline vault.')
    } finally {
      setVaultBusy(false)
    }
  }

  const handleSyncVault = async () => {
    if (!user?.id) return
    setVaultError('')
    setVaultMessage('')
    setVaultBusy(true)
    try {
      const queueAttempted = await syncPendingTransactions(user.id)
      const snapshot = await syncOfflineData(user.id)
      const queueSummary = queueAttempted
        ? ` Pending transaction synchronization was attempted; review the queue for any items needing attention.`
        : ''
      setVaultMessage(`Offline copy updated: ${snapshot.accounts.length} accounts, ${snapshot.categories?.length ?? 0} categories, ${snapshot.transactions.length} transactions, ${snapshot.investments?.length ?? 0} investments and ${snapshot.gpfProfiles?.length ?? 0} GPF profiles.${queueSummary}`)
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : 'Could not synchronize offline data.')
    } finally {
      setVaultBusy(false)
    }
  }

  const handleLockVault = () => {
    lockOfflineVault()
    setVaultError('')
    setVaultMessage('Offline vault locked. Your encrypted local copy remains on this device.')
  }

  const handleDeleteVault = async () => {
    if (!user?.id) return
    const confirmed = window.confirm('Permanently delete the encrypted offline copy from this device? Your cloud financial records will not be affected.')
    if (!confirmed) return
    setVaultBusy(true)
    setVaultError('')
    setVaultMessage('')
    try {
      await clearOfflineVault(user.id)
      setVaultMessage('The encrypted offline copy was deleted from this device. Cloud records are unchanged.')
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : 'Could not delete the offline copy.')
    } finally {
      setVaultBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[16px] border border-[var(--ledger-border)] bg-[var(--ledger-surface)] p-5 shadow-[0_1px_2px_rgba(16,42,67,0.035)] md:p-6">
        <div className="mb-4 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--ledger-accent-soft)] text-[var(--ledger-accent)]">
            <MonitorDown size={19}/>
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-[var(--ledger-heading)]">Install Ledger</h2>
            <p className="mt-1 text-[11px] leading-5 text-[var(--ledger-muted)]">
              Install Ledger as a standalone application on your computer or phone.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--ledger-border)] bg-[var(--ledger-surface-muted)] p-3.5">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--ledger-heading)]">
              <MonitorDown size={16} className="text-[var(--ledger-accent)]"/> Windows / Desktop
            </div>
            <p className="mt-1.5 text-[11px] leading-5 text-[var(--ledger-muted)]">
              Use Chrome or Edge and install Ledger from the browser's install icon or menu.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--ledger-border)] bg-[var(--ledger-surface-muted)] p-3.5">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--ledger-heading)]">
              <Smartphone size={16} className="text-[var(--ledger-accent)]"/> Android / Mobile
            </div>
            <p className="mt-1.5 text-[11px] leading-5 text-[var(--ledger-muted)]">
              In Chrome, open the browser menu and choose Install app or Add to Home screen.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {canInstall && !installed && (
            <button type="button" onClick={() => void handleInstall()} className="inline-flex items-center gap-2 rounded-[10px] bg-[var(--ledger-accent)] px-4 py-2.5 text-[11px] font-semibold text-white shadow-sm transition hover:brightness-105">
              <Download size={14}/> Install Ledger
            </button>
          )}
          {installed && (
            <span className="inline-flex items-center gap-2 rounded-[10px] bg-emerald-50 px-3.5 py-2.5 text-[11px] font-semibold text-emerald-700">
              <CheckCircle2 size={15}/> Installed on this device
            </span>
          )}
          {!installed && !canInstall && (
            <p className="text-[10px] leading-5 text-[var(--ledger-muted)]">
              If no install button appears, use the browser menu and select <strong>Install Ledger</strong> or <strong>Add to Home Screen</strong>. Installation requires HTTPS (or localhost).
            </p>
          )}
        </div>
        {message && <p role="status" className="mt-2 text-[11px] text-[var(--ledger-muted)]">{message}</p>}
      </section>

      <section className="rounded-[16px] border border-[var(--ledger-border)] bg-[var(--ledger-surface)] p-5 shadow-[0_1px_2px_rgba(16,42,67,0.035)] md:p-6">
        <div className="mb-3 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
            <ShieldCheck size={19}/>
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--ledger-heading)]">Offline & connection status</h2>
            <p className="mt-1 text-[11px] text-[var(--ledger-muted)]">The application shell is cached separately from your encrypted financial snapshot.</p>
          </div>
        </div>

        <div className="divide-y divide-[var(--ledger-border)]">
          <StatusRow label="Device connection" value={online ? 'Online' : 'Offline'} tone={online ? 'success' : 'warning'}/>
          <StatusRow
            label="Application cache"
            value={!serviceWorkerSupported ? 'Not supported by this browser' : serviceWorkerReady ? 'Ready' : import.meta.env.PROD ? 'Preparing' : 'Available in production build'}
            tone={serviceWorkerReady ? 'success' : 'neutral'}
          />
          <StatusRow
            label="Installation"
            value={installed ? 'Installed' : canInstall ? 'Ready to install' : 'Not installed'}
            tone={installed || canInstall ? 'success' : 'neutral'}
          />
          <StatusRow
            label="Encrypted offline vault"
            value={vaultLoading ? 'Checking' : !vaultExists ? 'Not configured' : vaultUnlockedForUser ? 'Unlocked on this device' : 'Locked'}
            tone={vaultUnlockedForUser ? 'success' : vaultExists ? 'warning' : 'neutral'}
          />
        </div>

        {serviceWorkerError && (
          <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-[11px] text-rose-700">
            <AlertCircle size={15} className="mt-0.5 shrink-0"/><span>{serviceWorkerError}</span>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void handleCheckUpdates()} disabled={checking || !serviceWorkerSupported || !serviceWorkerReady} className="inline-flex items-center gap-2 rounded-[10px] border border-[var(--ledger-border)] px-3.5 py-2.5 text-[11px] font-semibold text-[var(--ledger-heading)] transition hover:bg-[var(--ledger-surface-muted)] disabled:cursor-not-allowed disabled:opacity-45">
            {checking ? <LoaderCircle size={14} className="animate-spin"/> : <RefreshCw size={14}/>} Check for updates
          </button>
          {updateAvailable && (
            <button type="button" onClick={applyUpdate} className="inline-flex items-center gap-2 rounded-[10px] bg-[var(--ledger-accent)] px-3.5 py-2.5 text-[11px] font-semibold text-white transition hover:brightness-105">
              <Download size={14}/> Apply update & reload
            </button>
          )}
        </div>
        {updateAvailable && <p className="mt-2 text-[11px] font-medium text-emerald-700">A new Ledger version is ready to install.</p>}
      </section>

      <section className="rounded-[16px] border border-[var(--ledger-border)] bg-[var(--ledger-surface)] p-5 shadow-[0_1px_2px_rgba(16,42,67,0.035)] md:p-6">
        <div className="mb-4 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
            <Database size={19}/>
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-[var(--ledger-heading)]">Encrypted offline data</h2>
            <p className="mt-1 text-[11px] leading-5 text-[var(--ledger-muted)]">
              Keep an encrypted copy of your account balances, categories, latest 1,000 income and expense transactions, investments and GPF records. You can also save income, expenses and transfers offline; pending drafts stay encrypted on this device until the server validates and posts them after reconnection.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-violet-100 bg-violet-50/70 p-3.5 text-[11px] leading-5 text-violet-900">
          Your offline passphrase is separate from your Ledger login. Ledger derives a non-exportable AES-256 key using PBKDF2 and encrypts the local snapshot with AES-GCM. The passphrase and encryption key are not saved. If you forget the passphrase, delete this device's offline copy and create a new one while online.
        </div>

        {vaultLoading ? (
          <div className="mt-4 flex items-center gap-2 text-[11px] text-[var(--ledger-muted)]"><LoaderCircle size={14} className="animate-spin"/> Checking this device's offline vault…</div>
        ) : !vaultExists ? (
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="text-[11px] font-semibold text-[var(--ledger-heading)]">Create an offline passphrase</span>
              <input type="password" autoComplete="new-password" value={newPassphrase} onChange={event => setNewPassphrase(event.target.value)} minLength={12} placeholder="At least 12 characters" className="mt-1.5 w-full rounded-[10px] border border-[var(--ledger-border)] bg-[var(--ledger-surface)] px-3 py-2.5 text-[12px] text-[var(--ledger-heading)] outline-none focus:border-[var(--ledger-accent)]"/>
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold text-[var(--ledger-heading)]">Confirm offline passphrase</span>
              <input type="password" autoComplete="new-password" value={confirmPassphrase} onChange={event => setConfirmPassphrase(event.target.value)} placeholder="Re-enter passphrase" className="mt-1.5 w-full rounded-[10px] border border-[var(--ledger-border)] bg-[var(--ledger-surface)] px-3 py-2.5 text-[12px] text-[var(--ledger-heading)] outline-none focus:border-[var(--ledger-accent)]"/>
            </label>
            <button type="button" onClick={() => void handleCreateVault()} disabled={vaultBusy || !online || !serviceWorkerReady || !user?.id} className="inline-flex items-center gap-2 rounded-[10px] bg-[var(--ledger-accent)] px-4 py-2.5 text-[11px] font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45">
              {vaultBusy ? <LoaderCircle size={14} className="animate-spin"/> : <KeyRound size={14}/>} Create vault & sync data
            </button>
            {!online && <p className="text-[10px] text-amber-700">Connect to the internet to create the first encrypted snapshot.</p>}
            {online && !serviceWorkerReady && <p className="text-[10px] text-amber-700">Open the production preview or deployed HTTPS app first. The offline application shell must be ready before creating the vault.</p>}
          </div>
        ) : !vaultUnlockedForUser ? (
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-lg bg-[var(--ledger-surface-muted)] px-3 py-2.5">
              <span className="text-[11px] text-[var(--ledger-muted)]">Vault created</span>
              <strong className="text-[11px] text-[var(--ledger-heading)]">{formatTimestamp(offlineVaultMetadata?.createdAt)}</strong>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg bg-[var(--ledger-surface-muted)] px-3 py-2.5">
              <span className="text-[11px] text-[var(--ledger-muted)]">Last successful sync</span>
              <strong className="text-[11px] text-[var(--ledger-heading)]">{formatTimestamp(offlineVaultMetadata?.lastSyncedAt)}</strong>
            </div>
            <label className="block">
              <span className="text-[11px] font-semibold text-[var(--ledger-heading)]">Offline passphrase</span>
              <input type="password" autoComplete="current-password" value={unlockPassphrase} onChange={event => setUnlockPassphrase(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void handleUnlockVault() }} placeholder="Enter your offline passphrase" className="mt-1.5 w-full rounded-[10px] border border-[var(--ledger-border)] bg-[var(--ledger-surface)] px-3 py-2.5 text-[12px] text-[var(--ledger-heading)] outline-none focus:border-[var(--ledger-accent)]"/>
            </label>
            <button type="button" onClick={() => void handleUnlockVault()} disabled={vaultBusy || !unlockPassphrase} className="inline-flex items-center gap-2 rounded-[10px] bg-[var(--ledger-accent)] px-4 py-2.5 text-[11px] font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45">
              {vaultBusy ? <LoaderCircle size={14} className="animate-spin"/> : <Unlock size={14}/>} Unlock offline data
            </button>
            <p className="text-[10px] leading-5 text-[var(--ledger-muted)]">Unlocking works offline. You can view the last saved snapshot even without an internet connection.</p>
            <button type="button" onClick={() => void handleDeleteVault()} disabled={vaultBusy} className="inline-flex items-center gap-2 rounded-[10px] border border-rose-200 px-3.5 py-2.5 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-45"><Trash2 size={14}/> Delete local copy</button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-lg bg-[var(--ledger-surface-muted)] p-3"><p className="text-[10px] text-[var(--ledger-muted)]">Accounts cached</p><p className="mt-1 text-[18px] font-semibold text-[var(--ledger-heading)]">{offlineSnapshot?.accounts.length ?? 0}</p></div>
              <div className="rounded-lg bg-[var(--ledger-surface-muted)] p-3"><p className="text-[10px] text-[var(--ledger-muted)]">Categories cached</p><p className="mt-1 text-[18px] font-semibold text-[var(--ledger-heading)]">{offlineSnapshot?.categories?.length ?? 0}</p></div>
              <div className="rounded-lg bg-[var(--ledger-surface-muted)] p-3"><p className="text-[10px] text-[var(--ledger-muted)]">Pending / failed drafts</p><p className="mt-1 text-[18px] font-semibold text-[var(--ledger-heading)]">{offlineSnapshot?.pendingTransactions?.filter(item => item.status !== 'synced').length ?? 0}</p></div>
              <div className="rounded-lg bg-[var(--ledger-surface-muted)] p-3"><p className="text-[10px] text-[var(--ledger-muted)]">Transactions cached</p><p className="mt-1 text-[18px] font-semibold text-[var(--ledger-heading)]">{offlineSnapshot?.transactions.length ?? 0}</p></div>
              <div className="rounded-lg bg-[var(--ledger-surface-muted)] p-3"><p className="text-[10px] text-[var(--ledger-muted)]">Investments cached</p><p className="mt-1 text-[18px] font-semibold text-[var(--ledger-heading)]">{offlineSnapshot?.investments?.length ?? 0}</p></div>
              <div className="rounded-lg bg-[var(--ledger-surface-muted)] p-3"><p className="text-[10px] text-[var(--ledger-muted)]">Investment activities</p><p className="mt-1 text-[18px] font-semibold text-[var(--ledger-heading)]">{offlineSnapshot?.investmentActivities?.length ?? 0}</p></div>
              <div className="rounded-lg bg-[var(--ledger-surface-muted)] p-3"><p className="text-[10px] text-[var(--ledger-muted)]">Valuations cached</p><p className="mt-1 text-[18px] font-semibold text-[var(--ledger-heading)]">{offlineSnapshot?.investmentValuations?.length ?? 0}</p></div>
              <div className="rounded-lg bg-[var(--ledger-surface-muted)] p-3"><p className="text-[10px] text-[var(--ledger-muted)]">GPF profiles</p><p className="mt-1 text-[18px] font-semibold text-[var(--ledger-heading)]">{offlineSnapshot?.gpfProfiles?.length ?? 0}</p></div>
              <div className="rounded-lg bg-[var(--ledger-surface-muted)] p-3"><p className="text-[10px] text-[var(--ledger-muted)]">GPF calculations</p><p className="mt-1 text-[18px] font-semibold text-[var(--ledger-heading)]">{offlineSnapshot?.gpfCalculationSnapshots?.length ?? 0}</p></div>
              <div className="rounded-lg bg-[var(--ledger-surface-muted)] p-3"><p className="text-[10px] text-[var(--ledger-muted)]">Last sync</p><p className="mt-1 text-[11px] font-semibold text-[var(--ledger-heading)]">{formatTimestamp(offlineVaultMetadata?.lastSyncedAt)}</p></div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void handleSyncVault()} disabled={vaultBusy || !online} className="inline-flex items-center gap-2 rounded-[10px] bg-[var(--ledger-accent)] px-3.5 py-2.5 text-[11px] font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45">
                {vaultBusy ? <LoaderCircle size={14} className="animate-spin"/> : <RefreshCw size={14}/>} Sync now
              </button>
              <button type="button" onClick={() => navigate('/offline')} disabled={!offlineSnapshot} className="inline-flex items-center gap-2 rounded-[10px] border border-[var(--ledger-border)] px-3.5 py-2.5 text-[11px] font-semibold text-[var(--ledger-heading)] transition hover:bg-[var(--ledger-surface-muted)] disabled:cursor-not-allowed disabled:opacity-45"><Eye size={14}/> View offline data</button>
              <button type="button" onClick={() => navigate('/offline-queue')} disabled={!offlineSnapshot} className="inline-flex items-center gap-2 rounded-[10px] border border-[var(--ledger-border)] px-3.5 py-2.5 text-[11px] font-semibold text-[var(--ledger-heading)] transition hover:bg-[var(--ledger-surface-muted)] disabled:cursor-not-allowed disabled:opacity-45"><Database size={14}/> Pending transactions</button>
              <button type="button" onClick={handleLockVault} disabled={vaultBusy} className="inline-flex items-center gap-2 rounded-[10px] border border-[var(--ledger-border)] px-3.5 py-2.5 text-[11px] font-semibold text-[var(--ledger-heading)] transition hover:bg-[var(--ledger-surface-muted)] disabled:opacity-45"><Lock size={14}/> Lock</button>
              <button type="button" onClick={() => void handleDeleteVault()} disabled={vaultBusy} className="inline-flex items-center gap-2 rounded-[10px] border border-rose-200 px-3.5 py-2.5 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-45"><Trash2 size={14}/> Delete local copy</button>
            </div>
            {!online && <p className="text-[10px] text-amber-700">You're offline. The saved snapshot is available to view, but synchronization requires internet.</p>}
          </div>
        )}

        {vaultError && <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-[11px] leading-5 text-rose-700"><AlertCircle size={14} className="mt-0.5 shrink-0"/><span>{vaultError}</span></div>}
        {vaultMessage && <div role="status" className="mt-3 flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-[11px] leading-5 text-emerald-700"><CheckCircle2 size={14} className="mt-0.5 shrink-0"/><span>{vaultMessage}</span></div>}
      </section>

      <section className="rounded-[16px] border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-2.5">
          <WifiOff size={16} className="mt-0.5 shrink-0 text-amber-700"/>
          <div>
            <p className="text-[12px] font-semibold text-amber-900">Offline 3.0 — encrypted transaction queue</p>
            <p className="mt-1 text-[11px] leading-5 text-amber-800">
              Account balances, categories, investment values and GPF records are cached read-only snapshots. Income, expenses and transfers can be saved as encrypted local drafts while offline. When connectivity returns, Ledger submits each draft using a stable idempotency key; the server revalidates account ownership, category, amount and transfer funds before posting. Uncertain network outcomes are retried with the same key to prevent duplicates. Investment activity and GPF posting remain online-only. The vault automatically locks after the app has been in the background for five minutes.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
