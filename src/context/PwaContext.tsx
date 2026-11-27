import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { supabase } from '../lib/supabase'
import { buildOfflineSnapshot } from '../lib/offlineSync'
import {
  createOfflineVault as createVaultRecord,
  deleteOfflineVault as deleteVaultRecord,
  getOfflineVaultMetadata,
  saveOfflineSnapshot,
  saveOfflineState,
  unlockOfflineVault as unlockVaultRecord,
  getOfflineProjectedBalance,
  type OfflineSnapshot,
  type OfflineTransactionDraft,
  type PendingOfflineTransaction,
  type OfflineVaultMetadata,
} from '../lib/offlineVault'

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

type PwaContextValue = {
  online: boolean
  installed: boolean
  canInstall: boolean
  serviceWorkerSupported: boolean
  serviceWorkerReady: boolean
  serviceWorkerError: string
  updateAvailable: boolean
  installApp: () => Promise<void>
  checkForUpdates: () => Promise<void>
  applyUpdate: () => void
  offlineVaultMetadata: OfflineVaultMetadata | null
  offlineVaultMetadataUserId: string | null
  offlineVaultUnlocked: boolean
  offlineVaultUserId: string | null
  offlineSnapshot: OfflineSnapshot | null
  refreshOfflineVault: (userId: string) => Promise<void>
  createOfflineVault: (userId: string, passphrase: string) => Promise<void>
  unlockOfflineVault: (userId: string, passphrase: string) => Promise<void>
  syncOfflineData: (userId: string) => Promise<OfflineSnapshot>
  enqueueOfflineTransaction: (draft: OfflineTransactionDraft) => Promise<PendingOfflineTransaction>
  removePendingOfflineTransaction: (transactionId: string) => Promise<void>
  retryOfflineTransaction: (transactionId: string) => Promise<void>
  syncPendingTransactions: (userId: string) => Promise<boolean>
  lockOfflineVault: () => void
  clearOfflineVault: (userId: string) => Promise<void>
}

const PwaContext = createContext<PwaContextValue | undefined>(undefined)

function isRunningStandalone() {
  if (typeof window === 'undefined') return false
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches ||
    navigatorWithStandalone.standalone === true
}

export function PwaProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  const [installed, setInstalled] = useState(isRunningStandalone)
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const [serviceWorkerReady, setServiceWorkerReady] = useState(false)
  const [serviceWorkerError, setServiceWorkerError] = useState('')
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null)
  const [offlineVaultMetadata, setOfflineVaultMetadata] = useState<OfflineVaultMetadata | null>(null)
  const [offlineVaultMetadataUserId, setOfflineVaultMetadataUserId] = useState<string | null>(null)
  const [offlineVaultUnlocked, setOfflineVaultUnlocked] = useState(false)
  const [offlineVaultUserId, setOfflineVaultUserId] = useState<string | null>(null)
  const [offlineSnapshot, setOfflineSnapshot] = useState<OfflineSnapshot | null>(null)
  const vaultKeyRef = useRef<CryptoKey | null>(null)
  const vaultUserIdRef = useRef<string | null>(null)
  const snapshotRef = useRef<OfflineSnapshot | null>(null)
  const syncPromiseRef = useRef<Promise<boolean> | null>(null)

  const updateSnapshot = useCallback((snapshot: OfflineSnapshot | null) => {
    snapshotRef.current = snapshot
    setOfflineSnapshot(snapshot)
  }, [])

  const persistLocalSnapshot = useCallback(async (userId: string, snapshot: OfflineSnapshot) => {
    const key = vaultKeyRef.current
    if (!key || vaultUserIdRef.current !== userId) {
      throw new Error('Unlock your offline vault before saving an offline transaction.')
    }
    const metadata = await saveOfflineState(userId, key, snapshot)
    if (vaultKeyRef.current !== key || vaultUserIdRef.current !== userId) {
      throw new Error('The offline vault was locked while saving. Unlock it and try again.')
    }
    updateSnapshot(snapshot)
    setOfflineVaultMetadata(metadata)
    setOfflineVaultMetadataUserId(userId)
  }, [updateSnapshot])

  const lockOfflineVault = useCallback(() => {
    vaultKeyRef.current = null
    vaultUserIdRef.current = null
    syncPromiseRef.current = null
    updateSnapshot(null)
    setOfflineVaultUnlocked(false)
    setOfflineVaultUserId(null)
  }, [updateSnapshot])

  useEffect(() => {
    let active = true

    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as InstallPromptEvent)
    }
    const handleAppInstalled = () => {
      setInstalled(true)
      setInstallPrompt(null)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    async function registerServiceWorker() {
      if (!('serviceWorker' in navigator)) return
      if (!import.meta.env.PROD) return

      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
        if (!active) return

        registrationRef.current = registration
        setServiceWorkerReady(Boolean(registration.active))
        setUpdateAvailable(Boolean(registration.waiting))

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing
          if (!installing) return

          installing.addEventListener('statechange', () => {
            if (!active) return
            if (installing.state === 'redundant') {
              setServiceWorkerError('The application cache could not be prepared. Reconnect and reload Ledger to try again.')
              return
            }
            if (installing.state !== 'installed') return
            if (navigator.serviceWorker.controller) {
              setUpdateAvailable(true)
            } else {
              setServiceWorkerReady(true)
            }
          })
        })

        void navigator.serviceWorker.ready.then(() => {
          if (active) setServiceWorkerReady(true)
        })
      } catch (error) {
        if (active) {
          setServiceWorkerError(
            error instanceof Error ? error.message : 'Service worker registration failed.'
          )
        }
      }
    }

    void registerServiceWorker()

    return () => {
      active = false
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') {
        lockOfflineVault()
        setOfflineVaultMetadata(null)
        setOfflineVaultMetadataUserId(null)
      }
    })
    return () => subscription.unsubscribe()
  }, [lockOfflineVault])

  useEffect(() => {
    let timeout: number | undefined
    const handleVisibilityChange = () => {
      if (timeout !== undefined) window.clearTimeout(timeout)
      timeout = undefined
      if (document.visibilityState === 'hidden' && vaultKeyRef.current) {
        timeout = window.setTimeout(() => lockOfflineVault(), 5 * 60 * 1000)
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      if (timeout !== undefined) window.clearTimeout(timeout)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [lockOfflineVault])

  const installApp = useCallback(async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null)
  }, [installPrompt])

  const checkForUpdates = useCallback(async () => {
    if (!('serviceWorker' in navigator)) return
    const registration = registrationRef.current || await navigator.serviceWorker.getRegistration('/')
    if (!registration) return
    registrationRef.current = registration
    await registration.update()
    setUpdateAvailable(Boolean(registration.waiting))
    setServiceWorkerReady(Boolean(registration.active))
  }, [])

  const applyUpdate = useCallback(() => {
    const waitingWorker = registrationRef.current?.waiting
    if (!waitingWorker) return

    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => window.location.reload(),
      { once: true }
    )
    waitingWorker.postMessage({ type: 'LEDGER_SKIP_WAITING' })
  }, [])

  const refreshOfflineVault = useCallback(async (userId: string) => {
    const metadata = await getOfflineVaultMetadata(userId)
    setOfflineVaultMetadata(metadata)
    setOfflineVaultMetadataUserId(userId)

    if (vaultUserIdRef.current && vaultUserIdRef.current !== userId) {
      lockOfflineVault()
    } else if (!metadata && vaultUserIdRef.current === userId) {
      lockOfflineVault()
    }
  }, [lockOfflineVault])

  const createOfflineVault = useCallback(async (userId: string, passphrase: string) => {
    const result = await createVaultRecord(userId, passphrase)
    vaultKeyRef.current = result.key
    vaultUserIdRef.current = userId
    setOfflineVaultUserId(userId)
    setOfflineVaultUnlocked(true)
    updateSnapshot(result.snapshot)
    setOfflineVaultMetadata(result.metadata)
    setOfflineVaultMetadataUserId(userId)
  }, [updateSnapshot])

  const unlockOfflineVault = useCallback(async (userId: string, passphrase: string) => {
    const result = await unlockVaultRecord(userId, passphrase)
    vaultKeyRef.current = result.key
    vaultUserIdRef.current = userId
    const recoveredSnapshot = result.snapshot ? {
      ...result.snapshot,
      categories: result.snapshot.categories || [],
      pendingTransactions: (result.snapshot.pendingTransactions || []).map(item =>
        item.status === 'syncing'
          ? { ...item, status: 'pending' as const, outcomeUnknown: true, updatedAt: new Date().toISOString() }
          : { ...item, outcomeUnknown: item.outcomeUnknown ?? false }
      ),
    } : null
    if (recoveredSnapshot && recoveredSnapshot.pendingTransactions?.some((item, index) =>
      item.status !== result.snapshot?.pendingTransactions?.[index]?.status
    )) {
      await saveOfflineState(userId, result.key, recoveredSnapshot)
    }
    setOfflineVaultUserId(userId)
    setOfflineVaultUnlocked(true)
    updateSnapshot(recoveredSnapshot)
    setOfflineVaultMetadata(result.metadata)
    setOfflineVaultMetadataUserId(userId)
  }, [updateSnapshot])

  const syncOfflineData = useCallback(async (userId: string) => {
    if (!navigator.onLine) throw new Error('Connect to the internet before synchronizing offline data.')
    const encryptionKey = vaultKeyRef.current
    if (!encryptionKey || vaultUserIdRef.current !== userId) {
      throw new Error('Unlock your offline vault before synchronizing data.')
    }

    const freshSnapshot = await buildOfflineSnapshot(userId)
    if (vaultKeyRef.current !== encryptionKey || vaultUserIdRef.current !== userId) {
      throw new Error('The offline vault was locked while synchronization was running. Unlock it and try again.')
    }
    const snapshot: OfflineSnapshot = {
      ...freshSnapshot,
      schemaVersion: 3,
      pendingTransactions: snapshotRef.current?.pendingTransactions || [],
    }
    const metadata = await saveOfflineSnapshot(userId, encryptionKey, snapshot)
    if (vaultKeyRef.current !== encryptionKey || vaultUserIdRef.current !== userId) {
      throw new Error('The offline vault was locked while saving. Unlock it and try again.')
    }
    updateSnapshot(snapshot)
    setOfflineVaultMetadata(metadata)
    setOfflineVaultMetadataUserId(userId)
    return snapshot
  }, [updateSnapshot])


  const enqueueOfflineTransaction = useCallback(async (draft: OfflineTransactionDraft) => {
    const userId = vaultUserIdRef.current
    const snapshot = snapshotRef.current
    if (!userId || !vaultKeyRef.current) {
      throw new Error('Unlock your encrypted offline vault before saving transactions offline.')
    }
    if (!snapshot) {
      throw new Error('Synchronize your offline data once while connected so Ledger can cache your accounts and categories.')
    }
    if (snapshot.schemaVersion !== 3 || !Array.isArray(snapshot.categories)) {
      throw new Error('Connect to the internet and use Settings → App & offline → Sync now to upgrade your encrypted snapshot before creating offline transactions.')
    }
    if (!Number.isSafeInteger(draft.amountMinor) || draft.amountMinor <= 0) {
      throw new Error('Enter a valid transaction amount.')
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || Number.isNaN(Date.parse(`${draft.date}T00:00:00`))) {
      throw new Error('Enter a valid transaction date.')
    }

    if (draft.operation === 'income_expense') {
      const account = snapshot.accounts.find(item => item.id === draft.accountId && item.isActive)
      const category = (snapshot.categories || []).find(item =>
        item.id === draft.categoryId &&
        item.isActive &&
        item.type === draft.transactionType
      )
      if (!account) throw new Error('The selected financial account is not available in the offline snapshot.')
      if (!category) throw new Error('The selected category is not available in the offline snapshot. Reconnect and synchronize your categories.')
      if (draft.transactionType === 'income' && account.accountType !== 'asset') {
        throw new Error('Income must be received into an asset account.')
      }
    } else {
      const fromAccount = snapshot.accounts.find(item => item.id === draft.fromAccountId && item.isActive)
      const toAccount = snapshot.accounts.find(item => item.id === draft.toAccountId && item.isActive)
      if (!fromAccount || !toAccount) throw new Error('Both transfer accounts must be active accounts in the offline snapshot.')
      if (fromAccount.accountType !== 'asset' || toAccount.accountType !== 'asset') {
        throw new Error('Transfers require two asset accounts.')
      }
      if (draft.fromAccountId === draft.toAccountId) {
        throw new Error('Source and destination accounts must be different.')
      }
      const availableMinor = getOfflineProjectedBalance(snapshot, draft.fromAccountId)
      if (availableMinor < draft.amountMinor) {
        throw new Error('The cached available balance is insufficient for this transfer. Synchronize your accounts before retrying.')
      }
    }

    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const idempotencyKey = crypto.randomUUID()
    const transactionType = draft.operation === 'transfer' ? 'transfer' : draft.transactionType
    const item: PendingOfflineTransaction = {
      id,
      idempotencyKey,
      operation: draft.operation,
      transactionType,
      amountMinor: draft.amountMinor,
      date: draft.date,
      description: draft.description?.trim() || (
        draft.operation === 'transfer'
          ? 'Account Transfer'
          : draft.transactionType === 'income' ? 'Income' : 'Expense'
      ),
      payee: draft.operation === 'income_expense' ? (draft.payee?.trim() || '') : '',
      notes: draft.notes?.trim() || '',
      accountId: draft.operation === 'income_expense' ? draft.accountId : null,
      categoryId: draft.operation === 'income_expense' ? draft.categoryId : null,
      fromAccountId: draft.operation === 'transfer' ? draft.fromAccountId : null,
      toAccountId: draft.operation === 'transfer' ? draft.toAccountId : null,
      status: 'pending',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      lastError: '',
      outcomeUnknown: false,
      serverEntryId: null,
      syncedAt: null,
    }

    const queue = [...(snapshot.pendingTransactions || []), item]
    const syncedItems = queue.filter(entry => entry.status === 'synced')
    const keepSyncedIds = new Set(
      syncedItems
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 250)
        .map(entry => entry.id)
    )
    const retainedQueue = queue.filter(entry =>
      entry.status !== 'synced' || keepSyncedIds.has(entry.id)
    )
    const nextSnapshot: OfflineSnapshot = {
      ...snapshot,
      schemaVersion: 3,
      categories: snapshot.categories || [],
      pendingTransactions: retainedQueue,
    }
    await persistLocalSnapshot(userId, nextSnapshot)
    return item
  }, [persistLocalSnapshot])

  const removePendingOfflineTransaction = useCallback(async (transactionId: string) => {
    const userId = vaultUserIdRef.current
    const snapshot = snapshotRef.current
    if (!userId || !snapshot) throw new Error('Unlock your offline vault first.')
    const item = (snapshot.pendingTransactions || []).find(entry => entry.id === transactionId)
    if (!item) return
    if (item.status === 'syncing' || item.status === 'synced') {
      throw new Error('A transaction being synchronized or already posted cannot be removed.')
    }
    const nextSnapshot: OfflineSnapshot = {
      ...snapshot,
      pendingTransactions: (snapshot.pendingTransactions || []).filter(entry => entry.id !== transactionId),
    }
    await persistLocalSnapshot(userId, nextSnapshot)
  }, [persistLocalSnapshot])

  const syncPendingTransactions = useCallback((userId: string): Promise<boolean> => {
    if (syncPromiseRef.current) return syncPromiseRef.current

    const task = (async () => {
      if (!navigator.onLine) return false
      const encryptionKey = vaultKeyRef.current
      if (!encryptionKey || vaultUserIdRef.current !== userId) {
        throw new Error('Unlock your offline vault before synchronizing pending transactions.')
      }

      const pendingIds = (snapshotRef.current?.pendingTransactions || [])
        .filter(item => item.status === 'pending' || (item.status === 'failed' && item.outcomeUnknown))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(item => item.id)

      if (!pendingIds.length) return false

      let attempted = false

      const saveQueueItem = async (
        transactionId: string,
        update: Partial<PendingOfflineTransaction>
      ) => {
        const currentSnapshot = snapshotRef.current
        if (!currentSnapshot) throw new Error('The offline snapshot is no longer available.')
        const nextSnapshot: OfflineSnapshot = {
          ...currentSnapshot,
          pendingTransactions: (currentSnapshot.pendingTransactions || []).map(item =>
            item.id === transactionId
              ? { ...item, ...update, updatedAt: new Date().toISOString() }
              : item
          ),
        }
        await persistLocalSnapshot(userId, nextSnapshot)
      }

      for (const transactionId of pendingIds) {
        if (!navigator.onLine) break
        if (vaultKeyRef.current !== encryptionKey || vaultUserIdRef.current !== userId) {
          throw new Error('The offline vault was locked during synchronization.')
        }

        const item = (snapshotRef.current?.pendingTransactions || [])
          .find(entry => entry.id === transactionId)
        if (!item || !(item.status === 'pending' || (item.status === 'failed' && item.outcomeUnknown))) continue

        attempted = true
        await saveQueueItem(transactionId, {
          status: 'syncing',
          attempts: item.attempts + 1,
          lastError: '',
        })

        try {
          let data: unknown
          if (item.operation === 'income_expense') {
            const result = await supabase.rpc('create_income_expense_transaction_idempotent', {
              p_idempotency_key: item.idempotencyKey,
              p_transaction_type: item.transactionType,
              p_amount_minor: item.amountMinor,
              p_financial_account_id: item.accountId,
              p_category_account_id: item.categoryId,
              p_entry_date: item.date,
              p_description: item.description,
              p_payee: item.payee || null,
              p_notes: item.notes || null,
            })
            if (result.error) throw result.error
            data = result.data
          } else {
            const result = await supabase.rpc('create_account_transfer_idempotent', {
              p_idempotency_key: item.idempotencyKey,
              p_from_account_id: item.fromAccountId,
              p_to_account_id: item.toAccountId,
              p_amount_minor: item.amountMinor,
              p_entry_date: item.date,
              p_description: item.description,
              p_notes: item.notes || null,
            })
            if (result.error) throw result.error
            data = result.data
          }

          if (typeof data !== 'string' || !data) {
            throw new Error('The server did not return a posted transaction ID. Retry is safe because the same idempotency key will be reused.')
          }

          await saveQueueItem(transactionId, {
            status: 'synced',
            serverEntryId: data,
            syncedAt: new Date().toISOString(),
            lastError: '',
            outcomeUnknown: false,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Transaction synchronization failed.'
          const hasDatabaseErrorCode = Boolean(
            error &&
            typeof error === 'object' &&
            'code' in error &&
            typeof (error as { code?: unknown }).code === 'string'
          )
          await saveQueueItem(transactionId, {
            status: navigator.onLine ? 'failed' : 'pending',
            lastError: message,
            outcomeUnknown: !hasDatabaseErrorCode,
          })
          if (!navigator.onLine) break
        }
      }

      if (attempted && navigator.onLine && vaultKeyRef.current === encryptionKey) {
        try {
          const freshSnapshot = await buildOfflineSnapshot(userId)
          if (vaultKeyRef.current === encryptionKey && vaultUserIdRef.current === userId) {
            const mergedSnapshot: OfflineSnapshot = {
              ...freshSnapshot,
              schemaVersion: 3,
              pendingTransactions: snapshotRef.current?.pendingTransactions || [],
            }
            const metadata = await saveOfflineSnapshot(userId, encryptionKey, mergedSnapshot)
            if (vaultKeyRef.current !== encryptionKey || vaultUserIdRef.current !== userId) {
              throw new Error('The offline vault was locked while saving the synchronized snapshot.')
            }
            updateSnapshot(mergedSnapshot)
            setOfflineVaultMetadata(metadata)
            setOfflineVaultMetadataUserId(userId)
          }
        } catch (error) {
          // Posting results are already persisted in the encrypted queue.
          // A later normal snapshot sync will refresh account balances/history.
          console.warn('Pending transactions posted, but the offline snapshot refresh failed:', error)
        }
      }

      return attempted
    })()

    syncPromiseRef.current = task
    void task.finally(() => {
      if (syncPromiseRef.current === task) syncPromiseRef.current = null
    }).catch(() => undefined)
    return task
  }, [persistLocalSnapshot, updateSnapshot])

  const retryOfflineTransaction = useCallback(async (transactionId: string) => {
    const userId = vaultUserIdRef.current
    const snapshot = snapshotRef.current
    if (!userId || !snapshot) throw new Error('Unlock your offline vault first.')
    const item = (snapshot.pendingTransactions || []).find(entry => entry.id === transactionId)
    if (!item || !(item.status === 'failed' || (item.status === 'pending' && item.outcomeUnknown))) {
      throw new Error('Only failed or uncertain transactions can be retried.')
    }
    const nextSnapshot: OfflineSnapshot = {
      ...snapshot,
      pendingTransactions: (snapshot.pendingTransactions || []).map(entry =>
        entry.id === transactionId
          ? { ...entry, status: 'pending' as const, lastError: '', updatedAt: new Date().toISOString() }
          : entry
      ),
    }
    await persistLocalSnapshot(userId, nextSnapshot)
    if (navigator.onLine) await syncPendingTransactions(userId)
  }, [persistLocalSnapshot, syncPendingTransactions])


  useEffect(() => {
    const hasRetryable = Boolean(
      snapshotRef.current?.pendingTransactions?.some(item =>
        item.status === 'pending' || (item.status === 'failed' && item.outcomeUnknown)
      )
    )
    if (!online || !offlineVaultUnlocked || !offlineVaultUserId || !hasRetryable) return
    void syncPendingTransactions(offlineVaultUserId).catch(error => {
      console.warn('Automatic offline transaction synchronization failed:', error instanceof Error ? error.message : error)
    })
  }, [online, offlineVaultUnlocked, offlineVaultUserId, syncPendingTransactions])

  const clearOfflineVault = useCallback(async (userId: string) => {
    await deleteVaultRecord(userId)
    if (vaultUserIdRef.current === userId) lockOfflineVault()
    setOfflineVaultMetadata(null)
    setOfflineVaultMetadataUserId(userId)
  }, [lockOfflineVault])

  const value: PwaContextValue = {
    online,
    installed,
    canInstall: Boolean(installPrompt),
    serviceWorkerSupported: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
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
    enqueueOfflineTransaction,
    removePendingOfflineTransaction,
    retryOfflineTransaction,
    syncPendingTransactions,
    lockOfflineVault,
    clearOfflineVault,
  }

  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>
}

export function usePwa() {
  const context = useContext(PwaContext)
  if (!context) throw new Error('usePwa must be used inside PwaProvider')
  return context
}
