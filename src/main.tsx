import '@fontsource-variable/manrope'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installDemoState } from './demo'
import { initializeTheme } from './services/theme'
import './styles.css'

initializeTheme()

if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('demo')) installDemoState()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
