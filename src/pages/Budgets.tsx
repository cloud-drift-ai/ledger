import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Edit3,
  Plus,
  RefreshCw,
  Target,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'

import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatBDTMinor } from '../lib/preferences'

type ExpenseCategory = {
  id: string
  name: string
  is_active: boolean
}

type CategoryBudget = {
  id: string
  expense_category_id: string
  month_start: string
  budget_amount_minor: number | string
  notes: string | null
  created_at: string
  updated_at: string
}

type JournalEntry = {
  id: string
  entry_date: string
}

type JournalLine = {
  journal_entry_id: string
  ledger_account_id: string
  debit_minor: number | string
  credit_minor: number | string
}

type BudgetRow = {
  budget: CategoryBudget
  categoryName: string
  categoryActive: boolean
  budgetMinor: number
  spentMinor: number
  remainingMinor: number
  percentage: number
}

const PAGE_SIZE = 500
const LINE_BATCH_SIZE = 200

function getLocalMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function addMonths(month: string, amount: number) {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(year, monthNumber - 1 + amount, 1)

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthStart(month: string) {
  return `${month}-01`
}

function formatMonth(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(year, monthNumber - 1, 1).toLocaleDateString('en-BD', {
    month: 'long',
    year: 'numeric',
  })
}

function formatBDT(minor: number) {
  return formatBDTMinor(minor)
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

function getProgressTone(percentage: number, timeProgress: number) {
  if (percentage >= 100) return { bar: 'bg-red-500', text: 'text-red-700', badge: 'bg-red-50 text-red-700', label: 'Over budget' }
  if (timeProgress > 0 && percentage > timeProgress + 10) return { bar: 'bg-amber-500', text: 'text-amber-700', badge: 'bg-amber-50 text-amber-700', label: 'Spending faster than planned' }
  return { bar: 'bg-emerald-500', text: 'text-emerald-700', badge: 'bg-emerald-50 text-emerald-700', label: 'On pace' }
}

export default function Budgets() {
  const { user } = useAuth()

  const [selectedMonth, setSelectedMonth] = useState(getLocalMonth)
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [budgets, setBudgets] = useState<CategoryBudget[]>([])
  const [spendingByCategory, setSpendingByCategory] = useState<Map<string, number>>(
    () => new Map()
  )

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [editingBudget, setEditingBudget] = useState<CategoryBudget | null>(null)
  const [formCategoryId, setFormCategoryId] = useState('')
  const [formAmount, setFormAmount] = useState('')
  const [formNotes, setFormNotes] = useState('')

  const [budgetToDelete, setBudgetToDelete] = useState<CategoryBudget | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadData = useCallback(async () => {
    if (!user?.id) {
      setCategories([])
      setBudgets([])
      setSpendingByCategory(new Map())
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')

    try {
      const startDate = monthStart(selectedMonth)
      const nextDate = monthStart(addMonths(selectedMonth, 1))

      const [categoryResult, budgetResult] = await Promise.all([
        supabase
          .from('ledger_accounts')
          .select('id, name, is_active')
          .eq('account_kind', 'category')
          .eq('account_type', 'expense')
          .order('name', { ascending: true }),

        supabase
          .from('category_budgets')
          .select('id, expense_category_id, month_start, budget_amount_minor, notes, created_at, updated_at')
          .eq('month_start', startDate)
          .order('created_at', { ascending: true }),
      ])

      if (categoryResult.error) throw categoryResult.error
      if (budgetResult.error) throw budgetResult.error

      const categoryList = (categoryResult.data || []) as ExpenseCategory[]
      const budgetList = (budgetResult.data || []) as CategoryBudget[]

      setCategories(categoryList)
      setBudgets(budgetList)

      const categoryMap = new Map(categoryList.map(category => [category.id, category]))
      const entries: JournalEntry[] = []

      // Fetch all posted journal entries for the selected month in pages.
      // We inspect their expense-category journal lines rather than relying
      // only on transaction_type, so expense fees recorded inside other
      // transaction types are included as well.
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error: entryError } = await supabase
          .from('journal_entries')
          .select('id, entry_date')
          .eq('status', 'posted')
          .gte('entry_date', startDate)
          .lt('entry_date', nextDate)
          .order('entry_date', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1)

        if (entryError) throw entryError

        const batch = (data || []) as JournalEntry[]
        entries.push(...batch)

        if (batch.length < PAGE_SIZE) break
      }

      const actuals = new Map<string, number>()
      const entryIds = entries.map(entry => entry.id)

      // Keep each IN filter small enough for PostgREST request URLs.
      for (let offset = 0; offset < entryIds.length; offset += LINE_BATCH_SIZE) {
        const idBatch = entryIds.slice(offset, offset + LINE_BATCH_SIZE)

        const { data, error: lineError } = await supabase
          .from('journal_lines')
          .select('journal_entry_id, ledger_account_id, debit_minor, credit_minor')
          .in('journal_entry_id', idBatch)

        if (lineError) throw lineError

        for (const line of (data || []) as JournalLine[]) {
          const category = categoryMap.get(line.ledger_account_id)
          if (!category) continue

          const netExpense =
            Number(line.debit_minor || 0) - Number(line.credit_minor || 0)

          actuals.set(
            line.ledger_account_id,
            (actuals.get(line.ledger_account_id) || 0) + netExpense
          )
        }
      }

      setSpendingByCategory(actuals)
    } catch (err) {
      console.error('Budget loading error:', err)
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load budgets and spending.'
      )
    } finally {
      setLoading(false)
    }
  }, [selectedMonth, user?.id])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const categoryMap = useMemo(
    () => new Map(categories.map(category => [category.id, category])),
    [categories]
  )

  const budgetRows = useMemo<BudgetRow[]>(() => {
    return budgets
      .map(budget => {
        const category = categoryMap.get(budget.expense_category_id)
        const budgetMinor = Number(budget.budget_amount_minor)
        const spentMinor = spendingByCategory.get(budget.expense_category_id) || 0
        const percentage = budgetMinor > 0
          ? Math.max(0, (spentMinor / budgetMinor) * 100)
          : 0

        return {
          budget,
          categoryName: category?.name || 'Unavailable category',
          categoryActive: category?.is_active ?? false,
          budgetMinor,
          spentMinor,
          remainingMinor: budgetMinor - spentMinor,
          percentage,
        }
      })
      .sort((a, b) => b.percentage - a.percentage || a.categoryName.localeCompare(b.categoryName))
  }, [budgets, categoryMap, spendingByCategory])

  const totalBudgetMinor = budgetRows.reduce((sum, row) => sum + row.budgetMinor, 0)
  const budgetedSpendingMinor = budgetRows.reduce((sum, row) => sum + row.spentMinor, 0)
  const remainingMinor = totalBudgetMinor - budgetedSpendingMinor
  const totalMonthlySpendingMinor = Array.from(spendingByCategory.values())
    .reduce((sum, amount) => sum + amount, 0)
  const utilization = totalBudgetMinor > 0
    ? Math.max(0, (budgetedSpendingMinor / totalBudgetMinor) * 100)
    : 0

  const [budgetYear, budgetMonthNumber] = selectedMonth.split('-').map(Number)
  const daysInSelectedMonth = new Date(budgetYear, budgetMonthNumber, 0).getDate()
  const today = new Date()
  const currentMonthKey = getLocalMonth()
  const timeProgress = selectedMonth < currentMonthKey
    ? 100
    : selectedMonth > currentMonthKey
      ? 0
      : Math.min(100, (today.getDate() / daysInSelectedMonth) * 100)
  const expectedSpendByToday = totalBudgetMinor * (timeProgress / 100)
  const paceDifference = budgetedSpendingMinor - expectedSpendByToday
  const overallPaceLabel = utilization >= 100
    ? 'Over budget'
    : timeProgress === 0
      ? 'Future budget period'
      : utilization > timeProgress + 10
        ? 'Spending faster than planned'
        : 'On pace'

  const budgetedCategoryIds = new Set(budgets.map(budget => budget.expense_category_id))
  const unbudgetedRows = categories
    .filter(category => !budgetedCategoryIds.has(category.id))
    .map(category => ({
      ...category,
      spentMinor: spendingByCategory.get(category.id) || 0,
    }))
    .filter(category => category.spentMinor > 0)
    .sort((a, b) => b.spentMinor - a.spentMinor)

  const availableCategories = categories.filter(category =>
    category.is_active &&
    (!budgetedCategoryIds.has(category.id) ||
      category.id === editingBudget?.expense_category_id)
  )

  const openAddForm = () => {
    setEditingBudget(null)
    setFormCategoryId(availableCategories[0]?.id || '')
    setFormAmount('')
    setFormNotes('')
    setError('')
    setSuccess('')
    setShowForm(true)
  }

  const openEditForm = (budget: CategoryBudget) => {
    setEditingBudget(budget)
    setFormCategoryId(budget.expense_category_id)
    setFormAmount((Number(budget.budget_amount_minor) / 100).toFixed(2))
    setFormNotes(budget.notes || '')
    setError('')
    setSuccess('')
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingBudget(null)
    setError('')
  }

  const handleSaveBudget = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setSuccess('')

    if (!user?.id) {
      setError('Your session has expired. Please sign in again.')
      return
    }

    if (!formCategoryId) {
      setError('Please select an expense category.')
      return
    }

    const amountMinor = parseAmountToMinor(formAmount)
    if (amountMinor === null) {
      setError('Enter a valid budget amount greater than zero, with up to two decimal places.')
      return
    }

    const duplicate = budgets.find(budget =>
      budget.expense_category_id === formCategoryId &&
      budget.id !== editingBudget?.id
    )

    if (duplicate) {
      setError('A budget already exists for this category in the selected month. Edit the existing budget instead.')
      return
    }

    setSaving(true)

    try {
      const payload = {
        expense_category_id: formCategoryId,
        month_start: monthStart(selectedMonth),
        budget_amount_minor: amountMinor,
        notes: formNotes.trim() || null,
      }

      if (editingBudget) {
        const { error: updateError } = await supabase
          .from('category_budgets')
          .update(payload)
          .eq('id', editingBudget.id)

        if (updateError) throw updateError
        setSuccess('Budget updated successfully.')
      } else {
        const { error: insertError } = await supabase
          .from('category_budgets')
          .insert({
            ...payload,
            user_id: user.id,
          })

        if (insertError) throw insertError
        setSuccess('Budget created successfully.')
      }

      setShowForm(false)
      setEditingBudget(null)
      await loadData()
    } catch (err) {
      console.error('Budget save error:', err)
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to save this budget.'
      )
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteBudget = async () => {
    if (!budgetToDelete) return

    setDeleting(true)
    setError('')
    setSuccess('')

    try {
      const { error: deleteError } = await supabase
        .from('category_budgets')
        .delete()
        .eq('id', budgetToDelete.id)

      if (deleteError) throw deleteError

      setBudgetToDelete(null)
      setSuccess('Budget deleted. Your transactions have not been changed.')
      await loadData()
    } catch (err) {
      console.error('Budget delete error:', err)
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to delete this budget.'
      )
    } finally {
      setDeleting(false)
    }
  }

  const goToPreviousMonth = () => setSelectedMonth(month => addMonths(month, -1))
  const goToNextMonth = () => setSelectedMonth(month => addMonths(month, 1))
  const isCurrentMonth = selectedMonth === getLocalMonth()

  return (
    <div className="space-y-6">
      {/* Page heading and month selector */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-ledger-navy">
            <Target size={17} />
            Personal budget planning
          </div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
            Budgets
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Plan your spending and keep track of expenses by category.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={goToPreviousMonth}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              aria-label="Previous month"
            >
              <ChevronLeft size={19} />
            </button>
            <div className="flex min-w-[145px] items-center justify-center gap-2 px-2 text-sm font-semibold text-slate-700">
              <CalendarDays size={16} className="text-slate-400" />
              {formatMonth(selectedMonth)}
            </div>
            <button
              type="button"
              onClick={goToNextMonth}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              aria-label="Next month"
            >
              <ChevronRight size={19} />
            </button>
          </div>

          {!isCurrentMonth && (
            <button
              type="button"
              onClick={() => setSelectedMonth(getLocalMonth())}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              This month
            </button>
          )}

          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-50"
            aria-label="Refresh budgets"
            title="Refresh"
          >
            <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
          </button>

          <button
            type="button"
            onClick={openAddForm}
            disabled={availableCategories.length === 0}
            className="flex items-center gap-2 rounded-xl bg-ledger-navy px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={17} />
            Add Budget
          </button>
        </div>
      </div>

      {error && !showForm && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
          <span>{success}</span>
          <button
            type="button"
            onClick={() => setSuccess('')}
            className="ml-auto rounded p-0.5 hover:bg-emerald-100"
            aria-label="Dismiss message"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-500">Total budget</p>
            <div className="rounded-xl bg-blue-50 p-2.5 text-blue-700">
              <Wallet size={19} />
            </div>
          </div>
          <p className="mt-4 text-2xl font-bold tracking-tight text-slate-900">
            {formatBDT(totalBudgetMinor)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Across {budgetRows.length} budget {budgetRows.length === 1 ? 'category' : 'categories'}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-500">Spent in budgeted categories</p>
            <div className="rounded-xl bg-amber-50 p-2.5 text-amber-700">
              <ArrowUpRight size={19} />
            </div>
          </div>
          <p className="mt-4 text-2xl font-bold tracking-tight text-slate-900">
            {formatBDT(budgetedSpendingMinor)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {utilization.toFixed(1)}% of allocated budgets
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-500">Remaining budget</p>
            <div className={`rounded-xl p-2.5 ${remainingMinor < 0 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
              <CircleDollarSign size={19} />
            </div>
          </div>
          <p className={`mt-4 text-2xl font-bold tracking-tight ${remainingMinor < 0 ? 'text-red-700' : 'text-slate-900'}`}>
            {formatBDT(remainingMinor)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {remainingMinor < 0 ? 'Amount over your allocated budgets' : 'Available across budgeted categories'}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-500">Total monthly expenses</p>
            <div className="rounded-xl bg-violet-50 p-2.5 text-violet-700">
              <ArrowDownRight size={19} />
            </div>
          </div>
          <p className="mt-4 text-2xl font-bold tracking-tight text-slate-900">
            {formatBDT(totalMonthlySpendingMinor)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            All posted expense-category journal lines
          </p>
        </div>
      </div>

      {/* Overall progress */}
      {budgetRows.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-slate-800">Overall budget usage</h2>
              <p className="mt-1 text-xs text-slate-500">
                Spending across categories with a budget for {formatMonth(selectedMonth)}.
              </p>
            </div>
            <p className={`text-lg font-bold ${utilization >= 100 ? 'text-red-700' : utilization >= 80 ? 'text-amber-700' : 'text-emerald-700'}`}>
              {utilization.toFixed(1)}%
            </p>
          </div>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full transition-all ${utilization >= 100 ? 'bg-red-500' : utilization >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${Math.min(utilization, 100)}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-slate-400">
            <span>{formatBDT(budgetedSpendingMinor)} spent</span>
            <span>{formatBDT(totalBudgetMinor)} budgeted</span>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-4 py-3">
            <div><p className="text-xs font-semibold text-slate-700">Spending pace: {overallPaceLabel}</p><p className="mt-1 text-[11px] text-slate-500">{timeProgress.toFixed(0)}% of the month elapsed · Linear pace benchmark {formatBDT(expectedSpendByToday)}</p></div>
            {timeProgress > 0 && <span className={`text-xs font-semibold ${paceDifference > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{paceDifference > 0 ? `${formatBDT(paceDifference)} ahead of pace` : `${formatBDT(Math.abs(paceDifference))} below pace`}</span>}
          </div>
        </div>
      )}

      {/* Budget list */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Category budgets</h2>
            <p className="mt-1 text-xs text-slate-500">
              Compare your planned amount with actual posted expenses.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {budgetRows.length} {budgetRows.length === 1 ? 'budget' : 'budgets'}
          </span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-sm text-slate-500">
            Loading budgets and expenses...
          </div>
        ) : budgetRows.length === 0 ? (
          <div className="p-10 text-center sm:p-14">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-ledger-navy">
              <Target size={28} />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-slate-800">
              No budgets for {formatMonth(selectedMonth)}
            </h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
              Create a budget for categories such as groceries, transport, bills or dining. Ledger will automatically compare it with your posted expenses.
            </p>
            {availableCategories.length > 0 ? (
              <button
                type="button"
                onClick={openAddForm}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-ledger-navy px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700"
              >
                <Plus size={17} />
                Create your first budget
              </button>
            ) : (
              <p className="mt-5 text-sm text-amber-700">
                Create an active expense category in Accounts before adding a budget.
              </p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {budgetRows.map(row => {
              const tone = getProgressTone(row.percentage, timeProgress)
              const progressWidth = Math.min(row.percentage, 100)

              return (
                <div key={row.budget.id} className="p-5 transition hover:bg-slate-50/60">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-slate-800">{row.categoryName}</h3>
                        {!row.categoryActive && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                            Archived category
                          </span>
                        )}
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${tone.badge}`}>
                          {tone.label}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                        <span className="font-semibold text-slate-800">{formatBDT(row.spentMinor)}</span>
                        <span className="text-slate-400">of {formatBDT(row.budgetMinor)}</span>
                        <span className={`text-xs font-semibold ${tone.text}`}>
                          {row.percentage.toFixed(1)}% used
                        </span>
                      </div>
                      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full transition-all ${tone.bar}`}
                          style={{ width: `${progressWidth}%` }}
                        />
                      </div>
                      <p className={`mt-2 text-xs ${row.remainingMinor < 0 ? 'font-semibold text-red-700' : 'text-slate-500'}`}>
                        {row.remainingMinor < 0
                          ? `${formatBDT(Math.abs(row.remainingMinor))} over budget`
                          : `${formatBDT(row.remainingMinor)} remaining · ${timeProgress > 0 && row.percentage > timeProgress + 10 ? 'ahead of linear pace' : 'within linear pace'}`}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2 lg:justify-end">
                      <button
                        type="button"
                        onClick={() => openEditForm(row.budget)}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:border-slate-300 hover:bg-white"
                      >
                        <Edit3 size={15} />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setBudgetToDelete(row.budget)}
                        className="rounded-lg border border-slate-200 p-2 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                        aria-label={`Delete ${row.categoryName} budget`}
                        title="Delete budget"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Spending without a budget */}
      {!loading && unbudgetedRows.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm">
          <div className="flex items-start gap-3 border-b border-amber-100 bg-amber-50/70 p-5">
            <div className="rounded-xl bg-white p-2 text-amber-700 shadow-sm">
              <AlertTriangle size={19} />
            </div>
            <div>
              <h2 className="font-semibold text-slate-800">Spending without a budget</h2>
              <p className="mt-1 text-xs text-slate-600">
                These categories have posted expenses but no budget for {formatMonth(selectedMonth)}.
              </p>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {unbudgetedRows.map(category => (
              <div key={category.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div>
                  <p className="text-sm font-semibold text-slate-700">{category.name}</p>
                  <p className="mt-0.5 text-xs text-slate-400">No budget allocated</p>
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-sm font-semibold text-slate-800">{formatBDT(category.spentMinor)}</p>
                  {category.is_active && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingBudget(null)
                        setFormCategoryId(category.id)
                        setFormAmount('')
                        setFormNotes('')
                        setError('')
                        setShowForm(true)
                      }}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-ledger-navy hover:bg-slate-50"
                    >
                      Set budget
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add / edit budget modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="budget-form-title"
            className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
          >
            <div className="mb-6 flex items-start justify-between gap-3">
              <div>
                <h2 id="budget-form-title" className="text-xl font-bold text-slate-800">
                  {editingBudget ? 'Edit budget' : 'Create a budget'}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Set a spending limit for {formatMonth(selectedMonth)}.
                </p>
              </div>
              <button
                type="button"
                onClick={closeForm}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
                aria-label="Close budget form"
              >
                <X size={20} />
              </button>
            </div>

            {error && (
              <div role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={handleSaveBudget} className="space-y-4">
              <div>
                <label htmlFor="budget-category" className="mb-2 block text-sm font-medium text-slate-700">
                  Expense category
                </label>
                <select
                  id="budget-category"
                  required
                  value={formCategoryId}
                  onChange={event => setFormCategoryId(event.target.value)}
                  disabled={Boolean(editingBudget)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-ledger-navy disabled:bg-slate-50"
                >
                  <option value="">Select expense category</option>
                  {(editingBudget
                    ? categories.filter(category => category.id === editingBudget.expense_category_id)
                    : availableCategories
                  ).map(category => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                {editingBudget && (
                  <p className="mt-1 text-xs text-slate-400">
                    Category cannot be changed when editing an existing budget.
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="budget-amount" className="mb-2 block text-sm font-medium text-slate-700">
                  Monthly budget amount (BDT)
                </label>
                <div className="flex items-center rounded-xl border border-slate-200 px-4 focus-within:border-ledger-navy">
                  <span className="text-lg font-semibold text-slate-400">৳</span>
                  <input
                    id="budget-amount"
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    required
                    autoFocus
                    value={formAmount}
                    onChange={event => setFormAmount(event.target.value)}
                    placeholder="0.00"
                    className="w-full bg-transparent px-3 py-3 text-lg font-semibold outline-none"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="budget-notes" className="mb-2 block text-sm font-medium text-slate-700">
                  Notes <span className="font-normal text-slate-400">(Optional)</span>
                </label>
                <textarea
                  id="budget-notes"
                  rows={3}
                  maxLength={1000}
                  value={formNotes}
                  onChange={event => setFormNotes(event.target.value)}
                  placeholder="e.g. Includes weekly grocery shopping..."
                  className="w-full resize-y rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-ledger-navy"
                />
              </div>

              <div className="rounded-xl bg-blue-50 p-3 text-xs leading-5 text-blue-800">
                Ledger compares this limit with posted expenses assigned to the selected category. Creating or changing a budget does not create a financial transaction.
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeForm}
                  className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !formCategoryId}
                  className="flex-1 rounded-xl bg-ledger-navy py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingBudget ? 'Save changes' : 'Create budget'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {budgetToDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-budget-title"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-red-600">
              <Trash2 size={22} />
            </div>
            <h2 id="delete-budget-title" className="mt-4 text-lg font-bold text-slate-800">
              Delete this budget?
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              This will delete the {categoryMap.get(budgetToDelete.expense_category_id)?.name || 'selected category'} budget for {formatMonth(selectedMonth)}. Your existing transactions and account balances will remain unchanged.
            </p>
            {error && (
              <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setBudgetToDelete(null)}
                disabled={deleting}
                className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteBudget()}
                disabled={deleting}
                className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete budget'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
