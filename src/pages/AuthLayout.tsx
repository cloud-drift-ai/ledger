
import type { ReactNode } from 'react'
import { Wallet } from 'lucide-react'

type AuthLayoutProps = {
  title: string
  description: string
  children: ReactNode
}

export default function AuthLayout({
  title,
  description,
  children,
}: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ledger-bg p-4">
      <div className="w-full max-w-md">

        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-ledger-navy text-white shadow-lg">
            <Wallet size={29} />
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-ledger-navy">
            Ledger
          </h1>

          <p className="mt-1 text-xs font-medium tracking-widest text-slate-500">
            PERSONAL FINANCE MANAGEMENT
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-slate-800">
              {title}
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              {description}
            </p>
          </div>

          {children}
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Ledger Personal Finance Management System
        </p>

      </div>
    </div>
  )
}
