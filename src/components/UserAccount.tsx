import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronUp, LogOut, Settings, UserRound } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

type UserAccountProps = {
  collapsed?: boolean
}

export default function UserAccount({ collapsed = false }: UserAccountProps) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const [menuOpen, setMenuOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fullName =
    user?.user_metadata?.full_name ||
    user?.email?.split('@')[0] ||
    'My account'

  const email = user?.email || ''
  const initials = fullName
    .split(' ')
    .filter(Boolean)
    .map((part: string) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const handleLogout = async () => {
    setLoading(true)
    setError('')

    try {
      const { error: signOutError } = await signOut()
      if (signOutError) {
        setError(signOutError.message)
        return
      }
      navigate('/login', { replace: true })
    } catch {
      setError('Unable to sign out. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative space-y-2">
      {menuOpen && (
        <>
          <button
            type="button"
            aria-label="Close profile menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setMenuOpen(false)}
          />
          <div className={`ledger-profile-popover absolute bottom-full z-50 mb-2 overflow-hidden rounded-xl border p-2 shadow-xl ${collapsed ? 'left-[58px] w-[225px]' : 'left-0 w-full min-w-[220px]'}`}>
            <div className="ledger-profile-popover-header border-b px-3 py-2.5">
              <p className="truncate text-[12px] font-semibold text-[#26364A]">{fullName}</p>
              <p className="mt-0.5 truncate text-[10px] text-[#8A96A8]">{email}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                navigate('/settings')
              }}
              className="ledger-profile-menu-item mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[11px] font-medium transition"
            >
              <Settings size={15} /> Account & appearance settings
            </button>
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={loading}
              className="ledger-profile-menu-item ledger-profile-signout flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[11px] font-medium transition disabled:opacity-50"
            >
              <LogOut size={15} /> {loading ? 'Signing out...' : 'Sign out'}
            </button>
          </div>
        </>
      )}

      <button
        type="button"
        onClick={() => setMenuOpen(value => !value)}
        aria-expanded={menuOpen}
        aria-label={`Profile menu for ${fullName}`}
        title={collapsed ? fullName : undefined}
        className={`ledger-profile-trigger sidebar-profile-button flex w-full items-center gap-2.5 rounded-xl border p-2.5 text-left transition ${collapsed ? 'justify-center' : ''}`}
      >
        <div className="ledger-profile-avatar flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold">
          {initials || <UserRound size={16} />}
        </div>
        <div className="sidebar-profile-details min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-[#26364A]">{fullName}</p>
          <p className="mt-0.5 truncate text-[10px] text-[#8A96A8]">{email || 'Personal account'}</p>
        </div>
        <ChevronUp size={15} className="sidebar-profile-chevron shrink-0 text-[#98A3B3]" />
      </button>

      {error && <p role="alert" className="px-1 text-[10px] text-red-600">{error}</p>}
    </div>
  )
}
