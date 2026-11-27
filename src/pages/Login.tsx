
import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Mail, Lock } from 'lucide-react'

import AuthLayout from './AuthLayout'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { error } = await signIn(email.trim(), password)

      if (error) {
        setError(error.message)
        return
      }

      const destination = location.state?.from?.pathname || '/'
      navigate(destination, { replace: true })

    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      description="Sign in to access your personal financial dashboard."
    >
      <form onSubmit={handleSubmit} className="space-y-5">

        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">
            Email address
          </label>

          <div className="flex items-center rounded-xl border border-slate-200 px-3 focus-within:border-ledger-navy focus-within:ring-2 focus-within:ring-blue-100">
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
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-medium text-slate-700">
              Password
            </label>

            <Link
              to="/forgot-password"
              className="text-xs font-semibold text-ledger-navy hover:underline"
            >
              Forgot password?
            </Link>
          </div>

          <div className="flex items-center rounded-xl border border-slate-200 px-3 focus-within:border-ledger-navy focus-within:ring-2 focus-within:ring-blue-100">
            <Lock size={18} className="text-slate-400" />

            <input
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="w-full bg-transparent px-3 py-3 text-sm outline-none"
            />

            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="text-slate-400 hover:text-slate-700"
              aria-label="Toggle password visibility"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-ledger-navy py-3.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60"
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>

      </form>

      <div className="mt-6 border-t border-slate-100 pt-5 text-center">
        <p className="text-sm text-slate-500">
          Don't have an account?{' '}
          <Link
            to="/register"
            className="font-semibold text-ledger-navy hover:underline"
          >
            Create account
          </Link>
        </p>
      </div>
    </AuthLayout>
  )
}
