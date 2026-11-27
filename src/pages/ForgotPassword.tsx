
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Mail } from 'lucide-react'

import AuthLayout from './AuthLayout'
import { useAuth } from '../context/AuthContext'

export default function ForgotPassword() {
  const { resetPassword } = useAuth()

  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    setError('')
    setLoading(true)

    try {
      const { error } = await resetPassword(email.trim())

      if (error) {
        setError(error.message)
      } else {
        setSuccess(true)
      }
    } catch {
      setError('Unable to send the recovery email. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Forgot password?"
      description="Enter your registered email address to receive a password recovery link."
    >
      {success ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-700">
          If an account exists for this email, a password recovery link has been sent. Please check your inbox and spam folder.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Email address
            </label>

            <div className="flex items-center rounded-xl border border-slate-200 px-3">
              <Mail size={18} className="text-slate-400" />

              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-transparent px-3 py-3 text-sm outline-none"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-ledger-navy py-3.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
          >
            {loading ? 'Sending...' : 'Send Recovery Link'}
          </button>
        </form>
      )}

      <div className="mt-6 border-t border-slate-100 pt-5 text-center">
        <Link
          to="/login"
          className="text-sm font-semibold text-ledger-navy hover:underline"
        >
          Back to Login
        </Link>
      </div>
    </AuthLayout>
  )
}
