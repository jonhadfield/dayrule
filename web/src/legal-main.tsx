import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { LegalPage } from './features/legal/LegalPage'
import { installErrorReporting } from './app/errors'
import { applyTheme, storedTheme } from './app/theme'

applyTheme(storedTheme())
installErrorReporting()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LegalPage path={location.pathname} />
  </StrictMode>,
)
