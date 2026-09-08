import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './index.css'
import App from './App.tsx'

// Handle Vite dynamic import chunk loading errors caused by new deployments
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  const reloadKey = 'openwa_vite_preload_reload';
  const lastAttempt = sessionStorage.getItem(reloadKey);
  if (!lastAttempt || Date.now() - parseInt(lastAttempt, 10) > 10000) {
    sessionStorage.setItem(reloadKey, String(Date.now()));
    window.location.reload();
  }
});

// Suppress benign Chrome DevTools / soft navigation / extension injected errors
window.addEventListener('error', (event) => {
  const msg = event?.message || '';
  if (msg.includes('reportAllChanges') || msg.includes("reading 'startTime'")) {
    event.stopImmediatePropagation();
    event.preventDefault();
    return true;
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
