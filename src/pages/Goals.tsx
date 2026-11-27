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
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Edit3,
  Flag,
  Plus,
  RefreshCw,
  Target,
  Trash2,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'

import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatBDTMinor, formatLedgerDate } from '../lib/preferences'

type GoalStatus = 'active' | 'paused' | 'completed' | 'cancelled'
type TrackingMode = 'manual' | 'linked_account'
type GoalEntryType = 'contribution' | 'withdrawal'

type FinancialGoal = {
  id: string
  user_id: string
  name: string
  description: string | null
  target_amount_minor: number | string
  start_date: string
  target_date: string | null
  priority: 'low' | 'medium' | 'high'
  status: GoalStatus
  tracking_mode: TrackingMode
  linked_account_id: string | null
  created_at: string
  updated_at: string
}

type GoalEntry = {
  id: string
  user_id: string
  goal_id: string
  entry_type: GoalEntryType
  amount_minor: number | string
  entry_date: string
  notes: string | null
  created_at: string
}

type LedgerAccount = {
  id: string
  name: string
  account_kind: 'financial' | 'category'
  account_type: 'asset' | 'liability' | 'equity' | 'income' | 'expense'
  subtype: string | null
  is_active: boolean
}

type JournalLine = {
  journal_entry_id: string
  ledger_account_id: string
  debit_minor: number | string
  credit_minor: number | string
}

type GoalView = {
  goal: FinancialGoal
  targetMinor: number
  savedMinor: number
  remainingMinor: number
  percentage: number
  accountName: string | null
  entryCount: number
  monthlyRequiredMinor: number | null
  behindSchedule: boolean
}

type GoalFilter = 'all' | 'active' | 'paused' | 'completed' | 'behind'

type GoalFormState = {
  name: string
  description: string
  targetAmount: string
  startDate: string
  targetDate: string
  priority: 'low' | 'medium' | 'high'
  trackingMode: TrackingMode
  linkedAccountId: string
}

const PAGE_SIZE = 500
const BATCH_SIZE = 200

function getLocalDate() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatBDT(minor: number) {
  return formatBDTMinor(minor)
}

function parseAmountToMinor(value: string): number | null {
  const cleaned = value.trim().replace(/,/g, '')

  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null

  const [whole, fraction = ''] = cleaned.split('.')
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))

  if (!Number.isSafeInteger(minor) || minor <= 0) return null
  return minor
}

function formatDate(value: string | null) {
  if (!value) return 'No target date'
  return formatLedgerDate(value)
}

function daysUntil(value: string | null) {
  if (!value) return null

  const target = new Date(`${value}T00:00:00`)
  const today = new Date(`${getLocalDate()}T00:00:00`)
  return Math.ceil((target.getTime() - today.getTime()) / 86400000)
}

function statusLabel(status: GoalStatus) {
  const labels: Record<GoalStatus, string> = {
    active: 'Active',
    paused: 'Paused',
    completed: 'Completed',
    cancelled: 'Cancelled',
  }
  return labels[status]
}

function statusClasses(status: GoalStatus) {
  const classes: Record<GoalStatus, string> = {
    active: 'bg-emerald-50 text-emerald-700',
    paused: 'bg-amber-50 text-amber-700',
    completed: 'bg-blue-50 text-blue-700',
    cancelled: 'bg-slate-100 text-slate-600',
  }
  return classes[status]
}

function priorityClasses(priority: FinancialGoal['priority']) {
  const classes = {
    low: 'bg-slate-100 text-slate-600',
    medium: 'bg-blue-50 text-blue-700',
    high: 'bg-rose-50 text-rose-700',
  }
  return classes[priority]
}

function getProgressColor(percentage: number) {
  if (percentage >= 100) return 'bg-emerald-500'
  if (percentage >= 75) return 'bg-blue-600'
  if (percentage >= 40) return 'bg-indigo-500'
  return 'bg-amber-500'
}

function getDefaultGoalForm(): GoalFormState {
  return {
    name: '',
    description: '',
    targetAmount: '',
    startDate: getLocalDate(),
    targetDate: '',
    priority: 'medium',
    trackingMode: 'manual',
    linkedAccountId: '',
  }
}

export default function Goals() {
  const { user } = useAuth()

  const [goals, setGoals] = useState<FinancialGoal[]>([])
  const [entries, setEntries] = useState<GoalEntry[]>([])
  const [accounts, setAccounts] = useState<LedgerAccount[]>([])
  const [linkedBalances, setLinkedBalances] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [filter, setFilter] = useState<GoalFilter>('all')
  const [showGoalForm, setShowGoalForm] = useState(false)
  const [editingGoal, setEditingGoal] = useState<FinancialGoal | null>(null)
  const [goalForm, setGoalForm] = useState<GoalFormState>(getDefaultGoalForm)

  const [entryGoal, setEntryGoal] = useState<FinancialGoal | null>(null)
  const [entryType, setEntryType] = useState<GoalEntryType>('contribution')
  const [entryAmount, setEntryAmount] = useState('')
  const [entryDate, setEntryDate] = useState(getLocalDate())
  const [entryNotes, setEntryNotes] = useState('')
  const [entrySaving, setEntrySaving] = useState(false)

  const [goalToDelete, setGoalToDelete] = useState<FinancialGoal | null>(null)
  const [entryToDelete, setEntryToDelete] = useState<GoalEntry | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadData = useCallback(async (showRefresh = false) => {
    if (!user?.id) {
      setGoals([])
      setEntries([])
      setAccounts([])
      setLinkedBalances({})
      setLoading(false)
      return
    }

    if (showRefresh) setRefreshing(true)
    else setLoading(true)

    setError('')

    try {
      const [goalRows, entryRows, accountResult] = await Promise.all([
        (async () => {
          const rows: FinancialGoal[] = []
          for (let offset = 0; ; offset += PAGE_SIZE) {
            const { data, error: queryError } = await supabase
              .from('financial_goals')
              .select('*')
              .order('created_at', { ascending: false })
              .range(offset, offset + PAGE_SIZE - 1)

            if (queryError) throw queryError
            const page = (data || []) as FinancialGoal[]
            rows.push(...page)
            if (page.length < PAGE_SIZE) break
          }
          return rows
        })(),
        (async () => {
          const rows: GoalEntry[] = []
          for (let offset = 0; ; offset += PAGE_SIZE) {
            const { data, error: queryError } = await supabase
              .from('goal_entries')
              .select('*')
              .order('entry_date', { ascending: false })
              .order('created_at', { ascending: false })
              .range(offset, offset + PAGE_SIZE - 1)

            if (queryError) throw queryError
            const page = (data || []) as GoalEntry[]
            rows.push(...page)
            if (page.length < PAGE_SIZE) break
          }
          return rows
        })(),
        supabase
          .from('ledger_accounts')
          .select('id, name, account_kind, account_type, subtype, is_active')
          .eq('account_kind', 'financial')
          .eq('account_type', 'asset')
          .order('name', { ascending: true }),
      ])

      if (accountResult.error) throw accountResult.error

      const accountRows = (accountResult.data || []) as LedgerAccount[]
      const linkedAccountIds = [
        ...new Set(
          goalRows
            .filter(goal => goal.tracking_mode === 'linked_account' && goal.linked_account_id)
            .map(goal => goal.linked_account_id as string)
        ),
      ]

      const balances: Record<string, number> = {}

      if (linkedAccountIds.length > 0) {
        const allLines: JournalLine[] = []

        for (let offset = 0; ; offset += PAGE_SIZE) {
          const { data, error: lineError } = await supabase
            .from('journal_lines')
            .select('id, journal_entry_id, ledger_account_id, debit_minor, credit_minor')
            .eq('user_id', user.id)
            .in('ledger_account_id', linkedAccountIds)
            .order('id', { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1)

          if (lineError) throw lineError

          const page = (data || []) as JournalLine[]
          allLines.push(...page)
          if (page.length < PAGE_SIZE) break
        }

        const entryIds = [...new Set(allLines.map(line => line.journal_entry_id))]
        const postedEntryIds = new Set<string>()

        for (let offset = 0; offset < entryIds.length; offset += BATCH_SIZE) {
          const batch = entryIds.slice(offset, offset + BATCH_SIZE)
          const { data, error: postedError } = await supabase
            .from('journal_entries')
            .select('id')
            .eq('user_id', user.id)
            .eq('status', 'posted')
            .in('id', batch)

          if (postedError) throw postedError
          for (const row of data || []) postedEntryIds.add(row.id)
        }

        for (const line of allLines) {
          if (!postedEntryIds.has(line.journal_entry_id)) continue
          const current = balances[line.ledger_account_id] || 0
          balances[line.ledger_account_id] =
            current + Number(line.debit_minor || 0) - Number(line.credit_minor || 0)
        }
      }

      setGoals(goalRows)
      setEntries(entryRows)
      setAccounts(accountRows)
      setLinkedBalances(balances)
    } catch (err) {
      console.error('Goals loading error:', err)
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load financial goals.'
      )
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [user?.id])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const accountMap = useMemo(
    () => new Map(accounts.map(account => [account.id, account])),
    [accounts]
  )

  const entriesByGoal = useMemo(() => {
    const map = new Map<string, GoalEntry[]>()
    for (const entry of entries) {
      const current = map.get(entry.goal_id) || []
      current.push(entry)
      map.set(entry.goal_id, current)
    }
    return map
  }, [entries])

  const goalViews = useMemo<GoalView[]>(() => {
    return goals.map(goal => {
      const targetMinor = Number(goal.target_amount_minor)
      const goalEntries = entriesByGoal.get(goal.id) || []
      const savedMinor =
        goal.tracking_mode === 'linked_account'
          ? linkedBalances[goal.linked_account_id || ''] || 0
          : goalEntries.reduce((total, entry) => {
              const amount = Number(entry.amount_minor)
              return total + (entry.entry_type === 'contribution' ? amount : -amount)
            }, 0)

      const percentage =
        targetMinor > 0 ? Math.max(0, (savedMinor / targetMinor) * 100) : 0
      const remainingMinor = targetMinor - savedMinor
      const today = getLocalDate()
      const monthsRemaining = goal.target_date && goal.target_date >= today
        ? Math.max(1, (Number(goal.target_date.slice(0, 4)) - Number(today.slice(0, 4))) * 12 + Number(goal.target_date.slice(5, 7)) - Number(today.slice(5, 7)) + 1)
        : null
      const monthlyRequiredMinor = monthsRemaining && remainingMinor > 0
        ? Math.ceil(remainingMinor / monthsRemaining)
        : null
      let behindSchedule = false
      if (goal.target_date && remainingMinor > 0 && goal.target_date >= today && goal.target_date > goal.start_date) {
        const start = new Date(`${goal.start_date}T00:00:00`).getTime()
        const end = new Date(`${goal.target_date}T00:00:00`).getTime()
        const now = new Date(`${today}T00:00:00`).getTime()
        const elapsed = Math.max(0, Math.min(1, (now - start) / (end - start)))
        behindSchedule = savedMinor < targetMinor * elapsed * 0.9
      } else if (goal.target_date && goal.target_date < today && remainingMinor > 0) {
        behindSchedule = true
      }

      return {
        goal,
        targetMinor,
        savedMinor,
        remainingMinor,
        percentage,
        accountName: goal.linked_account_id
          ? accountMap.get(goal.linked_account_id)?.name || 'Linked account'
          : null,
        entryCount: goalEntries.length,
        monthlyRequiredMinor,
        behindSchedule,
      }
    })
  }, [goals, entriesByGoal, linkedBalances, accountMap])

  const filteredGoals = useMemo(() => {
    if (filter === 'all') return goalViews.filter(item => item.goal.status !== 'cancelled')
    if (filter === 'behind') return goalViews.filter(item => item.behindSchedule && item.goal.status === 'active')
    return goalViews.filter(item => item.goal.status === filter)
  }, [goalViews, filter])

  const activeGoals = goalViews.filter(item =>
    item.goal.status === 'active' || item.goal.status === 'paused'
  )
  const totalTarget = activeGoals.reduce((sum, item) => sum + item.targetMinor, 0)
  const totalSaved = activeGoals.reduce((sum, item) => sum + item.savedMinor, 0)
  const completedCount = goals.filter(goal => goal.status === 'completed').length

  const linkedAccountOptions = useMemo(() => {
    const usedByOtherGoals = new Set(
      goals
        .filter(goal => goal.id !== editingGoal?.id && goal.linked_account_id)
        .map(goal => goal.linked_account_id as string)
    )

    return accounts.filter(account =>
      account.is_active &&
      account.account_kind === 'financial' &&
      account.account_type === 'asset' &&
      !usedByOtherGoals.has(account.id)
    )
  }, [accounts, goals, editingGoal?.id])

  const openCreateGoal = () => {
    setEditingGoal(null)
    setGoalForm(getDefaultGoalForm())
    setError('')
    setShowGoalForm(true)
  }

  const openEditGoal = (goal: FinancialGoal) => {
    setEditingGoal(goal)
    setGoalForm({
      name: goal.name,
      description: goal.description || '',
      targetAmount: (Number(goal.target_amount_minor) / 100).toFixed(2),
      startDate: goal.start_date,
      targetDate: goal.target_date || '',
      priority: goal.priority,
      trackingMode: goal.tracking_mode,
      linkedAccountId: goal.linked_account_id || '',
    })
    setError('')
    setShowGoalForm(true)
  }

  const handleSaveGoal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!user?.id) return

    const targetMinor = parseAmountToMinor(goalForm.targetAmount)
    if (!goalForm.name.trim()) {
      setError('Please enter a goal name.')
      return
    }
    if (!targetMinor) {
      setError('Enter a valid target amount greater than zero.')
      return
    }
    if (!goalForm.startDate) {
      setError('Please select a start date.')
      return
    }
    if (goalForm.targetDate && goalForm.targetDate < goalForm.startDate) {
      setError('The target date cannot be earlier than the start date.')
      return
    }
    if (goalForm.trackingMode === 'linked_account' && !goalForm.linkedAccountId) {
      setError('Please select a dedicated savings or asset account.')
      return
    }

    const hasManualEntries =
      editingGoal && (entriesByGoal.get(editingGoal.id) || []).length > 0

    if (
      goalForm.trackingMode === 'linked_account' &&
      hasManualEntries
    ) {
      setError(
        'This goal already has manual contribution records. Create a new linked-account goal, or keep this goal on manual tracking.'
      )
      return
    }

    setSaving(true)
    setError('')
    setSuccess('')

    const payload = {
      user_id: user.id,
      name: goalForm.name.trim(),
      description: goalForm.description.trim() || null,
      target_amount_minor: targetMinor,
      start_date: goalForm.startDate,
      target_date: goalForm.targetDate || null,
      priority: goalForm.priority,
      tracking_mode: goalForm.trackingMode,
      linked_account_id:
        goalForm.trackingMode === 'linked_account'
          ? goalForm.linkedAccountId
          : null,
    }

    try {
      const result = editingGoal
        ? await supabase
            .from('financial_goals')
            .update(payload)
            .eq('id', editingGoal.id)
            .select()
            .single()
        : await supabase
            .from('financial_goals')
            .insert({ ...payload, status: 'active' })
            .select()
            .single()

      if (result.error) throw result.error

      setShowGoalForm(false)
      setEditingGoal(null)
      setSuccess(editingGoal ? 'Goal updated successfully.' : 'Goal created successfully.')
      await loadData(true)
    } catch (err) {
      console.error('Goal save error:', err)
      setError(err instanceof Error ? err.message : 'Unable to save this goal.')
    } finally {
      setSaving(false)
    }
  }

  const openEntryForm = (goal: FinancialGoal, type: GoalEntryType) => {
    setEntryGoal(goal)
    setEntryType(type)
    setEntryAmount('')
    setEntryDate(getLocalDate())
    setEntryNotes('')
    setError('')
    setSuccess('')
  }

  const handleSaveEntry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!user?.id || !entryGoal) return

    const amountMinor = parseAmountToMinor(entryAmount)
    if (!amountMinor) {
      setError('Enter a valid amount greater than zero.')
      return
    }

    const currentView = goalViews.find(item => item.goal.id === entryGoal.id)
    const currentSaved = currentView?.savedMinor || 0

    if (entryType === 'withdrawal' && amountMinor > currentSaved) {
      setError('A withdrawal cannot be greater than the current saved amount.')
      return
    }

    setEntrySaving(true)
    setError('')

    try {
      const { error: insertError } = await supabase
        .from('goal_entries')
        .insert({
          user_id: user.id,
          goal_id: entryGoal.id,
          entry_type: entryType,
          amount_minor: amountMinor,
          entry_date: entryDate,
          notes: entryNotes.trim() || null,
        })

      if (insertError) throw insertError

      setEntryGoal(null)
      setSuccess(
        entryType === 'contribution'
          ? 'Contribution recorded successfully.'
          : 'Withdrawal recorded successfully.'
      )
      await loadData(true)
    } catch (err) {
      console.error('Goal entry error:', err)
      setError(err instanceof Error ? err.message : 'Unable to record this entry.')
    } finally {
      setEntrySaving(false)
    }
  }

  const handleDeleteGoal = async () => {
    if (!goalToDelete) return

    setDeleting(true)
    setError('')
    try {
      const { error: deleteError } = await supabase
        .from('financial_goals')
        .delete()
        .eq('id', goalToDelete.id)

      if (deleteError) throw deleteError

      setGoalToDelete(null)
      setSuccess('Goal deleted. Its manual progress records were also removed.')
      await loadData(true)
    } catch (err) {
      console.error('Goal delete error:', err)
      setError(err instanceof Error ? err.message : 'Unable to delete this goal.')
    } finally {
      setDeleting(false)
    }
  }

  const handleDeleteEntry = async () => {
    if (!entryToDelete) return

    setDeleting(true)
    setError('')
    try {
      const { error: deleteError } = await supabase
        .from('goal_entries')
        .delete()
        .eq('id', entryToDelete.id)

      if (deleteError) throw deleteError

      setEntryToDelete(null)
      setSuccess('Goal entry deleted.')
      await loadData(true)
    } catch (err) {
      console.error('Goal entry delete error:', err)
      setError(err instanceof Error ? err.message : 'Unable to delete this entry.')
    } finally {
      setDeleting(false)
    }
  }

  const handleStatusChange = async (goal: FinancialGoal, status: GoalStatus) => {
    setError('')
    setSuccess('')

    try {
      const { error: updateError } = await supabase
        .from('financial_goals')
        .update({ status })
        .eq('id', goal.id)

      if (updateError) throw updateError

      setSuccess(`Goal marked as ${statusLabel(status).toLowerCase()}.`)
      await loadData(true)
    } catch (err) {
      console.error('Goal status update error:', err)
      setError(err instanceof Error ? err.message : 'Unable to update goal status.')
    }
  }

  const selectedEntryGoalView = entryGoal
    ? goalViews.find(item => item.goal.id === entryGoal.id)
    : null

  const recentEntries = useMemo(
    () => entries.slice(0, 12),
    [entries]
  )

  return (
    <div className="space-y-6">
      {/* PAGE HEADER */}
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-ledger-navy">
            <Target size={17} />
            <span>Personal financial planning</span>
          </div>
          <h2 className="text-3xl font-bold text-slate-900">Financial Goals</h2>
          <p className="mt-1 text-sm text-slate-500">
            Set targets, track your savings and monitor your progress.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void loadData(true)}
            disabled={refreshing || loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={openCreateGoal}
            className="inline-flex items-center gap-2 rounded-xl bg-ledger-navy px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-700"
          >
            <Plus size={17} />
            Create Goal
          </button>
        </div>
      </div>

      {error && !showGoalForm && !entryGoal && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
          <span>{success}</span>
          <button
            onClick={() => setSuccess('')}
            className="ml-auto text-emerald-700 hover:text-emerald-900"
            aria-label="Dismiss success message"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* SUMMARY CARDS */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Active and paused goals"
          value={String(activeGoals.length)}
          detail="Goals currently being tracked"
          icon={Target}
          tone="blue"
        />
        <SummaryCard
          label="Total saved"
          value={formatBDT(totalSaved)}
          detail="Across active and paused goals"
          icon={Wallet}
          tone="green"
        />
        <SummaryCard
          label="Combined target"
          value={formatBDT(totalTarget)}
          detail="Target amount of ongoing goals"
          icon={Flag}
          tone="amber"
        />
        <SummaryCard
          label="Completed goals"
          value={String(completedCount)}
          detail="Goals marked as completed"
          icon={CheckCircle2}
          tone="purple"
        />
      </div>

      {/* TRACKING EXPLANATION */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
          <div className="flex items-center gap-2 font-semibold text-slate-800">
            <CircleDollarSign size={19} className="text-blue-700" />
            Manual tracking
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Record contributions and withdrawals as goal progress. These are
            tracking records only and do not change your bank balances.
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
          <div className="flex items-center gap-2 font-semibold text-slate-800">
            <Wallet size={19} className="text-emerald-700" />
            Linked account tracking
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Link a dedicated asset account. Goal progress follows its posted
            balance; use Transfers to move money into that account.
          </p>
        </div>
      </div>

      {/* GOALS LIST */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center">
          <div>
            <h3 className="text-lg font-bold text-slate-800">Your goals</h3>
            <p className="mt-1 text-sm text-slate-500">
              Track progress toward your personal financial targets.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {([
              ['all', 'All goals'],
              ['active', 'Active'],
              ['paused', 'Paused'],
              ['completed', 'Completed'],
              ['behind', 'Behind schedule'],
            ] as [GoalFilter, string][]).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  filter === value
                    ? 'bg-ledger-navy text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-3 px-6 py-16 text-sm text-slate-500">
            <RefreshCw size={18} className="animate-spin" />
            Loading your goals...
          </div>
        ) : filteredGoals.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-ledger-navy">
              <Target size={30} />
            </div>
            <h4 className="text-lg font-semibold text-slate-800">
              {filter === 'all' ? 'No financial goals yet' : `No ${filter} goals`}
            </h4>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
              Create your first goal to start tracking a savings target, an
              emergency fund, a major purchase or another financial priority.
            </p>
            {filter === 'all' && (
              <button
                onClick={openCreateGoal}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-ledger-navy px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700"
              >
                <Plus size={17} />
                Create your first goal
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 p-5 xl:grid-cols-2">
            {filteredGoals.map(item => (
              <GoalCard
                key={item.goal.id}
                item={item}
                onEdit={() => openEditGoal(item.goal)}
                onDelete={() => setGoalToDelete(item.goal)}
                onAddContribution={() => openEntryForm(item.goal, 'contribution')}
                onAddWithdrawal={() => openEntryForm(item.goal, 'withdrawal')}
                onStatusChange={status => void handleStatusChange(item.goal, status)}
              />
            ))}
          </div>
        )}
      </section>

      {/* RECENT GOAL ACTIVITY */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-5">
          <h3 className="text-lg font-bold text-slate-800">Recent goal activity</h3>
          <p className="mt-1 text-sm text-slate-500">
            Recent manual contributions and withdrawals.
          </p>
        </div>

        {recentEntries.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">
            No manual goal activity has been recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Date</th>
                  <th className="px-5 py-3 font-semibold">Goal</th>
                  <th className="px-5 py-3 font-semibold">Type</th>
                  <th className="px-5 py-3 text-right font-semibold">Amount</th>
                  <th className="px-5 py-3 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentEntries.map(entry => {
                  const goal = goals.find(item => item.id === entry.goal_id)
                  return (
                    <tr key={entry.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-4 text-slate-600">{formatDate(entry.entry_date)}</td>
                      <td className="px-5 py-4 font-medium text-slate-800">{goal?.name || 'Deleted goal'}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                          entry.entry_type === 'contribution'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-amber-50 text-amber-700'
                        }`}>
                          {entry.entry_type === 'contribution' ? (
                            <ArrowUpRight size={13} />
                          ) : (
                            <ArrowDownRight size={13} />
                          )}
                          {entry.entry_type === 'contribution' ? 'Contribution' : 'Withdrawal'}
                        </span>
                      </td>
                      <td className={`px-5 py-4 text-right font-semibold ${
                        entry.entry_type === 'contribution' ? 'text-emerald-700' : 'text-amber-700'
                      }`}>
                        {entry.entry_type === 'contribution' ? '+' : '-'}{formatBDT(Number(entry.amount_minor))}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={() => setEntryToDelete(entry)}
                          className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          title="Delete goal entry"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* CREATE / EDIT GOAL MODAL */}
      {showGoalForm && (
        <ModalShell
          title={editingGoal ? 'Edit financial goal' : 'Create financial goal'}
          subtitle="Set your target and choose how Ledger should track progress."
          onClose={() => {
            setShowGoalForm(false)
            setEditingGoal(null)
            setError('')
          }}
        >
          <form onSubmit={handleSaveGoal} className="space-y-4">
            {error && <InlineError message={error} />}

            <FormField label="Goal name" required>
              <input
                value={goalForm.name}
                onChange={event => setGoalForm(current => ({ ...current, name: event.target.value }))}
                placeholder="e.g. Emergency fund"
                maxLength={120}
                className={inputClass}
                required
              />
            </FormField>

            <FormField label="Description">
              <textarea
                value={goalForm.description}
                onChange={event => setGoalForm(current => ({ ...current, description: event.target.value }))}
                placeholder="What are you saving for?"
                rows={2}
                maxLength={1000}
                className={inputClass}
              />
            </FormField>

            <FormField label="Target amount (BDT)" required>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={goalForm.targetAmount}
                onChange={event => setGoalForm(current => ({ ...current, targetAmount: event.target.value }))}
                placeholder="500000"
                className={inputClass}
                required
              />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Start date" required>
                <input
                  type="date"
                  value={goalForm.startDate}
                  onChange={event => setGoalForm(current => ({ ...current, startDate: event.target.value }))}
                  className={inputClass}
                  required
                />
              </FormField>
              <FormField label="Target date">
                <input
                  type="date"
                  value={goalForm.targetDate}
                  min={goalForm.startDate}
                  onChange={event => setGoalForm(current => ({ ...current, targetDate: event.target.value }))}
                  className={inputClass}
                />
              </FormField>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Priority">
                <select
                  value={goalForm.priority}
                  onChange={event => setGoalForm(current => ({ ...current, priority: event.target.value as GoalFormState['priority'] }))}
                  className={inputClass}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </FormField>
              <FormField label="Progress tracking">
                <select
                  value={goalForm.trackingMode}
                  onChange={event => setGoalForm(current => ({ ...current, trackingMode: event.target.value as TrackingMode, linkedAccountId: '' }))}
                  className={inputClass}
                >
                  <option value="manual">Manual contributions</option>
                  <option value="linked_account">Linked account balance</option>
                </select>
              </FormField>
            </div>

            {goalForm.trackingMode === 'linked_account' && (
              <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
                <FormField label="Dedicated asset account" required>
                  <select
                    value={goalForm.linkedAccountId}
                    onChange={event => setGoalForm(current => ({ ...current, linkedAccountId: event.target.value }))}
                    className={inputClass}
                    required
                  >
                    <option value="">Select an account</option>
                    {linkedAccountOptions.map(account => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </FormField>
                <p className="text-xs leading-5 text-emerald-800">
                  The full posted balance of this account will count toward the
                  goal. Use a separate account dedicated to this goal. Money is
                  not moved automatically.
                </p>
              </div>
            )}

            <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowGoalForm(false)
                  setEditingGoal(null)
                  setError('')
                }}
                className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-ledger-navy px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : editingGoal ? 'Save changes' : 'Create goal'}
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {/* CONTRIBUTION / WITHDRAWAL MODAL */}
      {entryGoal && (
        <ModalShell
          title={entryType === 'contribution' ? 'Record contribution' : 'Record withdrawal'}
          subtitle={entryGoal.name}
          onClose={() => {
            setEntryGoal(null)
            setError('')
          }}
        >
          <form onSubmit={handleSaveEntry} className="space-y-4">
            {error && <InlineError message={error} />}

            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-xs font-medium text-slate-500">Current recorded progress</p>
              <p className="mt-1 text-xl font-bold text-slate-900">
                {formatBDT(selectedEntryGoalView?.savedMinor || 0)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Target: {formatBDT(Number(entryGoal.target_amount_minor))}
              </p>
            </div>

            <FormField label="Entry type">
              <select
                value={entryType}
                onChange={event => setEntryType(event.target.value as GoalEntryType)}
                className={inputClass}
              >
                <option value="contribution">Contribution</option>
                <option value="withdrawal">Withdrawal</option>
              </select>
            </FormField>

            <FormField label="Amount (BDT)" required>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={entryAmount}
                onChange={event => setEntryAmount(event.target.value)}
                placeholder="10000"
                className={inputClass}
                required
              />
            </FormField>

            <FormField label="Date" required>
              <input
                type="date"
                value={entryDate}
                onChange={event => setEntryDate(event.target.value)}
                className={inputClass}
                required
              />
            </FormField>

            <FormField label="Notes">
              <textarea
                value={entryNotes}
                onChange={event => setEntryNotes(event.target.value)}
                placeholder="Optional note"
                rows={2}
                maxLength={1000}
                className={inputClass}
              />
            </FormField>

            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
              This entry updates goal progress only. It does not create a bank
              transaction or change any account balance.
            </p>

            <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setEntryGoal(null)
                  setError('')
                }}
                className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={entrySaving}
                className="rounded-xl bg-ledger-navy px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {entrySaving ? 'Saving...' : 'Save entry'}
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {/* DELETE GOAL CONFIRMATION */}
      {goalToDelete && (
        <ConfirmModal
          title="Delete this goal?"
          message={`"${goalToDelete.name}" and its manual contribution history will be deleted. This will not delete or change any linked bank account or journal transactions.`}
          confirmLabel="Delete goal"
          busy={deleting}
          onCancel={() => setGoalToDelete(null)}
          onConfirm={() => void handleDeleteGoal()}
        />
      )}

      {/* DELETE ENTRY CONFIRMATION */}
      {entryToDelete && (
        <ConfirmModal
          title="Delete this goal entry?"
          message="This will remove the selected manual contribution or withdrawal from goal progress. It will not affect bank balances."
          confirmLabel="Delete entry"
          busy={deleting}
          onCancel={() => setEntryToDelete(null)}
          onConfirm={() => void handleDeleteEntry()}
        />
      )}
    </div>
  )
}

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100'

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
  icon: LucideIcon
  tone: 'blue' | 'green' | 'amber' | 'purple'
}) {
  const tones = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    purple: 'bg-violet-50 text-violet-700',
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">{label}</p>
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${tones[tone]}`}>
          <Icon size={20} />
        </div>
      </div>
      <p className="mt-4 break-words text-2xl font-bold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  )
}

function GoalCard({
  item,
  onEdit,
  onDelete,
  onAddContribution,
  onAddWithdrawal,
  onStatusChange,
}: {
  item: GoalView
  onEdit: () => void
  onDelete: () => void
  onAddContribution: () => void
  onAddWithdrawal: () => void
  onStatusChange: (status: GoalStatus) => void
}) {
  const { goal, targetMinor, savedMinor, remainingMinor, percentage, accountName, entryCount, monthlyRequiredMinor, behindSchedule } = item
  const days = daysUntil(goal.target_date)
  const progressWidth = Math.min(100, Math.max(0, percentage))
  const canRecord = goal.tracking_mode === 'manual' && (goal.status === 'active' || goal.status === 'paused')
  const [whatIfOpen, setWhatIfOpen] = useState(false)
  const [whatIfMonthly, setWhatIfMonthly] = useState(monthlyRequiredMinor ? (monthlyRequiredMinor / 100).toFixed(2) : '')
  const whatIfMinor = parseAmountToMinor(whatIfMonthly)
  const projectedMonths = whatIfMinor && remainingMinor > 0 ? Math.ceil(remainingMinor / whatIfMinor) : null
  const projectedDate = projectedMonths ? new Date(new Date().getFullYear(), new Date().getMonth() + projectedMonths, 1).toLocaleDateString('en-BD', { month: 'long', year: 'numeric' }) : null

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-ledger-navy">
            <Target size={23} />
          </div>
          <div className="min-w-0">
            <h4 className="break-words text-base font-bold text-slate-900">{goal.name}</h4>
            {goal.description && (
              <p className="mt-1 line-clamp-2 text-sm text-slate-500">{goal.description}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusClasses(goal.status)}`}>
                {statusLabel(goal.status)}
              </span>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${priorityClasses(goal.priority)}`}>
                {goal.priority} priority
              </span>
              {behindSchedule && <span title="Based on a straight-line progress estimate between the start date and target date." className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">Behind schedule</span>}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={onEdit}
            title="Edit goal"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <Edit3 size={16} />
          </button>
          <button
            onClick={onDelete}
            title="Delete goal"
            className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-slate-500">Saved so far</p>
          <p className="mt-1 break-words text-lg font-bold text-slate-900">{formatBDT(savedMinor)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">Target amount</p>
          <p className="mt-1 break-words text-lg font-bold text-slate-900">{formatBDT(targetMinor)}</p>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-3 text-xs">
          <span className="font-semibold text-slate-700">{percentage.toFixed(1)}% completed</span>
          <span className={remainingMinor <= 0 ? 'font-semibold text-emerald-700' : 'text-slate-500'}>
            {remainingMinor <= 0 ? 'Target reached' : `${formatBDT(remainingMinor)} remaining`}
          </span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-all ${getProgressColor(percentage)}`}
            style={{ width: `${progressWidth}%` }}
          />
        </div>
      </div>

      {monthlyRequiredMinor !== null && remainingMinor > 0 && (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2.5">
          <p className="text-[11px] text-slate-500">Straight-line monthly estimate; excludes interest and returns</p>
          <p className="mt-1 text-sm font-semibold text-slate-800">{formatBDT(monthlyRequiredMinor)} / month</p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          {goal.tracking_mode === 'linked_account' ? <Wallet size={14} /> : <CircleDollarSign size={14} />}
          {goal.tracking_mode === 'linked_account'
            ? `Linked: ${accountName || 'Account'}`
            : `${entryCount} manual ${entryCount === 1 ? 'entry' : 'entries'}`}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays size={14} />
          {goal.target_date
            ? days !== null && days < 0
              ? `${Math.abs(days)} days overdue`
              : days === 0
                ? 'Due today'
                : `${days} days left`
            : 'No deadline'}
        </span>
      </div>

      <div className="mt-4">
        <button type="button" onClick={() => setWhatIfOpen(value => !value)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Target size={14}/>{whatIfOpen ? 'Close what-if' : 'What if I save more?'}</button>
        {whatIfOpen && <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3.5">
          <label className="block text-xs font-semibold text-slate-700">Monthly contribution (BDT)<input type="number" min="0.01" step="0.01" value={whatIfMonthly} onChange={event => setWhatIfMonthly(event.target.value)} placeholder="e.g. 5000" className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-300"/></label>
          {remainingMinor <= 0 ? <p className="mt-2 text-xs font-medium text-emerald-700">This goal has already reached its target.</p> : projectedDate ? <p className="mt-2 text-xs leading-5 text-slate-700">At {formatBDT(whatIfMinor || 0)} per month, you could reach this target in approximately <strong>{projectedMonths} months</strong> — around <strong>{projectedDate}</strong>. This is a simple estimate and does not include interest or investment returns.</p> : <p className="mt-2 text-xs text-slate-500">Enter a monthly contribution to estimate when you may reach this goal.</p>}
        </div>}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
        {canRecord && (
          <>
            <button
              onClick={onAddContribution}
              className="inline-flex items-center gap-1.5 rounded-lg bg-ledger-navy px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700"
            >
              <ArrowUpRight size={14} />
              Add contribution
            </button>
            <button
              onClick={onAddWithdrawal}
              disabled={savedMinor <= 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowDownRight size={14} />
              Withdraw
            </button>
          </>
        )}

        <div className="ml-auto">
          <select
            aria-label={`Change status for ${goal.name}`}
            value={goal.status}
            onChange={event => onStatusChange(event.target.value as GoalStatus)}
            className="max-w-[135px] rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-600 outline-none focus:border-blue-400"
          >
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>
    </article>
  )
}

function FormField({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium text-slate-700">
        {label}{required ? <span className="ml-1 text-red-500">*</span> : null}
      </span>
      {children}
    </label>
  )
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

function ModalShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string
  subtitle: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4">
      <div className="my-8 w-full max-w-xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">{title}</h3>
            <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[calc(100vh-12rem)] overflow-y-auto p-5">
          {children}
        </div>
      </div>
    </div>
  )
}

function ConfirmModal({
  title,
  message,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string
  message: string
  confirmLabel: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 text-red-600">
          <AlertCircle size={22} />
        </div>
        <h3 className="text-lg font-bold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">{message}</p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? 'Deleting...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
