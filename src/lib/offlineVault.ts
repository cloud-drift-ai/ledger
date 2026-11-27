export type OfflineAccount = {
  id: string
  name: string
  accountType: 'asset' | 'liability'
  subtype: string | null
  isActive: boolean
  includeInNetWorth: boolean
  balanceMinor: number
}

export type OfflineTransaction = {
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

export type OfflineCategory = {
  id: string
  name: string
  type: 'income' | 'expense'
  isActive: boolean
}

export type PendingOfflineTransaction = {
  id: string
  idempotencyKey: string
  operation: 'income_expense' | 'transfer'
  transactionType: 'income' | 'expense' | 'transfer'
  amountMinor: number
  date: string
  description: string
  payee: string
  notes: string
  accountId: string | null
  categoryId: string | null
  fromAccountId: string | null
  toAccountId: string | null
  status: 'pending' | 'syncing' | 'failed' | 'synced'
  attempts: number
  createdAt: string
  updatedAt: string
  lastError: string
  // True when the request may have reached the server but the response was lost.
  // Such items must be retried with the same key, never deleted/re-created.
  outcomeUnknown: boolean
  serverEntryId: string | null
  syncedAt: string | null
}

export type OfflineIncomeExpenseDraft = {
  operation: 'income_expense'
  transactionType: 'income' | 'expense'
  amountMinor: number
  date: string
  description?: string
  payee?: string
  notes?: string
  accountId: string
  categoryId: string
}

export type OfflineTransferDraft = {
  operation: 'transfer'
  amountMinor: number
  date: string
  description?: string
  notes?: string
  fromAccountId: string
  toAccountId: string
}

export type OfflineTransactionDraft = OfflineIncomeExpenseDraft | OfflineTransferDraft

export type OfflineInvestmentActivity = {
  id: string
  instrumentId: string
  instrumentName: string
  activityType: string
  date: string
  amountMinor: number
  units: number | null
  unitPriceMinor: number | null
  feesMinor: number
  costBasisMinor: number | null
  fundingMode: string | null
  counterpartyAccountName: string
  counterpartyCategoryName: string
  notes: string
  createdAt: string
}

export type OfflineInvestmentValuation = {
  id: string
  instrumentId: string
  date: string
  marketValueMinor: number
  unitPriceMinor: number | null
  units: number | null
  source: string
  notes: string
  createdAt: string
}

export type OfflineInvestment = {
  id: string
  ledgerAccountId: string
  name: string
  instrumentType: string
  institution: string
  tickerSymbol: string
  currency: string
  purchaseDate: string | null
  maturityDate: string | null
  units: number | null
  unitCostMinor: number | null
  notes: string
  isActive: boolean
  accountName: string
  bookValueMinor: number
  currentValueMinor: number
  costBasisMinor: number
  unrealizedResultMinor: number
  realizedResultMinor: number
  incomeMinor: number
  latestValuationDate: string | null
  latestValuationSource: string | null
  activityCount: number
}

export type OfflineGpfRateTier = {
  id: string
  lowerBalanceMinor: number
  upperBalanceMinor: number | null
  annualRateBasisPoints: number
  sortOrder: number
}

export type OfflineGpfProfile = {
  id: string
  instrumentId: string
  instrumentName: string
  financialYear: string
  financialYearStart: string
  openingBalanceMinor: number
  monthlyContributionMinor: number
  annualContributionIncreasePercent: number
  projectionYears: number
  currentBalanceMinor: number
  rateSchedule: {
    financialYear: string
    effectiveFrom: string
    sourceTitle: string
    sourceDate: string | null
    sourceReference: string
  } | null
  rateTiers: OfflineGpfRateTier[]
}

export type OfflineGpfCalculationSnapshot = {
  id: string
  profileId: string
  financialYear: string
  calculationDate: string
  openingBalanceMinor: number
  monthlyContributionMinor: number
  annualRateBasisPoints: number
  openingInterestMinor: number
  annualContributionMinor: number
  contributionInterestMinor: number
  withdrawalMinor: number
  closingBalanceMinor: number
  annualContributionIncreasePercent: number
  projectionYears: number
  totalProjectedContributionsMinor: number
  finalProjectedBalanceMinor: number
  totalProjectedEarningsMinor: number
  notes: string
  createdAt: string
}

export type OfflineSnapshot = {
  // Versions 1 and 2 remain readable. Version 3 adds cached categories and
  // the encrypted local transaction queue.
  schemaVersion: 1 | 2 | 3
  generatedAt: string
  accounts: OfflineAccount[]
  categories?: OfflineCategory[]
  transactions: OfflineTransaction[]
  pendingTransactions?: PendingOfflineTransaction[]
  summary: {
    assetsMinor: number
    liabilitiesMinor: number
    netWorthMinor: number
    availableBalanceMinor: number
  }
  transactionLimit: number
  investments?: OfflineInvestment[]
  investmentActivities?: OfflineInvestmentActivity[]
  investmentValuations?: OfflineInvestmentValuation[]
  gpfProfiles?: OfflineGpfProfile[]
  gpfCalculationSnapshots?: OfflineGpfCalculationSnapshot[]
}

export function getOfflineProjectedBalance(snapshot: OfflineSnapshot, accountId: string) {
  const account = snapshot.accounts.find(item => item.id === accountId)
  if (!account) return 0

  let balance = account.balanceMinor
  for (const item of snapshot.pendingTransactions || []) {
    // If the RPC succeeded but refreshing the snapshot failed, the synced
    // item is newer than the cloud snapshot and must still affect local
    // projected balances. A later snapshot refresh naturally removes it.
    const syncedAfterSnapshot = item.status === 'synced' &&
      Boolean(item.syncedAt && item.syncedAt > snapshot.generatedAt)
    if (item.status === 'synced' && !syncedAfterSnapshot) continue
    if (item.status === 'failed' && !item.outcomeUnknown) continue

    if (item.operation === 'transfer') {
      if (item.fromAccountId === accountId) balance -= item.amountMinor
      if (item.toAccountId === accountId) balance += item.amountMinor
      continue
    }

    if (item.accountId !== accountId) continue
    if (item.transactionType === 'income') {
      balance += item.amountMinor
    } else if (item.transactionType === 'expense') {
      balance += account.accountType === 'asset' ? -item.amountMinor : item.amountMinor
    }
  }

  return balance
}

export type OfflineVaultMetadata = {
  createdAt: string
  lastSyncedAt: string | null
}

type VaultRecord = {
  userId: string
  version: 1
  salt: string
  iv: string
  ciphertext: string
  createdAt: string
  lastSyncedAt: string | null
}

const DATABASE_NAME = 'ledger-offline-vault'
const STORE_NAME = 'encrypted-snapshots'
const DATABASE_VERSION = 1
const PBKDF2_ITERATIONS = 310_000
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function requireCrypto() {
  if (!globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues) {
    throw new Error('Secure offline storage is unavailable in this browser. Use Ledger through HTTPS or localhost with a current browser.')
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('This browser does not support local offline storage.'))
      return
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'userId' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Could not open offline storage.'))
    request.onblocked = () => reject(new Error('Offline storage is busy in another Ledger tab. Close other Ledger tabs and try again.'))
  })
}

async function readRecord(userId: string): Promise<VaultRecord | null> {
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(userId)
      request.onsuccess = () => resolve((request.result as VaultRecord | undefined) || null)
      request.onerror = () => reject(request.error || new Error('Could not read offline data.'))
    })
  } finally {
    database.close()
  }
}

async function writeRecord(record: VaultRecord) {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put(record)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error || new Error('Could not save encrypted offline data.'))
      transaction.onabort = () => reject(transaction.error || new Error('Saving encrypted offline data was cancelled.'))
    })
  } finally {
    database.close()
  }
}

async function deriveEncryptionKey(passphrase: string, salt: Uint8Array) {
  requireCrypto()
  // TypeScript 6 models Uint8Array as Uint8Array<ArrayBufferLike>, while
  // Web Crypto's BufferSource typing requires an ArrayBuffer-backed view.
  // Copy the salt into an explicitly allocated ArrayBuffer before use.
  const saltBuffer = new ArrayBuffer(salt.byteLength)
  new Uint8Array(saltBuffer).set(salt)

  const material = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  )

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBuffer, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

async function encryptSnapshot(snapshot: OfflineSnapshot | null, key: CryptoKey) {
  requireCrypto()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = textEncoder.encode(JSON.stringify(snapshot))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  }
}

async function decryptSnapshot(record: VaultRecord, key: CryptoKey): Promise<OfflineSnapshot | null> {
  requireCrypto()
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(record.iv) },
    key,
    base64ToBytes(record.ciphertext)
  )
  return JSON.parse(textDecoder.decode(plaintext)) as OfflineSnapshot | null
}

export async function getOfflineVaultMetadata(userId: string): Promise<OfflineVaultMetadata | null> {
  const record = await readRecord(userId)
  if (!record) return null
  return { createdAt: record.createdAt, lastSyncedAt: record.lastSyncedAt }
}

export async function createOfflineVault(userId: string, passphrase: string) {
  requireCrypto()
  if (await readRecord(userId)) {
    throw new Error('An offline vault already exists for this account on this device. Unlock it or delete it before creating another.')
  }

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveEncryptionKey(passphrase, salt)
  const encrypted = await encryptSnapshot(null, key)
  const createdAt = new Date().toISOString()

  await writeRecord({
    userId,
    version: 1,
    salt: bytesToBase64(salt),
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext,
    createdAt,
    lastSyncedAt: null,
  })

  return {
    key,
    snapshot: null as OfflineSnapshot | null,
    metadata: { createdAt, lastSyncedAt: null } satisfies OfflineVaultMetadata,
  }
}

export async function unlockOfflineVault(userId: string, passphrase: string) {
  const record = await readRecord(userId)
  if (!record) throw new Error('No offline vault exists for this Ledger account on this device.')

  try {
    const key = await deriveEncryptionKey(passphrase, base64ToBytes(record.salt))
    const snapshot = await decryptSnapshot(record, key)
    return {
      key,
      snapshot,
      metadata: { createdAt: record.createdAt, lastSyncedAt: record.lastSyncedAt } satisfies OfflineVaultMetadata,
    }
  } catch {
    throw new Error('The offline passphrase is incorrect, or the encrypted offline copy could not be verified.')
  }
}

export async function saveOfflineSnapshot(userId: string, key: CryptoKey, snapshot: OfflineSnapshot) {
  const record = await readRecord(userId)
  if (!record) throw new Error('The offline vault no longer exists. Create it again from Settings.')

  const encrypted = await encryptSnapshot(snapshot, key)
  await writeRecord({
    ...record,
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext,
    lastSyncedAt: snapshot.generatedAt,
  })

  return { createdAt: record.createdAt, lastSyncedAt: snapshot.generatedAt } satisfies OfflineVaultMetadata
}

export async function saveOfflineState(userId: string, key: CryptoKey, snapshot: OfflineSnapshot) {
  const record = await readRecord(userId)
  if (!record) throw new Error('The offline vault no longer exists. Create it again from Settings.')

  const encrypted = await encryptSnapshot(snapshot, key)
  await writeRecord({
    ...record,
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext,
    // Local queue edits must never make the last cloud-sync timestamp newer.
    lastSyncedAt: record.lastSyncedAt,
  })

  return { createdAt: record.createdAt, lastSyncedAt: record.lastSyncedAt } satisfies OfflineVaultMetadata
}

export async function deleteOfflineVault(userId: string) {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).delete(userId)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error || new Error('Could not delete the offline copy.'))
      transaction.onabort = () => reject(transaction.error || new Error('Deleting the offline copy was cancelled.'))
    })
  } finally {
    database.close()
  }
}
