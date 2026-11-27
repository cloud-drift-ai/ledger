
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, User, Mail, Lock } from 'lucide-react'

import AuthLayout from './AuthLayout'
import { useAuth } from '../context/AuthContext'

export default function Register() {
  const { signUp } = useAuth()
  const navigate = useNavigate()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    setError('')
    setSuccess('')

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
      const result = await signUp(
        fullName.trim(),
        email.trim(),
        password
      )

      if (result.error) {
        setError(result.error.message)
        return
      }

      if (result.needsEmailConfirmation) {
        setSuccess(
          'Your account has been created. Please check your email and verify your account before signing in.'
        )
      } else {
        navigate('/', { replace: true })
      }

    } catch {
      setError('Registration failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      description="Start managing your personal finances with Ledger."
    >
      <form onSubmit={handleSubmit} className="space-y-4">

        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {success && (
          <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
            {success}
            <div className="mt-3">
              <Link to="/login" className="font-semibold underline">
                Go to Login
              </Link>
            </div>
          </div>
        )}

        {!success && (
          <>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Full name
              </label>

              <div className="flex items-center rounded-xl border border-slate-200 px-3 focus-within:border-ledger-navy">
                <User size={18} className="text-slate-400" />

                <input
                  type="text"
                  required
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your full name"
                  className="w-full bg-transparent px-3 py-3 text-sm outline-none"
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Email address
              </label>

              <div className="flex items-center rounded-xl border border-slate-200 px-3 focus-within:border-ledger-navy">
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

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Password
              </label>

              <div className="flex items-center rounded-xl border border-slate-200 px-3 focus-within:border-ledger-navy">
                <Lock size={18} className="text-slate-400" />

                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className="w-full bg-transparent px-3 py-3 text-sm outline-none"
                />

                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-slate-400"
                  aria-label="Toggle password visibility"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Confirm password
              </label>

              <div className="flex items-center rounded-xl border border-slate-200 px-3 focus-within:border-ledger-navy">
                <Lock size={18} className="text-slate-400" />

                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your password"
                  className="w-full bg-transparent px-3 py-3 text-sm outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-ledger-navy py-3.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60"
            >
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </>
        )}
      </form>

      <div className="mt-6 border-t border-slate-100 pt-5 text-center">
        <p className="text-sm text-slate-500">
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-semibold text-ledger-navy hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </AuthLayout>
  )
}
