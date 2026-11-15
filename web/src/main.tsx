import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Gate } from './account/Gate'
import { registerServiceWorker } from './app/pwa'
import { installErrorReporting } from './app/errors'
import { UpdateBanner } from './app/UpdateBanner'
import { applyTheme, storedTheme } from './app/theme'

applyTheme(storedTheme())
registerServiceWorker()
installErrorReporting()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Gate>
      <App />
    </Gate>
    <UpdateBanner />
  </StrictMode>,
)
