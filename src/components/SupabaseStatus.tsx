import { useEffect, useState } from 'react'
import { Cloud, CloudOff, LoaderCircle, WifiOff } from 'lucide-react'
import { supabase } from '../lib/supabase'

type ConnectionStatus = 'checking' | 'connected' | 'error' | 'offline'

export default function SupabaseStatus() {
  const [status, setStatus] = useState<ConnectionStatus>(
    () => typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'checking'
  )

  useEffect(() => {
    let active = true

    async function checkConnection() {
      if (!navigator.onLine) {
        if (active) setStatus('offline')
        return
      }

      if (active) setStatus('checking')

      try {
        const { data, error } = await supabase.rpc('ledger_connection_check')

        if (!active) return

        if (error) {
          console.error('Supabase connection error:', error.message)
          setStatus('error')
        } else {
          console.log('Ledger database connected:', data)
          setStatus('connected')
        }
      } catch (error) {
        console.error('Connection failed:', error)
        if (active) setStatus(navigator.onLine ? 'error' : 'offline')
      }
    }

    const handleOnline = () => void checkConnection()
    const handleOffline = () => setStatus('offline')

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    void checkConnection()

    return () => {
      active = false
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const config = {
    checking: {
      label: 'Connecting',
      icon: LoaderCircle,
      style: 'border-[#E7EBF1] bg-white text-[#718096]',
      dot: 'bg-[#A0AAB8]',
      iconClass: 'animate-spin',
    },
    connected: {
      label: 'Cloud connected',
      icon: Cloud,
      style: 'border-[#D8F0E7] bg-[#F2FBF7] text-[#177A5D]',
      dot: 'bg-[#0B9B78]',
      iconClass: '',
    },
    error: {
      label: 'Connection error',
      icon: CloudOff,
      style: 'border-[#F4DADD] bg-[#FFF7F7] text-[#B5475A]',
      dot: 'bg-[#D95B70]',
      iconClass: '',
    },
    offline: {
      label: 'Device offline',
      icon: WifiOff,
      style: 'border-[#F1DDAA] bg-[#FFF9E9] text-[#946515]',
      dot: 'bg-[#D18B32]',
      iconClass: '',
    },
  }[status]

  const Icon = config.icon

  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex h-9 items-center gap-2 rounded-[10px] border px-3 text-[11px] font-semibold ${config.style}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      <Icon size={14} className={config.iconClass} />
      <span className="hidden sm:inline">{config.label}</span>
    </span>
  )
}
