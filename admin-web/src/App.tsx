import { Navigate, Route, Routes } from 'react-router-dom'
import { getToken } from './api/client'
import { Layout } from './components/Layout'
import { AuditPage } from './pages/Audit'
import { CoinsPage } from './pages/Coins'
import { CoursesPage } from './pages/Courses'
import { DashboardPage } from './pages/Dashboard'
import { LoginPage } from './pages/Login'
import { ReviewPage } from './pages/Review'
import { SchedulePage } from './pages/Schedule'
import { ShopPage } from './pages/Shop'
import { UsersPage } from './pages/Users'

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />
  return <>{children}</>
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="courses" element={<CoursesPage />} />
        <Route path="schedule" element={<SchedulePage />} />
        <Route path="review" element={<ReviewPage />} />
        <Route path="shop" element={<ShopPage />} />
        <Route path="coins" element={<CoinsPage />} />
        <Route path="audit" element={<AuditPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
