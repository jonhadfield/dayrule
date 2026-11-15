import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Gate } from './account/Gate'
import { LegalPage } from './features/legal/LegalPage'
import { isHelpPath, LEGAL_PATHS } from './features/legal/paths'
import { HelpPage } from './features/help/HelpPage'
import { registerServiceWorker } from './app/pwa'
import { installErrorReporting } from './app/errors'
import { UpdateBanner } from './app/UpdateBanner'
import { applyTheme, storedTheme } from './app/theme'

applyTheme(storedTheme())
registerServiceWorker()
installErrorReporting()

const path = location.pathname

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isHelpPath(path) ? (
      <HelpPage path={path} />
    ) : LEGAL_PATHS.includes(path) ? (
      <LegalPage path={path} />
    ) : (
      <Gate>
        <App />
      </Gate>
    )}
    <UpdateBanner />
  </StrictMode>,
)
