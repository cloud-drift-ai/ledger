
import { useState, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Lock } from 'lucide-react'

import AuthLayout from './AuthLayout'
import { useAuth } from '../context/AuthContext'

export default function ResetPassword() {
  const { updatePassword } = useAuth()
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must contain at least 8 characters.')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)

    try {
      const { error } = await updatePassword(password)

      if (error) {
        setError(error.message)
      } else {
        setSuccess(true)
      }
    } catch {
      setError('Unable to update your password. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Reset your password"
      description="Choose a new password for your Ledger account."
    >
      {success ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-700">
            Your password has been updated successfully.
          </div>

          <button
            onClick={() => navigate('/', { replace: true })}
            className="w-full rounded-xl bg-ledger-navy py-3 font-semibold text-white hover:bg-slate-700"
          >
            Continue to Ledger
          </button>
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
              New password
            </label>

            <div className="flex items-center rounded-xl border border-slate-200 px-3">
              <Lock size={18} className="text-slate-400" />

              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                className="w-full bg-transparent px-3 py-3 text-sm outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Confirm new password
            </label>

            <div className="flex items-center rounded-xl border border-slate-200 px-3">
              <Lock size={18} className="text-slate-400" />

              <input
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Enter password again"
                className="w-full bg-transparent px-3 py-3 text-sm outline-none"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-ledger-navy py-3.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
          >
            {loading ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      )}

      <div className="mt-6 text-center">
        <Link to="/login" className="text-sm font-semibold text-ledger-navy hover:underline">
          Back to Login
        </Link>
      </div>
    </AuthLayout>
  )
}
