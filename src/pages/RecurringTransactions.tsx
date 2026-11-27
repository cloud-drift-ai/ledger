import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import {
  AlertCircle,
  Bell,
  BellRing,
  CalendarClock,
  CalendarDays,
  List,
  ChevronLeft,
  ChevronRight,
  Check,
  CheckCircle2,
  Edit3,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Search,
  SkipForward,
  Wallet,
  X,
} from 'lucide-react'

import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatBDTCurrencyMinor, formatLedgerDate } from '../lib/preferences'
import { useSearchParams } from 'react-router-dom'

type TransactionType = 'income' | 'expense'
type FrequencyUnit = 'day' | 'week' | 'month' | 'year'
type ScheduleStatus = 'active' | 'paused' | 'completed' | 'cancelled'
type OccurrenceStatus = 'processing' | 'recorded' | 'skipped' | 'failed'

type Account = {
  id: string
  name: string
  account_kind: 'financial' | 'category'
  account_type: 'asset' | 'liability' | 'equity' | 'income' | 'expense'
  subtype: string | null
  is_active: boolean
}

type RecurringSchedule = {
  id: string
  user_id: string
  name: string
  transaction_type: TransactionType
  amount_minor: number | string
  financial_account_id: string
  category_account_id: string
  description: string | null
  payee: string | null
  notes: string | null
  frequency_unit: FrequencyUnit
  frequency_interval: number
  start_date: string
  next_due_date: string
  end_date: string | null
  reminder_days_before: number
  status: ScheduleStatus
  anchor_day: number
  anchor_month: number
  created_at: string
  updated_at: string
}

type Occurrence = {
  id: string
  user_id: string
  recurring_transaction_id: string
  due_date: string
  entry_date: string | null
  amount_minor: number | string
  status: OccurrenceStatus
  error_message: string | null
  created_at: string
}

type CalendarEvent = {
  id: string
  schedule: RecurringSchedule
  dueDate: string
  amountMinor: number
  status: OccurrenceStatus | 'scheduled' | 'projected'
  errorMessage: string | null
  isActionable: boolean
}

type CalendarDay = {
  date: string
  inMonth: boolean
  isToday: boolean
  events: CalendarEvent[]
}

type ScheduleForm = {
  name: string
  transactionType: TransactionType
  amount: string
  financialAccountId: string
  categoryAccountId: string
  frequencyPreset: 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom'
  frequencyInterval: string
  frequencyUnit: FrequencyUnit
  startDate: string
  endDate: string
  reminderDays: string
  description: string
  payee: string
  notes: string
}

type RecordTarget = {
  schedule: RecurringSchedule
}

type ViewFilter = 'all' | 'due' | 'upcoming' | 'paused' | 'history'

const PAGE_SIZE = 500

function localDateString(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseAmountToMinor(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null
  const [whole, fraction = ''] = trimmed.split('.')
  const minor = Number(whole) * 100 + Number((fraction + '00').slice(0, 2))
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null
}

function formatMoney(minor: number | string) {
  return formatBDTCurrencyMinor(Number(minor))
}

function formatDate(value: string | null) {
  return formatLedgerDate(value)
}

function dateDifference(from: string, to: string) {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const a = Date.UTC(fy, fm - 1, fd)
  const b = Date.UTC(ty, tm - 1, td)
  return Math.round((b - a) / 86400000)
}

function getNextDueDate(schedule: RecurringSchedule) {
  const [year, month, day] = schedule.next_due_date.split('-').map(Number)
  const interval = Number(schedule.frequency_interval)

  if (schedule.frequency_unit === 'day' || schedule.frequency_unit === 'week') {
    const date = new Date(Date.UTC(year, month - 1, day))
    date.setUTCDate(date.getUTCDate() + interval * (schedule.frequency_unit === 'week' ? 7 : 1))
    return date.toISOString().slice(0, 10)
  }

  if (schedule.frequency_unit === 'month') {
    const monthIndex = year * 12 + (month - 1) + interval
    const nextYear = Math.floor(monthIndex / 12)
    const nextMonth = (monthIndex % 12) + 1
    const lastDay = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate()
    const nextDay = Math.min(Number(schedule.anchor_day), lastDay)
    return `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(nextDay).padStart(2, '0')}`
  }

  const nextYear = year + interval
  const anchorMonth = Number(schedule.anchor_month)
  const lastDay = new Date(Date.UTC(nextYear, anchorMonth, 0)).getUTCDate()
  const nextDay = Math.min(Number(schedule.anchor_day), lastDay)
  return `${nextYear}-${String(anchorMonth).padStart(2, '0')}-${String(nextDay).padStart(2, '0')}`
}

function shiftDateString(value: string, amount: number) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function getMonthRange(monthValue: string) {
  const [year, month] = monthValue.split('-').map(Number)
  const first = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const last = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { first, last }
}

function buildCalendarEvents(
  schedules: RecurringSchedule[],
  occurrences: Occurrence[],
  monthValue: string
): CalendarEvent[] {
  const { first, last } = getMonthRange(monthValue)
  const scheduleMap = new Map(schedules.map(schedule => [schedule.id, schedule]))
  const existingKeys = new Set<string>()
  const events: CalendarEvent[] = []

  for (const occurrence of occurrences) {
    if (occurrence.due_date < first || occurrence.due_date > last) continue
    const schedule = scheduleMap.get(occurrence.recurring_transaction_id)
    if (!schedule) continue

    const key = `${schedule.id}:${occurrence.due_date}`
    existingKeys.add(key)
    events.push({
      id: occurrence.id,
      schedule,
      dueDate: occurrence.due_date,
      amountMinor: occurrence.status === 'skipped' ? 0 : Number(occurrence.amount_minor),
      status: occurrence.status,
      errorMessage: occurrence.error_message,
      isActionable: occurrence.status === 'failed' && schedule.next_due_date === occurrence.due_date,
    })
  }

  for (const schedule of schedules) {
    if (schedule.status !== 'active') continue

    // Do not forecast later dates while an earlier occurrence remains unresolved.
    let dueDate = schedule.next_due_date
    if (dueDate < first || dueDate > last) continue

    let guard = 0
    while (dueDate <= last && guard < 500) {
      if (schedule.end_date && dueDate > schedule.end_date) break

      const key = `${schedule.id}:${dueDate}`
      if (!existingKeys.has(key)) {
        const isNextDue = dueDate === schedule.next_due_date
        events.push({
          id: key,
          schedule,
          dueDate,
          amountMinor: Number(schedule.amount_minor),
          status: isNextDue ? 'scheduled' : 'projected',
          errorMessage: null,
          isActionable: isNextDue,
        })
      }

      const nextDate = getNextDueDate({ ...schedule, next_due_date: dueDate })
      if (nextDate <= dueDate) break
      dueDate = nextDate
      guard += 1
    }
  }

  return events.sort((a, b) =>
    a.dueDate.localeCompare(b.dueDate) ||
    a.schedule.name.localeCompare(b.schedule.name)
  )
}

function buildCalendarDays(
  monthValue: string,
  today: string,
  events: CalendarEvent[]
): CalendarDay[] {
  const { first } = getMonthRange(monthValue)
  const [year, month] = monthValue.split('-').map(Number)
  const firstDate = new Date(Date.UTC(year, month - 1, 1))
  const mondayOffset = (firstDate.getUTCDay() + 6) % 7
  const gridStart = shiftDateString(first, -mondayOffset)
  const monthEvents = new Map<string, CalendarEvent[]>()

  for (const event of events) {
    const list = monthEvents.get(event.dueDate) || []
    list.push(event)
    monthEvents.set(event.dueDate, list)
  }

  return Array.from({ length: 42 }, (_, index) => {
    const date = shiftDateString(gridStart, index)
    return {
      date,
      inMonth: date.slice(0, 7) === monthValue,
      isToday: date === today,
      events: monthEvents.get(date) || [],
    }
  })
}

function frequencyLabel(unit: FrequencyUnit, interval: number) {
  if (unit === 'week' && interval === 1) return 'Weekly'
  if (unit === 'month' && interval === 1) return 'Monthly'
  if (unit === 'month' && interval === 3) return 'Quarterly'
  if (unit === 'year' && interval === 1) return 'Yearly'
  const label = interval === 1 ? unit : `${unit}s`
  return `Every ${interval} ${label}${interval === 1 ? '' : ''}`
}

function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return error instanceof Error ? error.message : 'Something went wrong.'
}

function makeEmptyForm(
  type: TransactionType = 'expense',
  accounts: Account[] = []
): ScheduleForm {
  const financial = accounts.find(account =>
    account.account_kind === 'financial' &&
    account.is_active &&
    (type === 'income'
      ? account.account_type === 'asset'
      : account.account_type === 'asset' || account.account_type === 'liability')
  )
  const category = accounts.find(account =>
    account.account_kind === 'category' &&
    account.account_type === type &&
    account.is_active
  )

  return {
    name: '',
    transactionType: type,
    amount: '',
    financialAccountId: financial?.id || '',
    categoryAccountId: category?.id || '',
    frequencyPreset: 'monthly',
    frequencyInterval: '2',
    frequencyUnit: 'week',
    startDate: localDateString(),
    endDate: '',
    reminderDays: '3',
    description: '',
    payee: '',
    notes: '',
  }
}

export default function RecurringTransactions() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  const [accounts, setAccounts] = useState<Account[]>([])
  const [schedules, setSchedules] = useState<RecurringSchedule[]>([])
  const [occurrences, setOccurrences] = useState<Occurrence[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [filter, setFilter] = useState<ViewFilter>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>(() =>
    searchParams.get('view') === 'calendar' ? 'calendar' : 'list'
  )
  const [calendarMonth, setCalendarMonth] = useState(() => localDateString().slice(0, 7))
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(() => localDateString())
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'unsupported'
  )
  const [desktopNotificationsEnabled, setDesktopNotificationsEnabled] = useState(false)

  const [showForm, setShowForm] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState<RecurringSchedule | null>(null)
  const [form, setForm] = useState<ScheduleForm>(makeEmptyForm())

  const [recordTarget, setRecordTarget] = useState<RecordTarget | null>(null)
  const [recordAmount, setRecordAmount] = useState('')
  const [recordDate, setRecordDate] = useState(localDateString())

  const financialAccounts = useMemo(
    () => accounts.filter(account =>
      account.account_kind === 'financial' &&
      account.is_active &&
      (form.transactionType === 'income'
        ? account.account_type === 'asset'
        : account.account_type === 'asset' || account.account_type === 'liability')
    ),
    [accounts, form.transactionType]
  )

  const categoryAccounts = useMemo(
    () => accounts.filter(account =>
      account.account_kind === 'category' &&
      account.account_type === form.transactionType &&
      account.is_active
    ),
    [accounts, form.transactionType]
  )

  const accountMap = useMemo(
    () => new Map(accounts.map(account => [account.id, account])),
    [accounts]
  )

  const scheduleMap = useMemo(
    () => new Map(schedules.map(schedule => [schedule.id, schedule])),
    [schedules]
  )

  const today = localDateString()

  const loadData = useCallback(async (refresh = false) => {
    if (!user?.id) {
      setAccounts([])
      setSchedules([])
      setOccurrences([])
      setLoading(false)
      return
    }

    if (refresh) setRefreshing(true)
    else setLoading(true)

    setError('')

    try {
      const { error: categorySetupError } = await supabase.rpc(
        'ensure_default_transaction_categories'
      )
      if (categorySetupError) throw categorySetupError

      const [accountResult, scheduleResult, occurrenceResult] = await Promise.all([
        supabase
          .from('ledger_accounts')
          .select('id, name, account_kind, account_type, subtype, is_active')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .order('name', { ascending: true }),

        supabase
          .from('recurring_transactions')
          .select('*')
          .eq('user_id', user.id)
          .order('next_due_date', { ascending: true }),

        supabase
          .from('recurring_transaction_occurrences')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(PAGE_SIZE),
      ])

      if (accountResult.error) throw accountResult.error
      if (scheduleResult.error) throw scheduleResult.error
      if (occurrenceResult.error) throw occurrenceResult.error

      setAccounts((accountResult.data || []) as Account[])
      setSchedules((scheduleResult.data || []) as RecurringSchedule[])
      setOccurrences((occurrenceResult.data || []) as Occurrence[])
    } catch (err) {
      console.error('Recurring transactions loading error:', err)
      setError(errorMessage(err))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [user?.id])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    if (!user?.id) {
      setDesktopNotificationsEnabled(false)
      return
    }
    const key = `ledger:recurring-notifications:${user.id}`
    setDesktopNotificationsEnabled(window.localStorage.getItem(key) === 'true')
    setNotificationPermission(
      'Notification' in window ? Notification.permission : 'unsupported'
    )
  }, [user?.id])

  useEffect(() => {
    if (!financialAccounts.some(account => account.id === form.financialAccountId)) {
      setForm(previous => ({
        ...previous,
        financialAccountId: financialAccounts[0]?.id || '',
      }))
    }
  }, [financialAccounts, form.financialAccountId])

  useEffect(() => {
    if (!categoryAccounts.some(account => account.id === form.categoryAccountId)) {
      setForm(previous => ({
        ...previous,
        categoryAccountId: categoryAccounts[0]?.id || '',
      }))
    }
  }, [categoryAccounts, form.categoryAccountId])

  const activeSchedules = schedules.filter(schedule => schedule.status === 'active')
  const dueSchedules = activeSchedules.filter(schedule =>
    dateDifference(today, schedule.next_due_date) <= Number(schedule.reminder_days_before)
  )
  const upcomingSchedules = activeSchedules.filter(schedule => {
    const days = dateDifference(today, schedule.next_due_date)
    return days > Number(schedule.reminder_days_before) && days <= 30
  })
  const pausedSchedules = schedules.filter(schedule => schedule.status === 'paused')
  const calendarEvents = useMemo(
    () => buildCalendarEvents(schedules, occurrences, calendarMonth),
    [schedules, occurrences, calendarMonth]
  )
  const calendarDays = useMemo(
    () => buildCalendarDays(calendarMonth, today, calendarEvents),
    [calendarMonth, today, calendarEvents]
  )
  const selectedCalendarEvents = calendarEvents.filter(event => event.dueDate === selectedCalendarDate)
  const calendarMonthLabel = useMemo(() => {
    const [year, month] = calendarMonth.split('-').map(Number)
    return new Intl.DateTimeFormat('en-BD', { month: 'long', year: 'numeric' })
      .format(new Date(Date.UTC(year, month - 1, 1)))
  }, [calendarMonth])
  const calendarIncome = calendarEvents
    .filter(event => event.schedule.transaction_type === 'income' && event.status !== 'skipped')
    .reduce((sum, event) => sum + event.amountMinor, 0)
  const calendarExpenses = calendarEvents
    .filter(event => event.schedule.transaction_type === 'expense' && event.status !== 'skipped')
    .reduce((sum, event) => sum + event.amountMinor, 0)

  useEffect(() => {
    if (
      !user?.id ||
      loading ||
      !desktopNotificationsEnabled ||
      notificationPermission !== 'granted'
    ) return

    const preferenceKey = `ledger:recurring-notifications:${user.id}`
    const checkAndNotify = () => {
      for (const schedule of schedules) {
        if (schedule.status !== 'active') continue
        const daysUntilDue = dateDifference(today, schedule.next_due_date)
        if (daysUntilDue > Number(schedule.reminder_days_before)) continue

        const notificationKey = `${preferenceKey}:${schedule.id}:${schedule.next_due_date}`
        try {
          if (window.localStorage.getItem(notificationKey)) continue
          const timing = daysUntilDue < 0
            ? `${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) === 1 ? '' : 's'} overdue`
            : daysUntilDue === 0
              ? 'due today'
              : `due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`
          new Notification('Ledger payment reminder', {
            body: `${schedule.name} is ${timing}. ${formatMoney(schedule.amount_minor)}`,
            tag: notificationKey,
            icon: '/favicon.svg',
          })
          window.localStorage.setItem(notificationKey, new Date().toISOString())
        } catch (notificationError) {
          console.warn('Unable to display recurring transaction notification:', notificationError)
        }
      }
    }

    checkAndNotify()
    const reminderInterval = window.setInterval(checkAndNotify, 60_000)
    return () => window.clearInterval(reminderInterval)
  }, [
    user?.id,
    loading,
    desktopNotificationsEnabled,
    notificationPermission,
    schedules,
    today,
  ])

  const monthlyExpected = activeSchedules.reduce((sum, schedule) => {
    const amount = Number(schedule.amount_minor)
    if (schedule.frequency_unit === 'day') return sum + amount * 30 / schedule.frequency_interval
    if (schedule.frequency_unit === 'week') return sum + amount * 4.345 / schedule.frequency_interval
    if (schedule.frequency_unit === 'month') return sum + amount / schedule.frequency_interval
    return sum + amount / (12 * schedule.frequency_interval)
  }, 0)

  const openCreateForm = (type: TransactionType = 'expense') => {
    setEditingSchedule(null)
    setForm(makeEmptyForm(type, accounts))
    setShowForm(true)
    setError('')
    setSuccess('')
  }

  const toggleDesktopNotifications = async () => {
    if (!user?.id) return
    const preferenceKey = `ledger:recurring-notifications:${user.id}`

    if (desktopNotificationsEnabled) {
      window.localStorage.removeItem(preferenceKey)
      setDesktopNotificationsEnabled(false)
      setSuccess('Desktop reminders turned off.')
      return
    }

    if (!('Notification' in window)) {
      setNotificationPermission('unsupported')
      setError('This browser does not support desktop notifications.')
      return
    }

    try {
      const permission = await Notification.requestPermission()
      setNotificationPermission(permission)
      if (permission === 'granted') {
        window.localStorage.setItem(preferenceKey, 'true')
        setDesktopNotificationsEnabled(true)
        setSuccess('Desktop reminders enabled. Keep the Recurring Transactions page open to deliver them.')
      } else if (permission === 'denied') {
        setError('Notifications are blocked by your browser. Allow them for Ledger in your browser site settings.')
      } else {
        setError('Notification permission was not granted.')
      }
    } catch (notificationError) {
      setError(errorMessage(notificationError))
    }
  }

  const changeCalendarMonth = (amount: number) => {
    const [year, month] = calendarMonth.split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1 + amount, 1))
    const nextMonth = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
    setCalendarMonth(nextMonth)
    setSelectedCalendarDate(`${nextMonth}-01`)
  }

  const goToCurrentCalendarMonth = () => {
    const currentMonth = today.slice(0, 7)
    setCalendarMonth(currentMonth)
    setSelectedCalendarDate(today)
  }

  useEffect(() => {
    const requestedSearch = searchParams.get('search')
    const requestedNew = searchParams.get('new') === 'recurring'

    if (requestedSearch !== null) {
      setSearchTerm(requestedSearch)
      setFilter('all')
      setViewMode('list')
    }
    if (!loading && accounts.length && requestedNew) {
      openCreateForm('expense')
    }
    if (requestedSearch !== null || (requestedNew && !loading && accounts.length)) {
      setSearchParams({}, { replace: true })
    }
    // Wait for account options before opening the recurring form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, accounts.length, searchParams, setSearchParams])

  const openEditForm = (schedule: RecurringSchedule) => {
    const preset =
      schedule.frequency_unit === 'week' && schedule.frequency_interval === 1
        ? 'weekly'
        : schedule.frequency_unit === 'month' && schedule.frequency_interval === 1
          ? 'monthly'
          : schedule.frequency_unit === 'month' && schedule.frequency_interval === 3
            ? 'quarterly'
            : schedule.frequency_unit === 'year' && schedule.frequency_interval === 1
              ? 'yearly'
              : 'custom'

    setEditingSchedule(schedule)
    setForm({
      name: schedule.name,
      transactionType: schedule.transaction_type,
      amount: (Number(schedule.amount_minor) / 100).toFixed(2),
      financialAccountId: schedule.financial_account_id,
      categoryAccountId: schedule.category_account_id,
      frequencyPreset: preset,
      frequencyInterval: String(schedule.frequency_interval),
      frequencyUnit: schedule.frequency_unit,
      startDate: schedule.start_date,
      endDate: schedule.end_date || '',
      reminderDays: String(schedule.reminder_days_before),
      description: schedule.description || '',
      payee: schedule.payee || '',
      notes: schedule.notes || '',
    })
    setShowForm(true)
    setError('')
    setSuccess('')
  }

  const handleSaveSchedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!user?.id) return

    setError('')
    setSuccess('')

    const amountMinor = parseAmountToMinor(form.amount)
    if (!form.name.trim()) {
      setError('Enter a name for this recurring transaction.')
      return
    }
    if (amountMinor === null) {
      setError('Enter a valid amount greater than zero, with up to two decimal places.')
      return
    }
    if (!form.financialAccountId || !form.categoryAccountId) {
      setError('Select both a financial account and a matching category.')
      return
    }
    if (!form.startDate || (form.endDate && form.endDate < form.startDate)) {
      setError('Check the start and end dates.')
      return
    }

    let frequencyUnit: FrequencyUnit = form.frequencyUnit
    let frequencyInterval = Number(form.frequencyInterval)

    if (form.frequencyPreset === 'weekly') {
      frequencyUnit = 'week'
      frequencyInterval = 1
    } else if (form.frequencyPreset === 'monthly') {
      frequencyUnit = 'month'
      frequencyInterval = 1
    } else if (form.frequencyPreset === 'quarterly') {
      frequencyUnit = 'month'
      frequencyInterval = 3
    } else if (form.frequencyPreset === 'yearly') {
      frequencyUnit = 'year'
      frequencyInterval = 1
    }

    if (!Number.isInteger(frequencyInterval) || frequencyInterval < 1 || frequencyInterval > 365) {
      setError('Custom frequency must be a whole number between 1 and 365.')
      return
    }

    setSaving(true)

    try {
      const payload = {
        user_id: user.id,
        name: form.name.trim(),
        transaction_type: form.transactionType,
        amount_minor: amountMinor,
        financial_account_id: form.financialAccountId,
        category_account_id: form.categoryAccountId,
        description: form.description.trim() || form.name.trim(),
        payee: form.payee.trim() || null,
        notes: form.notes.trim() || null,
        frequency_unit: frequencyUnit,
        frequency_interval: frequencyInterval,
        start_date: editingSchedule?.start_date || form.startDate,
        next_due_date: editingSchedule?.next_due_date || form.startDate,
        end_date: form.endDate || null,
        reminder_days_before: Number(form.reminderDays),
        status: editingSchedule
          ? (form.endDate && editingSchedule.next_due_date > form.endDate
              ? 'completed'
              : editingSchedule.status)
          : 'active',
      }

      if (editingSchedule) {
        const { error: updateError } = await supabase
          .from('recurring_transactions')
          .update(payload)
          .eq('id', editingSchedule.id)
          .eq('user_id', user.id)

        if (updateError) throw updateError
        setSuccess('Recurring schedule updated.')
      } else {
        const { error: insertError } = await supabase
          .from('recurring_transactions')
          .insert(payload)

        if (insertError) throw insertError
        setSuccess('Recurring schedule created.')
      }

      setShowForm(false)
      setEditingSchedule(null)
      await loadData(true)
    } catch (err) {
      console.error('Recurring schedule save error:', err)
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const advanceSchedule = async (schedule: RecurringSchedule) => {
    const nextDueDate = getNextDueDate(schedule)
    const completed = Boolean(schedule.end_date && nextDueDate > schedule.end_date)

    const { error: updateError } = await supabase
      .from('recurring_transactions')
      .update({
        next_due_date: nextDueDate,
        status: completed ? 'completed' : schedule.status,
      })
      .eq('id', schedule.id)
      .eq('user_id', user?.id)
      .eq('next_due_date', schedule.next_due_date)

    if (updateError) {
      throw new Error(
        `The occurrence was saved, but the schedule could not advance. Refresh and check the schedule before recording again. ${errorMessage(updateError)}`
      )
    }
  }

  const openRecordModal = (schedule: RecurringSchedule) => {
    setRecordTarget({ schedule })
    setRecordAmount((Number(schedule.amount_minor) / 100).toFixed(2))
    setRecordDate(today)
    setError('')
    setSuccess('')
  }

  const handleRecordOccurrence = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!user?.id || !recordTarget) return

    const { schedule } = recordTarget
    const amountMinor = parseAmountToMinor(recordAmount)

    if (amountMinor === null) {
      setError('Enter a valid amount greater than zero.')
      return
    }
    if (!recordDate) {
      setError('Select the actual transaction date.')
      return
    }

    setSaving(true)
    setError('')
    setSuccess('')

    let occurrenceId: string | null = null

    try {
      const { data: existing, error: existingError } = await supabase
        .from('recurring_transaction_occurrences')
        .select('id, status')
        .eq('user_id', user.id)
        .eq('recurring_transaction_id', schedule.id)
        .eq('due_date', schedule.next_due_date)
        .maybeSingle()

      if (existingError) throw existingError

      if (existing) {
        if (existing.status !== 'failed') {
          throw new Error(
            `This due date already has an occurrence marked "${existing.status}". Check Transaction History before trying again.`
          )
        }

        const { error: retryError } = await supabase
          .from('recurring_transaction_occurrences')
          .update({
            status: 'processing',
            entry_date: recordDate,
            amount_minor: amountMinor,
            error_message: null,
          })
          .eq('id', existing.id)
          .eq('user_id', user.id)

        if (retryError) throw retryError
        occurrenceId = existing.id
      } else {
        const { data: created, error: occurrenceError } = await supabase
          .from('recurring_transaction_occurrences')
          .insert({
            user_id: user.id,
            recurring_transaction_id: schedule.id,
            due_date: schedule.next_due_date,
            entry_date: recordDate,
            amount_minor: amountMinor,
            status: 'processing',
          })
          .select('id')
          .single()

        if (occurrenceError) throw occurrenceError
        occurrenceId = created.id
      }

      const { error: transactionError } = await supabase.rpc(
        'create_income_expense_transaction',
        {
          p_transaction_type: schedule.transaction_type,
          p_amount_minor: amountMinor,
          p_financial_account_id: schedule.financial_account_id,
          p_category_account_id: schedule.category_account_id,
          p_entry_date: recordDate,
          p_description: schedule.description || schedule.name,
          p_payee: schedule.payee,
          p_notes: schedule.notes
            ? `${schedule.notes}\nRecorded from recurring schedule: ${schedule.name}`
            : `Recorded from recurring schedule: ${schedule.name}`,
        }
      )

      if (transactionError) {
        await supabase
          .from('recurring_transaction_occurrences')
          .update({
            status: 'failed',
            error_message: errorMessage(transactionError),
          })
          .eq('id', occurrenceId)
          .eq('user_id', user.id)

        throw transactionError
      }

      const { error: markRecordedError } = await supabase
        .from('recurring_transaction_occurrences')
        .update({
          status: 'recorded',
          entry_date: recordDate,
          amount_minor: amountMinor,
          error_message: null,
        })
        .eq('id', occurrenceId)
        .eq('user_id', user.id)

      if (markRecordedError) {
        throw new Error(
          `The transaction was created, but its reminder could not be marked recorded. Do not record it again. Refresh and inspect the history. ${errorMessage(markRecordedError)}`
        )
      }

      await advanceSchedule(schedule)
      setRecordTarget(null)
      setSuccess(`${schedule.name} was recorded successfully.`)
      await loadData(true)
    } catch (err) {
      console.error('Recurring occurrence record error:', err)
      setError(errorMessage(err))
      await loadData(true)
    } finally {
      setSaving(false)
    }
  }

  const handleSkipOccurrence = async (schedule: RecurringSchedule) => {
    if (!user?.id) return
    const confirmed = window.confirm(
      `Skip the ${formatDate(schedule.next_due_date)} occurrence of "${schedule.name}"? The next scheduled date will be calculated.`
    )
    if (!confirmed) return

    setSaving(true)
    setError('')
    setSuccess('')

    try {
      const { error: insertError } = await supabase
        .from('recurring_transaction_occurrences')
        .insert({
          user_id: user.id,
          recurring_transaction_id: schedule.id,
          due_date: schedule.next_due_date,
          entry_date: null,
          amount_minor: 0,
          status: 'skipped',
        })

      if (insertError) throw insertError

      await advanceSchedule(schedule)
      setSuccess(`${schedule.name} occurrence skipped.`)
      await loadData(true)
    } catch (err) {
      console.error('Recurring occurrence skip error:', err)
      setError(errorMessage(err))
      await loadData(true)
    } finally {
      setSaving(false)
    }
  }

  const updateStatus = async (schedule: RecurringSchedule, status: ScheduleStatus) => {
    if (!user?.id) return
    setSaving(true)
    setError('')
    setSuccess('')

    try {
      const { error: updateError } = await supabase
        .from('recurring_transactions')
        .update({ status })
        .eq('id', schedule.id)
        .eq('user_id', user.id)

      if (updateError) throw updateError
      setSuccess(
        status === 'paused'
          ? 'Schedule paused.'
          : status === 'active'
            ? 'Schedule resumed.'
            : 'Schedule cancelled.'
      )
      await loadData(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const currentSchedules = useMemo(() => {
    let source = schedules
    if (filter === 'due') source = dueSchedules
    else if (filter === 'upcoming') source = upcomingSchedules
    else if (filter === 'paused') source = pausedSchedules

    const query = searchTerm.trim().toLowerCase()
    if (!query) return source
    return source.filter(schedule =>
      `${schedule.name} ${schedule.description || ''} ${schedule.payee || ''} ${schedule.notes || ''}`
        .toLowerCase()
        .includes(query)
    )
  }, [filter, schedules, dueSchedules, upcomingSchedules, pausedSchedules, searchTerm])

  const statusBadge = (status: ScheduleStatus | OccurrenceStatus) => {
    const styles: Record<string, string> = {
      active: 'bg-emerald-50 text-emerald-700',
      paused: 'bg-amber-50 text-amber-700',
      completed: 'bg-blue-50 text-blue-700',
      cancelled: 'bg-slate-100 text-slate-500',
      processing: 'bg-blue-50 text-blue-700',
      recorded: 'bg-emerald-50 text-emerald-700',
      skipped: 'bg-slate-100 text-slate-600',
      failed: 'bg-red-50 text-red-700',
      scheduled: 'bg-violet-50 text-violet-700',
      projected: 'bg-slate-100 text-slate-600',
    }
    return (
      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${styles[status] || 'bg-slate-100 text-slate-600'}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    )
  }

  const handleFrequencyPreset = (value: ScheduleForm['frequencyPreset']) => {
    setForm(previous => ({
      ...previous,
      frequencyPreset: value,
      ...(value === 'weekly'
        ? { frequencyUnit: 'week' as FrequencyUnit, frequencyInterval: '1' }
        : value === 'monthly'
          ? { frequencyUnit: 'month' as FrequencyUnit, frequencyInterval: '1' }
          : value === 'quarterly'
            ? { frequencyUnit: 'month' as FrequencyUnit, frequencyInterval: '3' }
            : value === 'yearly'
              ? { frequencyUnit: 'year' as FrequencyUnit, frequencyInterval: '1' }
              : {}),
    }))
  }

  const filterButton = (value: ViewFilter, label: string, count?: number) => (
    <button
      type="button"
      onClick={() => setFilter(value)}
      className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
        filter === value
          ? 'bg-ledger-navy text-white'
          : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
      }`}
    >
      {label}
      {typeof count === 'number' && (
        <span className={`ml-2 rounded-full px-1.5 py-0.5 text-xs ${filter === value ? 'bg-white/15' : 'bg-slate-100'}`}>
          {count}
        </span>
      )}
    </button>
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-ledger-navy">
            <Repeat size={17} />
            <span>Scheduled income and expenses</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 md:text-3xl">
            Recurring Transactions
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage regular payments and get reminders before they are due.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void toggleDesktopNotifications()}
            disabled={notificationPermission === 'unsupported'}
            title={
              notificationPermission === 'unsupported'
                ? 'This browser does not support notifications'
                : notificationPermission === 'denied'
                  ? 'Allow notifications in your browser site settings'
                  : desktopNotificationsEnabled
                    ? 'Turn off desktop reminders'
                    : 'Enable desktop reminders while this page is open'
            }
            className={`inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
              desktopNotificationsEnabled
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <BellRing size={16} />
            {desktopNotificationsEnabled ? 'Reminders on' : 'Enable reminders'}
          </button>
          <button
            type="button"
            onClick={() => void loadData(true)}
            disabled={refreshing || loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => openCreateForm('expense')}
            className="inline-flex items-center gap-2 rounded-xl bg-ledger-navy px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-700"
          >
            <Plus size={17} />
            New Schedule
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={17} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-20 text-sm text-slate-500">
          <RefreshCw size={18} className="animate-spin" />
          Loading recurring schedules...
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              label="Active schedules"
              value={String(activeSchedules.length)}
              detail="Currently running"
              icon={Repeat}
              tone="blue"
            />
            <SummaryCard
              label="Due / overdue"
              value={String(dueSchedules.filter(schedule => schedule.next_due_date <= today).length)}
              detail="Needs your attention"
              icon={Bell}
              tone="amber"
            />
            <SummaryCard
              label="Upcoming reminders"
              value={String(dueSchedules.filter(schedule => schedule.next_due_date > today).length)}
              detail="Within reminder window"
              icon={CalendarClock}
              tone="purple"
            />
            <SummaryCard
              label="Estimated monthly"
              value={formatMoney(Math.round(monthlyExpected))}
              detail="Based on active schedules"
              icon={Wallet}
              tone="green"
            />
          </div>

          {dueSchedules.length > 0 && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
              <div className="mb-4 flex items-start gap-3">
                <div className="rounded-xl bg-white p-2.5 text-amber-700">
                  <Bell size={20} />
                </div>
                <div>
                  <h2 className="font-bold text-amber-950">Reminders requiring attention</h2>
                  <p className="mt-1 text-xs text-amber-800">
                    Confirm a payment after it actually happens. Ledger will not post it automatically.
                  </p>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                {dueSchedules.map(schedule => {
                  const days = dateDifference(today, schedule.next_due_date)
                  const overdue = days < 0
                  const account = accountMap.get(schedule.financial_account_id)

                  return (
                    <div key={schedule.id} data-type={schedule.transaction_type} className="ledger-recurring-reminder rounded-xl border border-amber-200/80 bg-white p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold text-slate-800">{schedule.name}</h3>
                            {overdue ? (
                              <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
                                {Math.abs(days)} day{Math.abs(days) === 1 ? '' : 's'} overdue
                              </span>
                            ) : (
                              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                                {days === 0 ? 'Due today' : `Due in ${days} day${days === 1 ? '' : 's'}`}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            {schedule.transaction_type === 'income' ? 'Income' : 'Expense'} · {formatDate(schedule.next_due_date)} · {account?.name || 'Account unavailable'}
                          </p>
                        </div>
                        <p className={`text-lg font-bold ${schedule.transaction_type === 'income' ? 'text-emerald-700' : 'text-slate-800'}`}>
                          {formatMoney(schedule.amount_minor)}
                        </p>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openRecordModal(schedule)}
                          disabled={saving}
                          className="inline-flex items-center gap-2 rounded-lg bg-ledger-navy px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                        >
                          <Check size={14} />
                          Record transaction
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSkipOccurrence(schedule)}
                          disabled={saving}
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          <SkipForward size={14} />
                          Skip this date
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditForm(schedule)}
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          <Edit3 size={14} />
                          Edit
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-[220px] flex-1 flex-wrap items-center gap-2">
              <div className="flex min-w-[190px] flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm focus-within:border-[var(--ledger-accent)]">
                <Search size={15} className="shrink-0 text-slate-400"/>
                <input
                  type="search"
                  value={searchTerm}
                  onChange={event => setSearchTerm(event.target.value)}
                  placeholder="Search recurring schedules..."
                  className="w-full min-w-0 bg-transparent text-xs outline-none placeholder:text-slate-400"
                />
                {searchTerm && <button type="button" onClick={() => setSearchTerm('')} aria-label="Clear recurring search" className="rounded p-1 text-slate-400 hover:bg-slate-100"><X size={13}/></button>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
              {filterButton('all', 'All schedules', schedules.length)}
              {filterButton('due', 'Due / reminders', dueSchedules.length)}
              {filterButton('upcoming', 'Upcoming', upcomingSchedules.length)}
              {filterButton('paused', 'Paused', pausedSchedules.length)}
              {filterButton('history', 'History', occurrences.length)}
              </div>
            </div>
            {filter !== 'history' && (
              <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                    viewMode === 'list' ? 'bg-ledger-navy text-white' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <List size={15} />
                  List
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFilter('all')
                    setViewMode('calendar')
                  }}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                    viewMode === 'calendar' && filter === 'all' ? 'bg-ledger-navy text-white' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <CalendarDays size={15} />
                  Calendar
                </button>
              </div>
            )}
          </div>

          {filter === 'history' ? (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="font-bold text-slate-800">Occurrence history</h2>
                <p className="mt-1 text-xs text-slate-500">Recorded, skipped and unresolved scheduled dates.</p>
              </div>
              {occurrences.length === 0 ? (
                <EmptyState message="No recurring transaction history yet." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-5 py-3 font-semibold">Schedule</th>
                        <th className="px-5 py-3 font-semibold">Due date</th>
                        <th className="px-5 py-3 font-semibold">Entry date</th>
                        <th className="px-5 py-3 text-right font-semibold">Amount</th>
                        <th className="px-5 py-3 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {occurrences.map(item => {
                        const schedule = scheduleMap.get(item.recurring_transaction_id)
                        return (
                          <tr key={item.id}>
                            <td className="px-5 py-3 font-medium text-slate-800">{schedule?.name || 'Schedule unavailable'}</td>
                            <td className="px-5 py-3 text-slate-600">{formatDate(item.due_date)}</td>
                            <td className="px-5 py-3 text-slate-600">{formatDate(item.entry_date)}</td>
                            <td className="px-5 py-3 text-right font-semibold text-slate-800">{item.status === 'skipped' ? '—' : formatMoney(item.amount_minor)}</td>
                            <td className="px-5 py-3">
                              <div className="space-y-1">
                                {statusBadge(item.status)}
                                {item.error_message && (
                                  <p className="max-w-xs text-xs text-red-600">{item.error_message}</p>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : viewMode === 'calendar' && filter === 'all' ? (
            <RecurringCalendar
              monthLabel={calendarMonthLabel}
              monthDays={calendarDays}
              selectedDate={selectedCalendarDate}
              selectedEvents={selectedCalendarEvents}
              monthIncome={calendarIncome}
              monthExpenses={calendarExpenses}
              onPreviousMonth={() => changeCalendarMonth(-1)}
              onNextMonth={() => changeCalendarMonth(1)}
              onToday={goToCurrentCalendarMonth}
              onSelectDate={setSelectedCalendarDate}
              onRecord={openRecordModal}
              onSkip={schedule => void handleSkipOccurrence(schedule)}
            />
          ) : (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div>
                  <h2 className="font-bold text-slate-800">
                    {filter === 'due'
                      ? 'Due schedules and reminders'
                      : filter === 'upcoming'
                        ? 'Upcoming schedules'
                        : filter === 'paused'
                          ? 'Paused schedules'
                          : 'Your recurring schedules'}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Each occurrence is recorded only after you confirm it.
                  </p>
                </div>
                <span className="text-xs text-slate-400">{currentSchedules.length} schedule(s)</span>
              </div>

              {currentSchedules.length === 0 ? (
                <EmptyState
                  message={
                    filter === 'due'
                      ? 'No reminders need attention.'
                      : filter === 'upcoming'
                        ? 'No upcoming reminders in the next 30 days.'
                        : filter === 'paused'
                          ? 'You have no paused schedules.'
                          : 'Create your first recurring income or expense schedule.'
                  }
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-5 py-3 font-semibold">Schedule</th>
                        <th className="px-5 py-3 font-semibold">Type</th>
                        <th className="px-5 py-3 text-right font-semibold">Amount</th>
                        <th className="px-5 py-3 font-semibold">Frequency</th>
                        <th className="px-5 py-3 font-semibold">Next due</th>
                        <th className="px-5 py-3 font-semibold">Status</th>
                        <th className="px-5 py-3 text-right font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {currentSchedules.map(schedule => (
                        <tr key={schedule.id} data-type={schedule.transaction_type} className="ledger-recurring-row hover:bg-slate-50/70">
                          <td className="px-5 py-3">
                            <p className="font-semibold text-slate-800">{schedule.name}</p>
                            <p className="mt-0.5 text-xs text-slate-500">
                              {accountMap.get(schedule.financial_account_id)?.name || 'Account unavailable'}
                            </p>
                          </td>
                          <td className="px-5 py-3">
                            <span data-type={schedule.transaction_type} className="ledger-recurring-type">
                              {schedule.transaction_type === 'income' ? 'Income' : 'Expense'}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-right font-semibold text-slate-800">{formatMoney(schedule.amount_minor)}</td>
                          <td className="px-5 py-3 text-slate-600">{frequencyLabel(schedule.frequency_unit, schedule.frequency_interval)}</td>
                          <td className="px-5 py-3 text-slate-600">{formatDate(schedule.next_due_date)}</td>
                          <td className="px-5 py-3">{statusBadge(schedule.status)}</td>
                          <td className="px-5 py-3">
                            <div className="flex justify-end gap-1">
                              <button
                                type="button"
                                title="Edit"
                                onClick={() => openEditForm(schedule)}
                                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                              >
                                <Edit3 size={16} />
                              </button>
                              {schedule.status === 'active' ? (
                                <button
                                  type="button"
                                  title="Pause"
                                  onClick={() => void updateStatus(schedule, 'paused')}
                                  disabled={saving}
                                  className="rounded-lg p-2 text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                                >
                                  <Pause size={16} />
                                </button>
                              ) : schedule.status === 'paused' ? (
                                <button
                                  type="button"
                                  title="Resume"
                                  onClick={() => void updateStatus(schedule, 'active')}
                                  disabled={saving}
                                  className="rounded-lg p-2 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                                >
                                  <Play size={16} />
                                </button>
                              ) : null}
                              {(schedule.status === 'active' || schedule.status === 'paused') && (
                                <button
                                  type="button"
                                  title="Cancel schedule"
                                  onClick={() => {
                                    if (window.confirm(`Cancel "${schedule.name}"? Its history will be retained.`)) {
                                      void updateStatus(schedule, 'cancelled')
                                    }
                                  }}
                                  disabled={saving}
                                  className="rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-50"
                                >
                                  <X size={16} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {filter !== 'history' && upcomingSchedules.length > 0 && (
            <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-sm text-blue-900">
              <div className="flex items-center gap-2 font-semibold">
                <CalendarDays size={16} />
                Coming up in the next 30 days
              </div>
              <p className="mt-1 text-xs text-blue-800">
                {upcomingSchedules.slice(0, 4).map(item => `${item.name} (${formatDate(item.next_due_date)})`).join(' · ')}
              </p>
            </div>
          )}

          <p className="text-xs leading-5 text-slate-400">
            In-app reminders are always available. Optional desktop browser notifications are delivered while this page is open; background push notifications, SMS and email are not enabled. Recurring schedules never create journal entries until you confirm each occurrence.
          </p>
        </>
      )}

      {showForm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4">
          <div className="my-8 w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {editingSchedule ? 'Edit recurring schedule' : 'Create recurring schedule'}
                </h2>
                <p className="mt-1 text-xs text-slate-500">Set up a regular income or expense reminder.</p>
              </div>
              <button type="button" onClick={() => setShowForm(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">
                <X size={19} />
              </button>
            </div>

            <form onSubmit={handleSaveSchedule} className="space-y-5 p-6">
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  disabled={Boolean(editingSchedule)}
                  onClick={() => setForm(previous => ({ ...previous, transactionType: 'income', financialAccountId: '', categoryAccountId: '' }))}
                  className={`rounded-lg px-4 py-2.5 text-sm font-semibold ${form.transactionType === 'income' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500'} disabled:opacity-70`}
                >
                  Recurring income
                </button>
                <button
                  type="button"
                  disabled={Boolean(editingSchedule)}
                  onClick={() => setForm(previous => ({ ...previous, transactionType: 'expense', financialAccountId: '', categoryAccountId: '' }))}
                  className={`rounded-lg px-4 py-2.5 text-sm font-semibold ${form.transactionType === 'expense' ? 'bg-white text-red-700 shadow-sm' : 'text-slate-500'} disabled:opacity-70`}
                >
                  Recurring expense
                </button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Schedule name">
                  <input required value={form.name} onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))} placeholder="e.g. Monthly salary, House rent" className={inputClass} />
                </Field>
                <Field label="Expected amount (BDT)">
                  <input required inputMode="decimal" value={form.amount} onChange={event => setForm(previous => ({ ...previous, amount: event.target.value }))} placeholder="e.g. 45000.00" className={inputClass} />
                </Field>
                <Field label="Financial account">
                  <select required value={form.financialAccountId} onChange={event => setForm(previous => ({ ...previous, financialAccountId: event.target.value }))} className={inputClass}>
                    <option value="">Select account</option>
                    {financialAccounts.map(account => <option key={account.id} value={account.id}>{account.name}{account.account_type === 'liability' ? ' (Credit)' : ''}</option>)}
                  </select>
                </Field>
                <Field label="Category">
                  <select required value={form.categoryAccountId} onChange={event => setForm(previous => ({ ...previous, categoryAccountId: event.target.value }))} className={inputClass}>
                    <option value="">Select category</option>
                    {categoryAccounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                  </select>
                </Field>
                <Field label="Frequency">
                  <select value={form.frequencyPreset} onChange={event => handleFrequencyPreset(event.target.value as ScheduleForm['frequencyPreset'])} className={inputClass}>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                    <option value="custom">Custom interval</option>
                  </select>
                </Field>
                {form.frequencyPreset === 'custom' && (
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Every">
                      <input type="number" min="1" max="365" step="1" value={form.frequencyInterval} onChange={event => setForm(previous => ({ ...previous, frequencyInterval: event.target.value }))} className={inputClass} />
                    </Field>
                    <Field label="Unit">
                      <select value={form.frequencyUnit} onChange={event => setForm(previous => ({ ...previous, frequencyUnit: event.target.value as FrequencyUnit }))} className={inputClass}>
                        <option value="day">Days</option>
                        <option value="week">Weeks</option>
                        <option value="month">Months</option>
                        <option value="year">Years</option>
                      </select>
                    </Field>
                  </div>
                )}
                <Field label="Start date">
                  <input required type="date" disabled={Boolean(editingSchedule)} value={form.startDate} onChange={event => setForm(previous => ({ ...previous, startDate: event.target.value }))} className={inputClass} />
                </Field>
                <Field label="End date (optional)">
                  <input type="date" min={form.startDate} value={form.endDate} onChange={event => setForm(previous => ({ ...previous, endDate: event.target.value }))} className={inputClass} />
                </Field>
                <Field label="Remind me before">
                  <select value={form.reminderDays} onChange={event => setForm(previous => ({ ...previous, reminderDays: event.target.value }))} className={inputClass}>
                    <option value="0">On the due date</option>
                    <option value="1">1 day before</option>
                    <option value="3">3 days before</option>
                    <option value="7">7 days before</option>
                    <option value="14">14 days before</option>
                    <option value="30">30 days before</option>
                  </select>
                </Field>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <p className="mb-3 text-sm font-semibold text-slate-700">Optional transaction details</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Description">
                    <input value={form.description} onChange={event => setForm(previous => ({ ...previous, description: event.target.value }))} placeholder="Description on the transaction" className={inputClass} />
                  </Field>
                  <Field label="Payee / Payer">
                    <input value={form.payee} onChange={event => setForm(previous => ({ ...previous, payee: event.target.value }))} placeholder="Name, company or person" className={inputClass} />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Notes">
                      <textarea rows={2} value={form.notes} onChange={event => setForm(previous => ({ ...previous, notes: event.target.value }))} placeholder="Optional notes" className={inputClass} />
                    </Field>
                  </div>
                </div>
              </div>

              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

              <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
                <button type="button" onClick={() => setShowForm(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={saving || !financialAccounts.length || !categoryAccounts.length} className="rounded-xl bg-ledger-navy px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
                  {saving ? 'Saving...' : editingSchedule ? 'Save changes' : 'Create schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {recordTarget && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4">
          <div className="my-8 w-full max-w-lg rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h2 className="font-bold text-slate-900">Confirm transaction</h2>
                <p className="mt-1 text-xs text-slate-500">{recordTarget.schedule.name} · due {formatDate(recordTarget.schedule.next_due_date)}</p>
              </div>
              <button type="button" onClick={() => setRecordTarget(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={19} /></button>
            </div>

            <form onSubmit={handleRecordOccurrence} className="space-y-4 p-6">
              <div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-900">
                Ledger will create a posted {recordTarget.schedule.transaction_type} transaction using your existing accounting workflow. Review the amount and actual transaction date before confirming.
              </div>
              <Field label="Actual amount (BDT)">
                <input required inputMode="decimal" value={recordAmount} onChange={event => setRecordAmount(event.target.value)} className={inputClass} />
              </Field>
              <Field label="Actual transaction date">
                <input required type="date" value={recordDate} onChange={event => setRecordDate(event.target.value)} className={inputClass} />
              </Field>
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button type="button" onClick={() => setRecordTarget(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">Cancel</button>
                <button type="submit" disabled={saving} className="rounded-xl bg-ledger-navy px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                  {saving ? 'Recording...' : 'Confirm and record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

const inputClass = 'mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-xs font-semibold text-slate-600">
      {label}
      {children}
    </label>
  )
}

function RecurringCalendar({
  monthLabel,
  monthDays,
  selectedDate,
  selectedEvents,
  monthIncome,
  monthExpenses,
  onPreviousMonth,
  onNextMonth,
  onToday,
  onSelectDate,
  onRecord,
  onSkip,
}: {
  monthLabel: string
  monthDays: CalendarDay[]
  selectedDate: string
  selectedEvents: CalendarEvent[]
  monthIncome: number
  monthExpenses: number
  onPreviousMonth: () => void
  onNextMonth: () => void
  onToday: () => void
  onSelectDate: (date: string) => void
  onRecord: (schedule: RecurringSchedule) => void
  onSkip: (schedule: RecurringSchedule) => void
}) {
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const net = monthIncome - monthExpenses

  const eventTone = (event: CalendarEvent) => {
    const color = event.schedule.transaction_type === 'income' ? '#0B9B78' : '#D95B70'
    return {
      backgroundColor: `color-mix(in srgb, ${color} 12%, var(--ledger-surface))`,
      color,
    }
  }

  const statusText: Record<CalendarEvent['status'], string> = {
    processing: 'Processing',
    recorded: 'Recorded',
    skipped: 'Skipped',
    failed: 'Failed',
    scheduled: 'Due',
    projected: 'Forecast',
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <ForecastCard
          label="Expected income"
          value={formatMoney(monthIncome)}
          tone="income"
          detail="Scheduled and recorded"
        />
        <ForecastCard
          label="Expected expenses"
          value={formatMoney(monthExpenses)}
          tone="expense"
          detail="Scheduled and recorded"
        />
        <ForecastCard
          label="Net scheduled cash flow"
          value={`${net < 0 ? '−' : '+'}${formatMoney(Math.abs(net))}`}
          tone="net"
          detail="Income minus expenses"
        />
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
          <div>
            <h2 className="font-bold text-slate-800">Payment calendar</h2>
            <p className="mt-1 text-xs text-slate-500">Scheduled dates, recorded occurrences and projected payments</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onToday}
              className="mr-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Today
            </button>
            <button
              type="button"
              onClick={onPreviousMonth}
              aria-label="Previous month"
              className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
            >
              <ChevronLeft size={16} />
            </button>
            <p className="min-w-[132px] text-center text-sm font-bold text-slate-800">{monthLabel}</p>
            <button
              type="button"
              onClick={onNextMonth}
              aria-label="Next month"
              className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        <div className="p-2 sm:p-4">
          <div className="grid grid-cols-7 gap-1">
            {weekdays.map(day => (
              <div key={day} className="px-1 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-slate-400 sm:text-xs">
                {day}
              </div>
            ))}
            {monthDays.map(day => {
              const selected = day.date === selectedDate
              return (
                <button
                  key={day.date}
                  type="button"
                  onClick={() => onSelectDate(day.date)}
                  aria-pressed={selected}
                  className={`min-h-[82px] min-w-0 rounded-lg border p-1.5 text-left transition sm:min-h-[112px] sm:rounded-xl sm:p-2 ${
                    day.inMonth ? 'bg-white' : 'bg-slate-50/80'
                  } ${selected ? 'ring-2 ring-offset-1' : 'border-slate-100 hover:border-slate-300'}`}
                  style={selected ? {
                    borderColor: 'var(--ledger-accent)',
                    backgroundColor: 'var(--ledger-accent-soft)',
                    outlineColor: 'var(--ledger-accent)',
                  } : undefined}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className={`text-xs font-semibold ${
                      day.inMonth ? 'text-slate-700' : 'text-slate-300'
                    } ${day.isToday ? 'rounded-full bg-ledger-navy px-1.5 py-0.5 text-white' : ''}`}>
                      {Number(day.date.slice(-2))}
                    </span>
                    {day.events.length > 0 && (
                      <span className="text-[9px] font-semibold text-slate-400">{day.events.length}</span>
                    )}
                  </div>
                  <div className="mt-1.5 space-y-1">
                    {day.events.slice(0, 2).map(event => (
                      <div
                        key={event.id}
                        title={`${event.schedule.name} · ${formatMoney(event.amountMinor)}`}
                        className="truncate rounded px-1 py-1 text-[9px] font-semibold leading-tight sm:text-[10px]"
                        style={eventTone(event)}
                      >
                        <span className="hidden sm:inline">{event.schedule.name}</span>
                        <span className="sm:hidden">{event.schedule.transaction_type === 'income' ? 'Income' : 'Expense'}</span>
                      </div>
                    ))}
                    {day.events.length > 2 && (
                      <p className="px-1 text-[9px] font-medium text-slate-400">+{day.events.length - 2} more</p>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500 sm:px-5">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500"/>Income</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-500"/>Expense</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-violet-500"/>Next due</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-400"/>Forecast</span>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="font-bold text-slate-800">Payments on {formatDate(selectedDate)}</h3>
          <p className="mt-1 text-xs text-slate-500">
            {selectedEvents.length} scheduled or recorded item{selectedEvents.length === 1 ? '' : 's'}
          </p>
        </div>
        {selectedEvents.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <CalendarClock size={24} className="mx-auto mb-2 text-slate-300"/>
            <p className="text-sm text-slate-500">Nothing scheduled for this date.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {selectedEvents.map(event => (
              <div key={event.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-800">{event.schedule.name}</p>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">
                      {statusText[event.status]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {event.schedule.transaction_type === 'income' ? 'Income' : 'Expense'}
                    {' · '}{frequencyLabel(event.schedule.frequency_unit, event.schedule.frequency_interval)}
                    {' · '}{event.schedule.payee || 'No payee specified'}
                  </p>
                  {event.errorMessage && (
                    <p className="mt-1 max-w-xl text-xs text-red-600">{event.errorMessage}</p>
                  )}
                  {event.status === 'projected' && (
                    <p className="mt-1 text-xs text-slate-400">Forecast only. Record or skip the earlier occurrence before this date becomes actionable.</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-3 sm:justify-end">
                  <strong className={`text-base tabular-nums ${
                    event.schedule.transaction_type === 'income' ? 'text-emerald-700' : 'text-rose-700'
                  }`}>
                    {event.status === 'skipped' ? '—' : formatMoney(event.amountMinor)}
                  </strong>
                  {event.isActionable && (
                    <>
                      <button
                        type="button"
                        onClick={() => onRecord(event.schedule)}
                        className="rounded-lg bg-ledger-navy px-3 py-2 text-xs font-semibold text-white hover:opacity-90"
                      >
                        {event.status === 'failed' ? 'Retry recording' : 'Record transaction'}
                      </button>
                      {event.status === 'scheduled' && (
                        <button
                          type="button"
                          onClick={() => onSkip(event.schedule)}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          Skip date
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function ForecastCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: string
  detail: string
  tone: 'income' | 'expense' | 'net'
}) {
  const accent = tone === 'income' ? '#0B9B78' : tone === 'expense' ? '#D95B70' : 'var(--ledger-accent)'
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-2 break-words text-xl font-bold tabular-nums" style={{ color: accent }}>{value}</p>
      <p className="mt-1 text-[11px] text-slate-400">{detail}</p>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string
  value: string
  detail: string
  icon: typeof Repeat
  tone: 'blue' | 'amber' | 'purple' | 'green'
}) {
  const tones = {
    blue: 'bg-blue-50 text-blue-700',
    amber: 'bg-amber-50 text-amber-700',
    purple: 'bg-violet-50 text-violet-700',
    green: 'bg-emerald-50 text-emerald-700',
  }
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">{label}</p>
        <div className={`rounded-xl p-2.5 ${tones[tone]}`}><Icon size={20} /></div>
      </div>
      <p className="mt-4 break-words text-2xl font-bold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="px-5 py-14 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
        <CalendarClock size={22} />
      </div>
      <p className="text-sm text-slate-500">{message}</p>
    </div>
  )
}
