import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { isHelpPath, LEGAL_PATHS } from './features/legal/paths'
import { registerServiceWorker } from './app/pwa'
import { installErrorReporting } from './app/errors'
import { UpdateBanner } from './app/UpdateBanner'
import { applyTheme, storedTheme } from './app/theme'

applyTheme(storedTheme())
registerServiceWorker()
installErrorReporting()

const path = location.pathname

// Path-split so help/legal don't ship in the app's initial JS (decision 24).
const HelpPage = lazy(() =>
  import('./features/help/HelpPage').then((m) => ({ default: m.HelpPage })),
)
const LegalPage = lazy(() =>
  import('./features/legal/LegalPage').then((m) => ({ default: m.LegalPage })),
)
const AppRoot = lazy(() => import('./AppRoot'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      {isHelpPath(path) ? (
        <HelpPage path={path} />
      ) : LEGAL_PATHS.includes(path) ? (
        <LegalPage path={path} />
      ) : (
        <AppRoot />
      )}
    </Suspense>
    <UpdateBanner />
  </StrictMode>,
)
