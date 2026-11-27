import { useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  FileUp,
  LoaderCircle,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { formatBDTCurrencyMinor } from '../lib/preferences'

type Account = {
  id: string
  name: string
  account_kind: 'financial' | 'category'
  account_type: 'asset' | 'liability' | 'equity' | 'income' | 'expense'
  subtype: string | null
  is_active: boolean
}

type MappingKey = 'date' | 'amount' | 'debit' | 'credit' | 'type' | 'description' | 'payee' | 'account' | 'category' | 'notes'
type Mapping = Record<MappingKey, number>
type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'
type RowStatus = 'ready' | 'invalid' | 'duplicate' | 'possible' | 'imported' | 'failed'

type ImportRow = {
  rowNumber: number
  date: string
  type: 'income' | 'expense'
  amountMinor: number
  description: string
  payee: string
  notes: string
  accountId: string
  accountName: string
  categoryId: string
  categoryName: string
  status: RowStatus
  message: string
  include: boolean
  fingerprint: string
  baseFingerprint: string
  forceDuplicate: boolean
}

type ExistingEntry = {
  id: string
  entry_date: string
  transaction_type: 'income' | 'expense'
  description: string | null
  payee: string | null
}

type ExistingLine = {
  journal_entry_id: string
  ledger_account_id: string
  debit_minor: number | string
  credit_minor: number | string
}

type Props = {
  accounts: Account[]
  onClose: () => void
  onImported: () => Promise<void>
}

const EMPTY_MAPPING: Mapping = {
  date: -1,
  amount: -1,
  debit: -1,
  credit: -1,
  type: -1,
  description: -1,
  payee: -1,
  account: -1,
  category: -1,
  notes: -1,
}

const FIELD_LABELS: Record<MappingKey, string> = {
  date: 'Transaction date',
  amount: 'Amount',
  debit: 'Debit amount',
  credit: 'Credit amount',
  type: 'Transaction type',
  description: 'Description / particulars',
  payee: 'Payee / merchant',
  account: 'Financial account',
  category: 'Category',
  notes: 'Notes / reference',
}

const HEADER_HINTS: Record<MappingKey, string[]> = {
  date: ['date', 'transaction date', 'posting date', 'value date', 'trans date'],
  amount: ['amount', 'transaction amount', 'value', 'bdt amount', 'total'],
  debit: ['debit', 'withdrawal', 'money out', 'paid out'],
  credit: ['credit', 'deposit', 'money in', 'paid in'],
  type: ['type', 'transaction type', 'dr cr', 'debit credit', 'direction'],
  description: ['description', 'particulars', 'details', 'narration', 'memo', 'transaction details'],
  payee: ['payee', 'merchant', 'party', 'beneficiary', 'sender', 'receiver'],
  account: ['account', 'account name', 'financial account', 'bank account', 'wallet'],
  category: ['category', 'expense category', 'income category'],
  notes: ['notes', 'note', 'reference', 'remarks', 'cheque number'],
}

const normalizeText = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const normalizeHeader = (value: unknown) => normalizeText(value).replace(/[^a-z0-9 ]/g, '')
const formatMoney = (minor: number) => formatBDTCurrencyMinor(minor)

function inferMapping(headers: string[]): Mapping {
  const result = { ...EMPTY_MAPPING }
  for (const key of Object.keys(HEADER_HINTS) as MappingKey[]) {
    const index = headers.findIndex(header => {
      const normalized = normalizeHeader(header)
      return HEADER_HINTS[key].some(hint => normalized === normalizeHeader(hint) || normalized.includes(normalizeHeader(hint)))
    })
    if (index >= 0) result[key] = index
  }
  return result
}

function parseDateValue(value: unknown, dateFormat: DateFormat): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  if (typeof value === 'number' && Number.isFinite(value) && value > 20000 && value < 100000) {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (!parsed) return null
    return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
  }

  const text = String(value ?? '').trim()
  if (!text) return null
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (iso) {
    const year = Number(iso[1])
    const month = Number(iso[2])
    const day = Number(iso[3])
    const date = new Date(year, month - 1, day)
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  const parts = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/)
  if (parts) {
    const first = Number(parts[1])
    const second = Number(parts[2])
    let year = Number(parts[3])
    if (year < 100) year += year >= 70 ? 1900 : 2000
    const day = dateFormat === 'MM/DD/YYYY' ? second : first
    const month = dateFormat === 'MM/DD/YYYY' ? first : second
    if (dateFormat === 'YYYY-MM-DD') return null
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    const date = new Date(year, month - 1, day)
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  const fallback = new Date(text)
  if (!Number.isNaN(fallback.getTime())) {
    return `${fallback.getFullYear()}-${String(fallback.getMonth() + 1).padStart(2, '0')}-${String(fallback.getDate()).padStart(2, '0')}`
  }
  return null
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const text = String(value ?? '').trim()
  if (!text) return null
  const negativeByParentheses = /^\(.*\)$/.test(text)
  const cleaned = text.replace(/[৳$€£,\s]/g, '').replace(/[()]/g, '').replace(/[^0-9.+-]/g, '')
  if (!cleaned || !/^[+-]?\d+(\.\d+)?$/.test(cleaned)) return null
  const parsed = Number(cleaned)
  if (!Number.isFinite(parsed)) return null
  return negativeByParentheses ? -Math.abs(parsed) : parsed
}

function amountToMinor(value: number): number | null {
  const minor = Math.round(Math.abs(value) * 100)
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null
}

function parseTransactionType(value: unknown): 'income' | 'expense' | null {
  const text = normalizeText(value)
  if (['income', 'credit', 'deposit', 'received', 'in', 'cr'].includes(text)) return 'income'
  if (['expense', 'debit', 'withdrawal', 'paid', 'out', 'dr'].includes(text)) return 'expense'
  return null
}

function fingerprint(row: Pick<ImportRow, 'date' | 'type' | 'amountMinor' | 'accountId' | 'categoryId' | 'description' | 'payee'>) {
  return [row.date, row.type, row.amountMinor, row.accountId, row.categoryId, normalizeText(row.description), normalizeText(row.payee)].join('|')
}

function baseFingerprint(row: Pick<ImportRow, 'date' | 'type' | 'amountMinor' | 'accountId' | 'categoryId'>) {
  return [row.date, row.type, row.amountMinor, row.accountId, row.categoryId].join('|')
}

export default function TransactionImportWizard({ accounts, onClose, onImported }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const workbookRef = useRef<XLSX.WorkBook | null>(null)
  const [fileName, setFileName] = useState('')
  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [sheetName, setSheetName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [sourceRows, setSourceRows] = useState<unknown[][]>([])
  const [firstDataRowNumber, setFirstDataRowNumber] = useState(2)
  const [mapping, setMapping] = useState<Mapping>(EMPTY_MAPPING)
  const [dateFormat, setDateFormat] = useState<DateFormat>('DD/MM/YYYY')
  const [defaultType, setDefaultType] = useState<'income' | 'expense'>('expense')
  const [defaultAccountId, setDefaultAccountId] = useState('')
  const [defaultIncomeCategoryId, setDefaultIncomeCategoryId] = useState('')
  const [defaultExpenseCategoryId, setDefaultExpenseCategoryId] = useState('')
  const [rows, setRows] = useState<ImportRow[]>([])
  const [step, setStep] = useState<'setup' | 'preview' | 'results'>('setup')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const financialAccounts = useMemo(() => accounts.filter(account => account.account_kind === 'financial' && account.is_active && (account.account_type === 'asset' || account.account_type === 'liability')), [accounts])
  const incomeCategories = useMemo(() => accounts.filter(account => account.account_kind === 'category' && account.account_type === 'income' && account.is_active), [accounts])
  const expenseCategories = useMemo(() => accounts.filter(account => account.account_kind === 'category' && account.account_type === 'expense' && account.is_active), [accounts])
  const selectedRows = rows.filter(row => row.include && row.status !== 'imported')
  const readyRows = selectedRows.filter(row => row.status !== 'invalid' && row.status !== 'failed')
  const exactDuplicateCount = rows.filter(row => row.status === 'duplicate').length
  const possibleDuplicateCount = rows.filter(row => row.status === 'possible').length
  const invalidCount = rows.filter(row => row.status === 'invalid').length
  const importedCount = rows.filter(row => row.status === 'imported').length

  const getSheet = (name: string) => {
    const worksheet = workbookRef.current?.Sheets[name]
    if (!worksheet) throw new Error('The selected worksheet could not be read.')
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, raw: true, defval: '' })
    const headerIndex = matrix.findIndex(row => row.some(value => String(value ?? '').trim() !== ''))
    if (headerIndex < 0) throw new Error('The selected worksheet is empty.')
    const foundHeaders = (matrix[headerIndex] || []).map((value, index) => String(value ?? '').trim() || `Column ${index + 1}`)
    const foundRows = matrix.slice(headerIndex + 1).filter(row => row.some(value => String(value ?? '').trim() !== ''))
    if (!foundRows.length) throw new Error('No transaction rows were found below the header row.')
    setHeaders(foundHeaders)
    setSourceRows(foundRows)
    setFirstDataRowNumber(headerIndex + 2)
    setMapping(inferMapping(foundHeaders))
    setRows([])
    setStep('setup')
  }

  const downloadCsvTemplate = () => {
    const worksheet = XLSX.utils.aoa_to_sheet([['Date', 'Type', 'Amount', 'Description', 'Payee', 'Account', 'Category', 'Notes']])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Transactions')
    XLSX.writeFile(workbook, 'Ledger_Transaction_Import_Template.csv', { bookType: 'csv' })
  }

  const handleFile = async (file?: File) => {
    setError('')
    setNotice('')
    setRows([])
    setFileName('')
    setSheetNames([])
    setSheetName('')
    setHeaders([])
    setSourceRows([])
    workbookRef.current = null
    setStep('setup')
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      setError('Please use a file smaller than 10 MB. Split larger statements into smaller files.')
      return
    }
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
      if (!workbook.SheetNames.length) throw new Error('No worksheets were found in this file.')
      workbookRef.current = workbook
      setFileName(file.name)
      setSheetNames(workbook.SheetNames)
      setSheetName(workbook.SheetNames[0])
      getSheet(workbook.SheetNames[0])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to read this file.')
    }
  }

  const loadExistingTransactions = async (fromDate: string, toDate: string) => {
    const existingEntries: ExistingEntry[] = []
    for (let offset = 0; ; offset += 1000) {
      const { data, error: queryError } = await supabase
        .from('journal_entries')
        .select('id, entry_date, transaction_type, description, payee')
        .eq('status', 'posted')
        .in('transaction_type', ['income', 'expense'])
        .gte('entry_date', fromDate)
        .lte('entry_date', toDate)
        .order('entry_date', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + 999)
      if (queryError) throw queryError
      const page = (data || []) as ExistingEntry[]
      existingEntries.push(...page)
      if (page.length < 1000) break
    }

    const existingLines: ExistingLine[] = []
    for (let offset = 0; offset < existingEntries.length; offset += 200) {
      const ids = existingEntries.slice(offset, offset + 200).map(entry => entry.id)
      const { data, error: lineError } = await supabase
        .from('journal_lines')
        .select('journal_entry_id, ledger_account_id, debit_minor, credit_minor')
        .in('journal_entry_id', ids)
      if (lineError) throw lineError
      existingLines.push(...((data || []) as ExistingLine[]))
    }

    const { data: allAccountData, error: allAccountError } = await supabase
      .from('ledger_accounts')
      .select('id, name, account_kind, account_type, subtype, is_active')
    if (allAccountError) throw allAccountError
    const accountMap = new Map<string, Account>((allAccountData || []).map(account => [account.id, account as Account] as const))
    for (const account of accounts) accountMap.set(account.id, account)
    const linesByEntry = new Map<string, ExistingLine[]>()
    for (const line of existingLines) {
      const current = linesByEntry.get(line.journal_entry_id) || []
      current.push(line)
      linesByEntry.set(line.journal_entry_id, current)
    }

    const exact = new Set<string>()
    const possible = new Set<string>()
    for (const entry of existingEntries) {
      const lines = linesByEntry.get(entry.id) || []
      const categoryLine = lines.find(line => accountMap.get(line.ledger_account_id)?.account_kind === 'category')
      const financialLine = lines.find(line => accountMap.get(line.ledger_account_id)?.account_kind === 'financial')
      if (!categoryLine || !financialLine) continue
      const category = accountMap.get(categoryLine.ledger_account_id)
      const financial = accountMap.get(financialLine.ledger_account_id)
      if (!category || !financial) continue
      const row = {
        date: entry.entry_date,
        type: entry.transaction_type,
        amountMinor: Number(categoryLine.debit_minor) + Number(categoryLine.credit_minor),
        accountId: financial.id,
        categoryId: category.id,
        description: entry.description || '',
        payee: entry.payee || '',
      }
      exact.add(fingerprint(row))
      possible.add(baseFingerprint(row))
    }
    return { exact, possible }
  }

  const buildPreview = async () => {
    setError('')
    setNotice('')
    if (!headers.length || !sourceRows.length) {
      setError('Choose a CSV or Excel file first.')
      return
    }
    if (mapping.date < 0 || (mapping.amount < 0 && (mapping.debit < 0 || mapping.credit < 0))) {
      setError('Map a transaction date and either an amount column or both debit and credit columns.')
      return
    }
    if (sourceRows.length > 500) {
      setError('This import contains more than 500 rows. Please split it into smaller files to review and import safely.')
      return
    }

    setBusy(true)
    try {
      const accountByName = new Map(financialAccounts.map(account => [normalizeText(account.name), account]))
      const categoryByTypeAndName = new Map<string, Account>(accounts.filter(account => account.account_kind === 'category' && account.is_active).map(account => [`${account.account_type}|${normalizeText(account.name)}`, account] as const))
      const mappedRows: ImportRow[] = sourceRows.map((source, index) => {
        const value = (key: MappingKey) => mapping[key] >= 0 ? source[mapping[key]] : ''
        const warnings: string[] = []
        let type: 'income' | 'expense' = defaultType
        let amountValue: number | null = null

        if (mapping.debit >= 0 || mapping.credit >= 0) {
          const debit = mapping.debit >= 0 ? parseNumeric(value('debit')) || 0 : 0
          const credit = mapping.credit >= 0 ? parseNumeric(value('credit')) || 0 : 0
          if (debit > 0 && credit > 0) {
            return invalidRow(index, 'Both debit and credit contain an amount.')
          }
          if (debit > 0 || credit > 0) {
            type = debit > 0 ? 'expense' : 'income'
            amountValue = debit > 0 ? debit : credit
          } else if (mapping.amount >= 0) {
            amountValue = parseNumeric(value('amount'))
            if (mapping.type >= 0) {
              const parsedType = parseTransactionType(value('type'))
              if (!parsedType) return invalidRow(index, 'Transaction type must be income/credit/deposit or expense/debit/withdrawal.')
              type = parsedType
            } else if (amountValue !== null && amountValue < 0) {
              type = 'expense'
            }
          } else {
            return invalidRow(index, 'Neither debit nor credit contains an amount.')
          }
        } else {
          amountValue = mapping.amount >= 0 ? parseNumeric(value('amount')) : null
          if (mapping.type >= 0) {
            const parsedType = parseTransactionType(value('type'))
            if (!parsedType) return invalidRow(index, 'Transaction type must be income/credit/deposit or expense/debit/withdrawal.')
            type = parsedType
          } else if (amountValue !== null && amountValue < 0) {
            type = 'expense'
          }
        }

        if (amountValue === null) return invalidRow(index, 'Amount is missing or invalid.')
        const amountMinor = amountToMinor(amountValue)
        if (amountMinor === null) return invalidRow(index, 'Amount must be greater than zero.')

        const date = parseDateValue(value('date'), dateFormat)
        if (!date) return invalidRow(index, 'Date is missing or could not be parsed using the selected date format.')

        const accountText = String(value('account') ?? '').trim()
        let financial = accountText ? accountByName.get(normalizeText(accountText)) : undefined
        if (!financial) {
          financial = financialAccounts.find(account => account.id === defaultAccountId)
          if (accountText && financial) warnings.push(`Account “${accountText}” not found; default account used.`)
        }
        if (!financial) return invalidRow(index, 'No matching financial account. Select a default account or map an account name.')
        if (type === 'income' && financial.account_type !== 'asset') return invalidRow(index, `Income cannot be recorded into liability account “${financial.name}”.`)

        const categoryText = String(value('category') ?? '').trim()
        let category = categoryText ? categoryByTypeAndName.get(`${type}|${normalizeText(categoryText)}`) : undefined
        if (!category) {
          category = (type === 'income' ? incomeCategories : expenseCategories).find(item => item.id === (type === 'income' ? defaultIncomeCategoryId : defaultExpenseCategoryId))
          if (categoryText && category) warnings.push(`Category “${categoryText}” not found for ${type}; default category used.`)
        }
        if (!category) return invalidRow(index, `No ${type} category is available.`)

        const description = String(value('description') ?? '').trim() || String(value('payee') ?? '').trim() || 'Imported transaction'
        const payee = String(value('payee') ?? '').trim().slice(0, 120)
        const notes = String(value('notes') ?? '').trim().slice(0, 1000)
        const rowBase = {
          rowNumber: firstDataRowNumber + index,
          date,
          type,
          amountMinor,
          description: description.slice(0, 200),
          payee,
          notes,
          accountId: financial.id,
          accountName: financial.name,
          categoryId: category.id,
          categoryName: category.name,
          status: 'ready' as RowStatus,
          message: warnings.join(' '),
          include: true,
          fingerprint: '',
          baseFingerprint: '',
          forceDuplicate: false,
        }
        return { ...rowBase, fingerprint: fingerprint(rowBase), baseFingerprint: baseFingerprint(rowBase) }
      })

      const validRows = mappedRows.filter(row => row.status !== 'invalid')
      if (!validRows.length) {
        setRows(mappedRows)
        setStep('preview')
        setError('No valid rows were found. Review the row errors and column mappings.')
        return
      }

      const dates = validRows.map(row => row.date).sort()
      const existing = await loadExistingTransactions(dates[0], dates[dates.length - 1])
      const seenInFile = new Set<string>()
      const seenBaseInFile = new Set<string>()
      const annotated = mappedRows.map(row => {
        if (row.status === 'invalid') return row
        if (existing.exact.has(row.fingerprint) || seenInFile.has(row.fingerprint)) {
          seenInFile.add(row.fingerprint)
          seenBaseInFile.add(row.baseFingerprint)
          return { ...row, status: 'duplicate' as RowStatus, include: false, message: row.message ? `${row.message} Exact duplicate detected.` : 'An exact matching transaction already exists.' }
        }
        if (existing.possible.has(row.baseFingerprint) || seenBaseInFile.has(row.baseFingerprint)) {
          seenInFile.add(row.fingerprint)
          seenBaseInFile.add(row.baseFingerprint)
          return { ...row, status: 'possible' as RowStatus, include: false, message: row.message ? `${row.message} Similar transaction found; review before importing.` : 'A transaction with the same date, type, amount, account and category exists. Review before importing.' }
        }
        seenInFile.add(row.fingerprint)
        seenBaseInFile.add(row.baseFingerprint)
        return row
      })
      setRows(annotated)
      setStep('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to prepare the import preview.')
    } finally {
      setBusy(false)
    }
  }

  function invalidRow(index: number, message: string): ImportRow {
    return {
      rowNumber: firstDataRowNumber + index,
      date: '',
      type: 'expense',
      amountMinor: 0,
      description: '',
      payee: '',
      notes: '',
      accountId: '',
      accountName: '',
      categoryId: '',
      categoryName: '',
      status: 'invalid',
      message,
      include: false,
      fingerprint: '',
      baseFingerprint: '',
      forceDuplicate: false,
    }
  }

  const toggleRow = (rowNumber: number) => setRows(current => current.map(row => {
    if (row.rowNumber !== rowNumber || row.status === 'imported' || row.status === 'invalid') return row
    const include = !row.include
    return { ...row, include, status: row.status === 'failed' && include ? 'ready' : row.status, forceDuplicate: include && (row.status === 'duplicate' || row.status === 'possible') }
  }))
  const toggleAllReady = (checked: boolean) => setRows(current => current.map(row => {
    if (row.status === 'invalid' || row.status === 'imported' || row.status === 'duplicate') return row
    return { ...row, include: checked, status: row.status === 'failed' && checked ? 'ready' : row.status, forceDuplicate: false }
  }))

  const importSelected = async () => {
    const toImport = rows.filter(row => row.include && row.status !== 'invalid' && row.status !== 'imported' && row.status !== 'failed')
    if (!toImport.length) {
      setError('Select at least one valid transaction to import.')
      return
    }
    const confirmed = window.confirm(`Import ${toImport.length} transaction${toImport.length === 1 ? '' : 's'} into Ledger?\n\nEach transaction will be posted through the existing accounting function. Rows that fail validation will be reported separately.`)
    if (!confirmed) return

    setBusy(true)
    setError('')
    setNotice('')
    setProgress(0)
    let imported = 0
    let failed = 0
    let newlyDetectedDuplicates = 0
    let pending = [...toImport]
    try {
      const dates = pending.map(row => row.date).sort()
      const existing = await loadExistingTransactions(dates[0], dates[dates.length - 1])
      const stillSafe: ImportRow[] = []
      for (const row of pending) {
        if (existing.exact.has(row.fingerprint) && !row.forceDuplicate) {
          newlyDetectedDuplicates += 1
          setRows(current => current.map(item => item.rowNumber === row.rowNumber ? { ...item, status: 'duplicate', include: false, forceDuplicate: false, message: 'An exact matching transaction now exists. It was skipped during the final duplicate check.' } : item))
        } else if (existing.possible.has(row.baseFingerprint) && !row.forceDuplicate) {
          newlyDetectedDuplicates += 1
          setRows(current => current.map(item => item.rowNumber === row.rowNumber ? { ...item, status: 'possible', include: false, forceDuplicate: false, message: 'A similar transaction now exists. It was skipped during the final duplicate check.' } : item))
        } else {
          stillSafe.push(row)
        }
      }
      pending = stillSafe
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? `Could not re-check duplicates. Nothing was imported. ${err.message}` : 'Could not re-check duplicates. Nothing was imported.')
      return
    }
    if (!pending.length) {
      setBusy(false)
      setStep('results')
      setProgress(100)
      setNotice(`${newlyDetectedDuplicates} duplicate row${newlyDetectedDuplicates === 1 ? '' : 's'} skipped. Nothing new was imported.`)
      return
    }
    for (let index = 0; index < pending.length; index += 1) {
      const row = pending[index]
      try {
        const { error: rpcError } = await supabase.rpc('create_income_expense_transaction', {
          p_transaction_type: row.type,
          p_amount_minor: row.amountMinor,
          p_financial_account_id: row.accountId,
          p_category_account_id: row.categoryId,
          p_entry_date: row.date,
          p_description: row.description || null,
          p_payee: row.payee || null,
          p_notes: row.notes || null,
        })
        if (rpcError) throw rpcError
        imported += 1
        setRows(current => current.map(item => item.rowNumber === row.rowNumber ? { ...item, status: 'imported', include: false, message: 'Imported successfully.' } : item))
      } catch (err) {
        failed += 1
        setRows(current => current.map(item => item.rowNumber === row.rowNumber ? { ...item, status: 'failed', include: false, message: err instanceof Error ? err.message : 'Import failed. Check the row and try again.' } : item))
      }
      setProgress(Math.round(((index + 1) / pending.length) * 100))
    }

    setBusy(false)
    setStep('results')
    setNotice(`${imported} transaction${imported === 1 ? '' : 's'} imported${failed ? `; ${failed} failed` : ''}${newlyDetectedDuplicates ? `; ${newlyDetectedDuplicates} new duplicate${newlyDetectedDuplicates === 1 ? '' : 's'} skipped` : ''}.`)
    if (imported > 0) await onImported()
  }

  const selectColumn = (key: MappingKey, value: string) => setMapping(current => ({ ...current, [key]: value === '' ? -1 : Number(value) }))
  const fieldSelect = (key: MappingKey) => (
    <label key={key} className="block min-w-0 text-xs font-semibold text-slate-600">
      <span className="mb-1.5 block">{FIELD_LABELS[key]}</span>
      <select value={mapping[key] < 0 ? '' : String(mapping[key])} onChange={event => selectColumn(key, event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2.5 text-xs font-normal text-slate-700 outline-none focus:border-[var(--ledger-accent)]">
        <option value="">Not mapped</option>
        {headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{header}</option>)}
      </select>
    </label>
  )

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/55 p-3 sm:p-5">
      <section className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--ledger-accent-soft)] text-[var(--ledger-accent)]"><FileSpreadsheet size={20}/></span>
            <div><h2 className="text-lg font-bold text-slate-900">Import transactions</h2><p className="mt-1 text-xs text-slate-500">Review and validate a bank statement before posting transactions to Ledger.</p></div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-40" aria-label="Close import wizard"><X size={19}/></button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          <div className="mb-5 grid grid-cols-3 gap-2 text-center text-[11px] font-semibold">
            {(['setup', 'preview', 'results'] as const).map((item, index) => <div key={item} className={`rounded-lg px-2 py-2 ${step === item ? 'bg-[var(--ledger-accent-soft)] text-[var(--ledger-accent)]' : (['setup', 'preview', 'results'].indexOf(step) > index ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-400')}`}>{index + 1}. {item === 'setup' ? 'File & mapping' : item === 'preview' ? 'Review rows' : 'Import results'}</div>)}
          </div>

          {error && <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"><AlertCircle size={16} className="mt-0.5 shrink-0"/><span>{error}</span></div>}
          {notice && <div role="status" className="mb-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800"><CheckCircle2 size={16} className="mt-0.5 shrink-0"/><span>{notice}</span></div>}

          {step === 'setup' && <div className="space-y-5">
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
              <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={event => { void handleFile(event.target.files?.[0]); event.target.value = '' }}/>
              <FileUp size={26} className="mx-auto text-slate-400"/>
              <p className="mt-2 text-sm font-semibold text-slate-800">{fileName || 'Choose a bank statement or transaction file'}</p>
              <p className="mt-1 text-xs text-slate-500">CSV, XLSX or XLS · up to 10 MB · first row is treated as the column header</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2"><button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg bg-ledger-navy px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-700"><Upload size={14}/>Choose file</button><button type="button" onClick={downloadCsvTemplate} className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Download CSV template</button></div>
            </div>

            {sheetNames.length > 1 && <label className="block max-w-sm text-xs font-semibold text-slate-600">Worksheet<select value={sheetName} onChange={event => { setSheetName(event.target.value); try { getSheet(event.target.value) } catch (err) { setError(err instanceof Error ? err.message : 'Could not read worksheet.') } }} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal"><option value="">Select worksheet</option>{sheetNames.map(name => <option key={name} value={name}>{name}</option>)}</select></label>}

            {headers.length > 0 && <>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-sm font-bold text-slate-800">Map your columns</h3><p className="mt-1 text-xs text-slate-500">We have guessed common column names. Check the mapping before previewing.</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] text-slate-500">{sourceRows.length} rows</span></div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {(['date', 'amount', 'debit', 'credit', 'type', 'description', 'payee', 'account', 'category', 'notes'] as MappingKey[]).map(fieldSelect)}
                </div>
                <div className="mt-4 border-t border-slate-100 pt-4"><p className="mb-3 text-[11px] leading-5 text-slate-500">Defaults are used only when a row has no matching account or category value. Leave them blank if every imported row maps directly to an existing Ledger account and category.</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="text-xs font-semibold text-slate-600">Date format<select value={dateFormat} onChange={event => setDateFormat(event.target.value as DateFormat)} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-normal"><option value="DD/MM/YYYY">DD/MM/YYYY (Bangladesh)</option><option value="MM/DD/YYYY">MM/DD/YYYY</option><option value="YYYY-MM-DD">YYYY-MM-DD</option></select></label>
                  <label className="text-xs font-semibold text-slate-600">Default type (when no type/debit/credit column)<select value={defaultType} onChange={event => setDefaultType(event.target.value as 'income' | 'expense')} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-normal"><option value="expense">Expense</option><option value="income">Income</option></select></label>
                  <label className="text-xs font-semibold text-slate-600">Default financial account<select value={defaultAccountId} onChange={event => setDefaultAccountId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-normal"><option value="">Select account</option>{financialAccounts.filter(account => account.account_type === 'asset').map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
                  <label className="text-xs font-semibold text-slate-600">Default income category<select value={defaultIncomeCategoryId} onChange={event => setDefaultIncomeCategoryId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-normal"><option value="">Select income category</option>{incomeCategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
                  <label className="text-xs font-semibold text-slate-600">Default expense category<select value={defaultExpenseCategoryId} onChange={event => setDefaultExpenseCategoryId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-normal"><option value="">Select expense category</option>{expenseCategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
                </div></div>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><strong>Privacy and posting:</strong> The file is parsed in your browser. No rows are posted until you review the preview and confirm the import. Each selected row is sent through Ledger's existing accounting RPC, one transaction at a time.</div>
            </>}
          </div>}

          {step === 'preview' && <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-4">
              <Metric label="Rows" value={String(rows.length)} />
              <Metric label="Exact duplicates" value={String(exactDuplicateCount)} tone="amber" />
              <Metric label="Possible duplicates" value={String(possibleDuplicateCount)} tone="amber" />
              <Metric label="Invalid rows" value={String(invalidCount)} tone="red" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={rows.some(row => row.status !== 'invalid' && row.status !== 'imported' && row.status !== 'duplicate') && rows.filter(row => row.status !== 'invalid' && row.status !== 'imported' && row.status !== 'duplicate').every(row => row.include)} onChange={event => toggleAllReady(event.target.checked)}/>Select all importable rows</label>
              <span className="text-xs text-slate-500">{readyRows.length} selected for import · {fileName}</span>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[1040px] text-left text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-3">Import</th><th className="px-3 py-3">Row</th><th className="px-3 py-3">Date</th><th className="px-3 py-3">Description</th><th className="px-3 py-3">Account / Category</th><th className="px-3 py-3 text-right">Amount</th><th className="px-3 py-3">Review status</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{rows.map(row => <tr key={row.rowNumber} className="align-top hover:bg-slate-50/70"><td className="px-3 py-3"><input type="checkbox" checked={row.include} disabled={row.status === 'invalid' || row.status === 'imported'} onChange={() => toggleRow(row.rowNumber)} aria-label={`Include row ${row.rowNumber}`}/></td><td className="px-3 py-3 text-slate-500">{row.rowNumber}</td><td className="whitespace-nowrap px-3 py-3 text-slate-700">{row.date || '—'}</td><td className="max-w-[230px] px-3 py-3"><p className="truncate font-semibold text-slate-800">{row.description || '—'}</p>{row.payee && <p className="mt-1 truncate text-slate-500">{row.payee}</p>}</td><td className="px-3 py-3"><p className="text-slate-700">{row.accountName || '—'}</p><p className="mt-1 text-slate-500">{row.categoryName || '—'}</p></td><td className={`whitespace-nowrap px-3 py-3 text-right font-semibold ${row.type === 'income' ? 'text-emerald-700' : 'text-rose-700'}`}>{row.amountMinor ? `${row.type === 'income' ? '+' : '−'}${formatMoney(row.amountMinor)}` : '—'}</td><td className="max-w-[280px] px-3 py-3"><StatusPill status={row.status}/><p className="mt-1 leading-4 text-slate-500">{row.message}</p></td></tr>)}</tbody>
              </table>
            </div>
            <p className="text-[11px] leading-5 text-slate-500">Exact matches are excluded by default. Possible duplicates are also excluded until you explicitly select them. Review every row carefully before posting.</p>
          </div>}

          {step === 'results' && <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700"><span>Import progress</span><span>{progress}%</span></div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }}/></div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center"><Metric label="Imported" value={String(importedCount)} tone="green"/><Metric label="Failed" value={String(rows.filter(row => row.status === 'failed').length)} tone="red"/><Metric label="Skipped / flagged" value={String(rows.filter(row => row.status === 'duplicate' || row.status === 'possible' || row.status === 'invalid').length)}/></div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[700px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-3">Row</th><th className="px-3 py-3">Date</th><th className="px-3 py-3">Description</th><th className="px-3 py-3">Amount</th><th className="px-3 py-3">Result</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map(row => <tr key={row.rowNumber}><td className="px-3 py-3">{row.rowNumber}</td><td className="px-3 py-3">{row.date || '—'}</td><td className="px-3 py-3">{row.description || '—'}</td><td className="px-3 py-3">{row.amountMinor ? formatMoney(row.amountMinor) : '—'}</td><td className="px-3 py-3"><StatusPill status={row.status}/><p className="mt-1 max-w-sm text-slate-500">{row.message}</p></td></tr>)}</tbody></table></div>
          </div>}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-6">
          <div className="text-[11px] text-slate-500">{step === 'setup' ? 'Supported formats: CSV and Excel.' : step === 'preview' ? 'No financial records are changed until you confirm import.' : 'Successful rows are posted. Failed rows remain unposted.'}</div>
          <div className="flex items-center gap-2">
            {step === 'preview' && <button type="button" onClick={() => setStep('setup')} disabled={busy} className="rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100">Back to mapping</button>}
            {step === 'setup' && <button type="button" onClick={() => void buildPreview()} disabled={busy || !headers.length} className="inline-flex items-center gap-2 rounded-lg bg-ledger-navy px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50">{busy ? <LoaderCircle size={14} className="animate-spin"/> : <ArrowRight size={14}/>}Prepare preview</button>}
            {step === 'preview' && <button type="button" onClick={() => void importSelected()} disabled={busy || readyRows.length === 0} className="inline-flex items-center gap-2 rounded-lg bg-ledger-navy px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50">{busy ? <LoaderCircle size={14} className="animate-spin"/> : <Upload size={14}/>}Import {readyRows.length} selected</button>}
            {step === 'results' && <button type="button" onClick={() => { setStep('preview'); setError(''); setNotice('') }} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"><RefreshCw size={14}/>Review remaining rows</button>}
            <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40">{step === 'results' ? 'Close' : 'Cancel'}</button>
          </div>
        </footer>
      </section>
    </div>
  )
}

function Metric({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'amber' | 'red' | 'green' }) {
  const color = tone === 'amber' ? 'text-amber-700' : tone === 'red' ? 'text-rose-700' : tone === 'green' ? 'text-emerald-700' : 'text-slate-800'
  return <div className="rounded-lg bg-slate-50 px-3 py-2.5"><p className="text-[10px] text-slate-500">{label}</p><p className={`mt-1 text-lg font-bold tabular-nums ${color}`}>{value}</p></div>
}

function StatusPill({ status }: { status: RowStatus }) {
  const config: Record<RowStatus, { label: string; className: string }> = {
    ready: { label: 'Ready', className: 'bg-emerald-50 text-emerald-700' },
    invalid: { label: 'Invalid', className: 'bg-rose-50 text-rose-700' },
    duplicate: { label: 'Exact duplicate', className: 'bg-amber-50 text-amber-800' },
    possible: { label: 'Possible duplicate', className: 'bg-orange-50 text-orange-800' },
    imported: { label: 'Imported', className: 'bg-emerald-100 text-emerald-800' },
    failed: { label: 'Failed', className: 'bg-rose-100 text-rose-800' },
  }
  return <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${config[status].className}`}>{config[status].label}</span>
}
