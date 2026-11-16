import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { HelpPage } from './features/help/HelpPage'
import { installErrorReporting } from './app/errors'
import { applyTheme, storedTheme } from './app/theme'

applyTheme(storedTheme())
installErrorReporting()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HelpPage path={location.pathname} />
  </StrictMode>,
)
