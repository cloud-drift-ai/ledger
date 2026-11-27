
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

import type {
  User,
  AuthError,
} from '@supabase/supabase-js'

import { supabase } from '../lib/supabase'

type AuthContextType = {
  user: User | null
  loading: boolean

  signUp: (
    fullName: string,
    email: string,
    password: string
  ) => Promise<{
    error: AuthError | null
    needsEmailConfirmation: boolean
  }>

  signIn: (
    email: string,
    password: string
  ) => Promise<{
    error: AuthError | null
  }>

  signOut: () => Promise<{
    error: AuthError | null
  }>

  resetPassword: (
    email: string
  ) => Promise<{
    error: AuthError | null
  }>

  updatePassword: (
    password: string
  ) => Promise<{
    error: AuthError | null
  }>
}

const AuthContext = createContext<AuthContextType | undefined>(
  undefined
)

export function AuthProvider({
  children,
}: {
  children: ReactNode
}) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  // Restore session and listen for authentication changes

  useEffect(() => {
    let mounted = true

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (mounted) {
          setUser(session?.user ?? null)
          setLoading(false)
        }
      }
    )

    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return

      if (error) {
        console.error('Session restoration error:', error.message)
      }

      setUser(data.session?.user ?? null)
      setLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  // Registration

  const signUp = async (
    fullName: string,
    email: string,
    password: string
  ) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,

      options: {
        data: {
          full_name: fullName,
        },

        emailRedirectTo: `${window.location.origin}/login`,
      },
    })

    return {
      error,
      needsEmailConfirmation: !data.session && !error,
    }
  }

  // Login

  const signIn = async (
    email: string,
    password: string
  ) => {
    const { error } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      })

    return { error }
  }

  // Logout

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()

    return { error }
  }

  // Password recovery email

  const resetPassword = async (email: string) => {
    const { error } =
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })

    return { error }
  }

  // Update password

  const updatePassword = async (password: string) => {
    const { error } = await supabase.auth.updateUser({
      password,
    })

    return { error }
  }

  const value: AuthContextType = {
    user,
    loading,
    signUp,
    signIn,
    signOut,
    resetPassword,
    updatePassword,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

// Custom authentication hook

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error(
      'useAuth must be used inside AuthProvider'
    )
  }

  return context
}
