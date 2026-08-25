import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// A família Inter já era declarada no tema, mas nunca chegava a ser carregada —
// o sistema caía no fallback do sistema operacional. Auto-hospedada (em vez de
// Google Fonts) para não depender de domínio externo e não pagar o salto de
// layout na troca da fonte.
import '@fontsource-variable/inter'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
