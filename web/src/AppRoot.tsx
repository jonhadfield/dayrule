import App from './App'
import { Gate } from './account/Gate'

/** Signed-in app shell; loaded only for non-help / non-legal paths. */
export default function AppRoot() {
  return (
    <Gate>
      <App />
    </Gate>
  )
}
