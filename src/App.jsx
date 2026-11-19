import { useEffect, useState } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { Header } from './components/Header.jsx'
import { ApplicationModal } from './components/ApplicationModal.jsx'
import { PaymentModal } from './components/PaymentModal.jsx'
import { Brand } from './components/ui.jsx'
import { Home } from './pages/Home.jsx'
import { RolePage } from './pages/RolePage.jsx'
import { LoginPage } from './pages/LoginPage.jsx'
import { NotFound } from './pages/NotFound.jsx'

const STORAGE_KEY = 'itadis-theme'

function readMode() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  } catch {
    return 'system'
  }
}

function prefersDark() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Прокрутка к якорю при переходе с другой страницы и наверх при смене маршрута. */
function ScrollManager() {
  const { pathname, hash } = useLocation()

  useEffect(() => {
    if (hash) {
      const target = document.getElementById(hash.slice(1))
      if (target) {
        const timer = window.setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40)
        return () => window.clearTimeout(timer)
      }
    }

    window.scrollTo({ top: 0, behavior: 'auto' })
    return undefined
  }, [pathname, hash])

  return null
}

export default function App() {
  const [mode, setMode] = useState(readMode)
  const [systemDark, setSystemDark] = useState(prefersDark)
  const [applyOpen, setApplyOpen] = useState(false)
  const [payPlan, setPayPlan] = useState(null)

  useEffect(() => {
    const root = document.documentElement
    if (mode === 'system') {
      delete root.dataset.theme
    } else {
      root.dataset.theme = mode
    }
    try {
      localStorage.setItem(STORAGE_KEY, mode)
    } catch {
      /* приватный режим браузера: выбор просто не сохранится */
    }
  }, [mode])

  // Следим за системной темой, пока выбрано «как в системе».
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event) => setSystemDark(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const isDark = mode === 'dark' || (mode === 'system' && systemDark)

  return (
    <>
      <a className="skip-link" href="#main">
        Перейти к содержанию
      </a>

      <ScrollManager />

      <Header
        onApply={() => setApplyOpen(true)}
        isDark={isDark}
        onToggleTheme={() => setMode(isDark ? 'light' : 'dark')}
      />

      <Routes>
        <Route path="/" element={<Home onSelectPlan={setPayPlan} />} />
        <Route path="/roles/:slug" element={<RolePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>

      <footer className="site-footer">
        <div className="container footer-inner">
          <Brand size={32} />
          <p className="footer-note">
            © {new Date().getFullYear()} ITadis. Образовательная платформа для школ и учебных центров.
          </p>
        </div>
      </footer>

      <ApplicationModal open={applyOpen} onClose={() => setApplyOpen(false)} />
      <PaymentModal plan={payPlan} onClose={() => setPayPlan(null)} />
    </>
  )
}
