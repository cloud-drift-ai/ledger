import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  ArrowLeftRight,
  Building2,
  CalendarClock,
  Clock3,
  Search,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

type ResultKind = 'transaction' | 'account' | 'investment' | 'recurring'

type SearchResult = {
  id: string
  kind: ResultKind
  title: string
  subtitle: string
  date?: string | null
  href: string
}

const kindLabels: Record<ResultKind, string> = {
  transaction: 'Transaction',
  account: 'Account',
  investment: 'Investment',
  recurring: 'Recurring schedule',
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, character => `\\${character}`)
}

function resultIcon(kind: ResultKind) {
  if (kind === 'transaction') return ArrowLeftRight
  if (kind === 'account') return Wallet
  if (kind === 'investment') return TrendingUp
  return CalendarClock
}

export default function GlobalSearch({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults([])
    setError('')
    setActiveIndex(0)
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    const term = query.trim()
    if (!open || !user?.id || term.length < 2) {
      setResults([])
      setLoading(false)
      setError('')
      return
    }

    let current = true
    const timer = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      const pattern = `%${escapeLike(term)}%`

      try {
        const [
          accountResult,
          transactionDescriptionResult,
          transactionPayeeResult,
          investmentNameResult,
          investmentInstitutionResult,
          recurringNameResult,
          recurringDescriptionResult,
        ] = await Promise.all([
          supabase
            .from('ledger_accounts')
            .select('id, name, account_type, subtype')
            .eq('user_id', user.id)
            .eq('account_kind', 'financial')
            .eq('is_active', true)
            .ilike('name', pattern)
            .limit(5),
          supabase
            .from('journal_entries')
            .select('id, entry_date, transaction_type, description, payee')
            .eq('user_id', user.id)
            .eq('status', 'posted')
            .ilike('description', pattern)
            .order('entry_date', { ascending: false })
            .limit(5),
          supabase
            .from('journal_entries')
            .select('id, entry_date, transaction_type, description, payee')
            .eq('user_id', user.id)
            .eq('status', 'posted')
            .ilike('payee', pattern)
            .order('entry_date', { ascending: false })
            .limit(5),
          supabase
            .from('investment_instruments')
            .select('id, name, institution, instrument_type')
            .eq('user_id', user.id)
            .eq('is_active', true)
            .ilike('name', pattern)
            .limit(5),
          supabase
            .from('investment_instruments')
            .select('id, name, institution, instrument_type')
            .eq('user_id', user.id)
            .eq('is_active', true)
            .ilike('institution', pattern)
            .limit(5),
          supabase
            .from('recurring_transactions')
            .select('id, name, description, transaction_type, next_due_date, status')
            .eq('user_id', user.id)
            .in('status', ['active', 'paused'])
            .ilike('name', pattern)
            .limit(5),
          supabase
            .from('recurring_transactions')
            .select('id, name, description, transaction_type, next_due_date, status')
            .eq('user_id', user.id)
            .in('status', ['active', 'paused'])
            .ilike('description', pattern)
            .limit(5),
        ])

        const firstError = [
          accountResult.error,
          transactionDescriptionResult.error,
          transactionPayeeResult.error,
          investmentNameResult.error,
          investmentInstitutionResult.error,
          recurringNameResult.error,
          recurringDescriptionResult.error,
        ].find(Boolean)

        if (firstError) throw firstError

        const nextResults: SearchResult[] = []
        const seen = new Set<string>()

        const add = (result: SearchResult) => {
          const key = `${result.kind}:${result.id}`
          if (seen.has(key)) return
          seen.add(key)
          nextResults.push(result)
        }

        for (const row of accountResult.data || []) {
          add({
            id: row.id,
            kind: 'account',
            title: row.name,
            subtitle: `${row.account_type} account${row.subtype ? ` · ${row.subtype.replaceAll('_', ' ')}` : ''}`,
            href: `/accounts?search=${encodeURIComponent(row.name)}`,
          })
        }

        for (const row of [
          ...(transactionDescriptionResult.data || []),
          ...(transactionPayeeResult.data || []),
        ]) {
          add({
            id: row.id,
            kind: 'transaction',
            title: row.description || row.payee || 'Untitled transaction',
            subtitle: `${row.transaction_type} · ${row.payee || 'No payee'}`,
            date: row.entry_date,
            href: `/transactions?search=${encodeURIComponent(term)}`,
          })
        }

        for (const row of [
          ...(investmentNameResult.data || []),
          ...(investmentInstitutionResult.data || []),
        ]) {
          add({
            id: row.id,
            kind: 'investment',
            title: row.name,
            subtitle: `${row.instrument_type.replaceAll('_', ' ')}${row.institution ? ` · ${row.institution}` : ''}`,
            href: `/investments?search=${encodeURIComponent(term)}`,
          })
        }

        for (const row of [
          ...(recurringNameResult.data || []),
          ...(recurringDescriptionResult.data || []),
        ]) {
          add({
            id: row.id,
            kind: 'recurring',
            title: row.name,
            subtitle: `${row.transaction_type} · ${row.status} · due ${row.next_due_date}`,
            date: row.next_due_date,
            href: `/recurring?search=${encodeURIComponent(term)}`,
          })
        }

        if (current) {
          setResults(nextResults.slice(0, 20))
          setActiveIndex(0)
        }
      } catch (searchError) {
        console.error('Global search error:', searchError)
        if (current) {
          setResults([])
          setError(searchError instanceof Error ? searchError.message : 'Unable to search Ledger right now.')
        }
      } finally {
        if (current) setLoading(false)
      }
    }, 220)

    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [open, query, user?.id])

  const openResult = (result: SearchResult) => {
    navigate(result.href)
    onClose()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (results.length) setActiveIndex(index => Math.min(index + 1, results.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (results.length) setActiveIndex(index => Math.max(index - 1, 0))
    } else if (event.key === 'Enter' && results[activeIndex]) {
      event.preventDefault()
      openResult(results[activeIndex])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-slate-950/45 px-3 pt-[10vh] backdrop-blur-[3px] sm:px-6"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Search Ledger"
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-[var(--ledger-border)] bg-[var(--ledger-surface)] shadow-[0_28px_90px_rgba(2,8,23,0.28)]"
      >
        <div className="flex items-center gap-3 border-b border-[var(--ledger-border)] px-4">
          <Search size={19} className="shrink-0 text-[var(--ledger-muted)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search transactions, accounts, investments, recurring..."
            className="h-14 min-w-0 flex-1 bg-transparent text-sm text-[var(--ledger-text)] outline-none placeholder:text-[var(--ledger-muted)]"
          />
          {loading && <span className="text-xs text-[var(--ledger-muted)]">Searching…</span>}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="rounded-lg p-2 text-[var(--ledger-muted)] transition hover:bg-[var(--ledger-surface-muted)]"
          >
            <X size={17} />
          </button>
        </div>

        <div className="max-h-[min(60vh,520px)] overflow-y-auto p-2">
          {query.trim().length < 2 ? (
            <div className="px-4 py-9 text-center">
              <Search size={25} className="mx-auto text-[var(--ledger-muted)]" />
              <p className="mt-3 text-sm font-semibold text-[var(--ledger-heading)]">Search across your Ledger</p>
              <p className="mt-1 text-xs text-[var(--ledger-muted)]">Enter at least two characters to find transactions, accounts, investments and recurring schedules.</p>
            </div>
          ) : error ? (
            <div className="px-4 py-9 text-center text-sm text-rose-600">{error}</div>
          ) : loading && results.length === 0 ? (
            <div className="px-4 py-9 text-center text-sm text-[var(--ledger-muted)]">Searching your records…</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-9 text-center">
              <Search size={25} className="mx-auto text-[var(--ledger-muted)]" />
              <p className="mt-3 text-sm font-semibold text-[var(--ledger-heading)]">No matching records</p>
              <p className="mt-1 text-xs text-[var(--ledger-muted)]">Try another name, description or institution.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {results.map((result, index) => {
                const Icon = resultIcon(result.kind)
                return (
                  <button
                    key={`${result.kind}:${result.id}`}
                    type="button"
                    onClick={() => openResult(result)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
                      index === activeIndex
                        ? 'bg-[var(--ledger-accent-soft)]'
                        : 'hover:bg-[var(--ledger-surface-muted)]'
                    }`}
                  >
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                      style={{ background: 'var(--ledger-accent-soft)', color: 'var(--ledger-accent)' }}
                    >
                      <Icon size={17} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-[var(--ledger-heading)]">{result.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-[var(--ledger-muted)]">{result.subtitle}</span>
                    </span>
                    <span className="hidden shrink-0 items-center gap-1 text-[10px] text-[var(--ledger-muted)] sm:flex">
                      {result.date && <><Clock3 size={11}/>{result.date}</>}
                      <span className="ml-2 rounded-md border border-[var(--ledger-border)] px-1.5 py-1">{kindLabels[result.kind]}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ledger-border)] px-4 py-3 text-[10px] text-[var(--ledger-muted)]">
          <span>↑ ↓ to navigate · Enter to open · Esc to close</span>
          <span className="inline-flex items-center gap-1"><Building2 size={12}/> Private to your account</span>
        </div>
      </section>
    </div>
  )
}
