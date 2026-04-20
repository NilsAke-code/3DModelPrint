import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import AuthProvider from './auth/AuthProvider'
import { msalReady } from './auth/AuthProvider'
import { UserProvider } from './contexts/UserContext'

// Wait for MSAL to initialize and handle any redirect (popup or redirect flow)
// before mounting React. In a popup window, handleRedirectPromise() will
// send the auth result back to the parent and close this window automatically.
msalReady.then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AuthProvider>
        <UserProvider>
          <App />
        </UserProvider>
      </AuthProvider>
    </StrictMode>,
  )
})
