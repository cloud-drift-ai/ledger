
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import AppRouter from './AppRouter'
import { AuthProvider } from './context/AuthContext'
import { PreferencesProvider } from './context/PreferencesContext'
import { PwaProvider } from './context/PwaContext'

import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <PwaProvider>
        <PreferencesProvider>
          <AuthProvider>
            <AppRouter />
          </AuthProvider>
        </PreferencesProvider>
      </PwaProvider>
    </BrowserRouter>
  </StrictMode>
)
