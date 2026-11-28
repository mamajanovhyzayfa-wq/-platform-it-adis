import { lazy, Suspense, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { getSession, getToken, switchSessionRole, type SessionRole } from '../api/client'
import { rolesApi } from '../api/roles'
import { useSession } from '../hooks/useSession'
import { Layout } from '../layouts/AppLayout'
import { CookieBanner } from '../components/CookieBanner'
import { homeForRole } from './navigation'

// Страницы грузятся по маршруту: кабинет не тянет все разделы в первом чанке.
const AccessAdminPage = lazy(() => import('../pages/AccessAdmin').then((m) => ({ default: m.AccessAdminPage })))
const AiCenterPage = lazy(() => import('../pages/AiCenter').then((m) => ({ default: m.AiCenterPage })))
const AnalyticsPage = lazy(() => import('../pages/Analytics').then((m) => ({ default: m.AnalyticsPage })))
const AuditPage = lazy(() => import('../pages/Audit').then((m) => ({ default: m.AuditPage })))
const BackupsPage = lazy(() => import('../pages/Backups').then((m) => ({ default: m.BackupsPage })))
const CalendarPage = lazy(() => import('../pages/Calendar').then((m) => ({ default: m.CalendarPage })))
const CashPage = lazy(() => import('../pages/Cash').then((m) => ({ default: m.CashPage })))
const CertificatesPage = lazy(() => import('../pages/Certificates').then((m) => ({ default: m.CertificatesPage })))
const CertificateVerifyPage = lazy(() => import('../pages/CertificateVerify').then((m) => ({ default: m.CertificateVerifyPage })))
const CommunityPage = lazy(() => import('../features/community').then((m) => ({ default: m.CommunityPage })))
const MyCertificatesPage = lazy(() => import('../pages/MyCertificates').then((m) => ({ default: m.MyCertificatesPage })))
const NotificationSettingsPage = lazy(() => import('../pages/NotificationSettings').then((m) => ({ default: m.NotificationSettingsPage })))
const CoinsPage = lazy(() => import('../pages/Coins').then((m) => ({ default: m.CoinsPage })))
const CourseEditorPage = lazy(() => import('../pages/CourseEditor').then((m) => ({ default: m.CourseEditorPage })))
const CoursePreviewPage = lazy(() => import('../pages/CoursePreview').then((m) => ({ default: m.CoursePreviewPage })))
const CoursesManagePage = lazy(() => import('../pages/CoursesManage').then((m) => ({ default: m.CoursesManagePage })))
const DashboardPage = lazy(() => import('../pages/Dashboard').then((m) => ({ default: m.DashboardPage })))
const ExamsPage = lazy(() => import('../pages/Exams').then((m) => ({ default: m.ExamsPage })))
const FinancePage = lazy(() => import('../pages/finance/FinancePage').then((m) => ({ default: m.FinancePage })))
const FilesPage = lazy(() => import('../pages/FilesPage').then((m) => ({ default: m.FilesPage })))
const GradingPage = lazy(() => import('../pages/Grading').then((m) => ({ default: m.GradingPage })))
const IntegrationsPage = lazy(() => import('../pages/Integrations').then((m) => ({ default: m.IntegrationsPage })))
const ReportsPage = lazy(() => import('../pages/Reports').then((m) => ({ default: m.ReportsPage })))
const SupportPage = lazy(() => import('../pages/Support').then((m) => ({ default: m.SupportPage })))
const HomeworkPage = lazy(() => import('../pages/Homework').then((m) => ({ default: m.HomeworkPage })))
const ForbiddenPage = lazy(() => import('../pages/Forbidden').then((m) => ({ default: m.ForbiddenPage })))
const JoinPage = lazy(() => import('../pages/Join').then((m) => ({ default: m.JoinPage })))
const LearnCoursePage = lazy(() => import('../pages/LearnCourse').then((m) => ({ default: m.LearnCoursePage })))
const LessonBuilderPage = lazy(() => import('../pages/LessonBuilder').then((m) => ({ default: m.LessonBuilderPage })))
const LibraryPage = lazy(() => import('../pages/Library').then((m) => ({ default: m.LibraryPage })))
const LoginPage = lazy(() => import('../pages/Login').then((m) => ({ default: m.LoginPage })))
const ManagerDashboard = lazy(() => import('../pages/ManagerDashboard').then((m) => ({ default: m.ManagerDashboard })))
const MentorDashboard = lazy(() => import('../pages/MentorDashboard').then((m) => ({ default: m.MentorDashboard })))
const ParentDashboard = lazy(() => import('../pages/ParentDashboard').then((m) => ({ default: m.ParentDashboard })))
const PlatformPage = lazy(() => import('../pages/Platform').then((m) => ({ default: m.PlatformPage })))
const PrivacyPage = lazy(() => import('../pages/Privacy').then((m) => ({ default: m.PrivacyPage })))
const CookiesPage = lazy(() => import('../pages/Cookies').then((m) => ({ default: m.CookiesPage })))
const TermsPage = lazy(() => import('../pages/Terms').then((m) => ({ default: m.TermsPage })))
const PrivacyAdminPage = lazy(() => import('../pages/PrivacyAdmin').then((m) => ({ default: m.PrivacyAdminPage })))
const RecordingsPage = lazy(() => import('../pages/Recordings').then((m) => ({ default: m.RecordingsPage })))
const ReviewPage = lazy(() => import('../pages/Review').then((m) => ({ default: m.ReviewPage })))
const SchedulePage = lazy(() => import('../features/scheduling').then((m) => ({ default: m.SchedulePage })))
const SearchPage = lazy(() => import('../pages/SearchPage').then((m) => ({ default: m.SearchPage })))
const SecurityPage = lazy(() => import('../pages/Security').then((m) => ({ default: m.SecurityPage })))
const ShopPage = lazy(() => import('../pages/Shop').then((m) => ({ default: m.ShopPage })))
const StudentDashboard = lazy(() => import('../pages/StudentDashboard').then((m) => ({ default: m.StudentDashboard })))
const TestEditorPage = lazy(() => import('../pages/Tests').then((m) => ({ default: m.TestEditorPage })))
const TestsPage = lazy(() => import('../pages/Tests').then((m) => ({ default: m.TestsPage })))
const AttemptResultPage = lazy(() => import('../pages/TestTake').then((m) => ({ default: m.AttemptResultPage })))
const TestTakePage = lazy(() => import('../pages/TestTake').then((m) => ({ default: m.TestTakePage })))
const UsersPage = lazy(() => import('../pages/Users').then((m) => ({ default: m.UsersPage })))
const VideoRoomPage = lazy(() => import('../pages/VideoRoom').then((m) => ({ default: m.VideoRoomPage })))
const MyPaymentsPage = lazy(() => import('../pages/MyPayments').then((m) => ({ default: m.MyPaymentsPage })))

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />
  return <>{children}</>
}

/** Раздел доступен только перечисленным ролям; остальные видят экран отказа с запросом роли. */
function AllowRoles({ roles, children }: { roles: SessionRole[]; children: React.ReactNode }) {
  const location = useLocation()
  const session = useSession()
  const role = session?.role
  const myRoles = useQuery({
    queryKey: ['roles', 'me', session?.id],
    queryFn: rolesApi.me,
    enabled: Boolean(getToken()) && Boolean(role),
    staleTime: 30_000,
    retry: false,
  })

  // Переход по прямой ссылке на раздел другой подтверждённой роли должен
  // сначала переключить интерфейс, иначе запросы уйдут с прежним X-Active-Role.
  const grantedTarget = myRoles.data?.roles.find((granted) => roles.includes(granted))
  const needsRoleSwitch = Boolean(role && !roles.includes(role) && grantedTarget)
  useEffect(() => {
    if (needsRoleSwitch && grantedTarget) switchSessionRole(grantedTarget)
  }, [needsRoleSwitch, grantedTarget])

  if (!role) return <Navigate to="/login" replace />
  if (roles.includes(role)) return <>{children}</>
  if (myRoles.isLoading || needsRoleSwitch) return <div className="state">Проверяем доступ…</div>
  if (!grantedTarget) {
    return <Navigate to="/forbidden" replace state={{ from: location.pathname }} />
  }
  return <>{children}</>
}

function HomeRedirect() {
  return <Navigate to={homeForRole(getSession()?.role)} replace />
}

export function App() {
  return (
    <>
      <CookieBanner />
      <Suspense fallback={<div className="state" role="status">Загрузка…</div>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<LoginPage initialMode="register" />} />
        <Route path="/join" element={<JoinPage />} />
        {/* Консоль главного администратора вне панели филиала: без его навигации и данных. */}
        <Route path="/platform" element={<PlatformPage />} />
        <Route path="/verify/:code" element={<CertificateVerifyPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/cookies" element={<CookiesPage />} />
        <Route path="/terms" element={<TermsPage />} />

        <Route
          path="/"
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<HomeRedirect />} />

          <Route path="admin" element={<AllowRoles roles={['ADMIN']}><DashboardPage /></AllowRoles>} />
          <Route path="manager" element={<AllowRoles roles={['MANAGER']}><ManagerDashboard /></AllowRoles>} />
          <Route path="mentor" element={<AllowRoles roles={['TEACHER']}><MentorDashboard /></AllowRoles>} />
          <Route path="student" element={<AllowRoles roles={['STUDENT']}><StudentDashboard /></AllowRoles>} />
          <Route path="parent" element={<AllowRoles roles={['PARENT']}><ParentDashboard /></AllowRoles>} />

          <Route path="search" element={<SearchPage />} />
          <Route path="security" element={<SecurityPage />} />
          <Route path="forbidden" element={<ForbiddenPage />} />

          <Route path="access" element={<AllowRoles roles={['ADMIN']}><AccessAdminPage /></AllowRoles>} />
          <Route path="users" element={<AllowRoles roles={['ADMIN']}><UsersPage /></AllowRoles>} />
          <Route path="courses" element={<AllowRoles roles={['ADMIN', 'MANAGER', 'TEACHER']}><CoursesManagePage /></AllowRoles>} />
          <Route path="courses/:id/edit" element={<AllowRoles roles={['ADMIN', 'MANAGER', 'TEACHER']}><CourseEditorPage /></AllowRoles>} />
          <Route path="courses/:id/preview" element={<AllowRoles roles={['ADMIN', 'MANAGER', 'TEACHER']}><CoursePreviewPage /></AllowRoles>} />
          <Route path="courses/:id/lessons/:lessonId" element={<AllowRoles roles={['ADMIN', 'MANAGER', 'TEACHER']}><LessonBuilderPage /></AllowRoles>} />
          <Route path="learn/:courseId" element={<AllowRoles roles={['STUDENT']}><LearnCoursePage /></AllowRoles>} />
          <Route path="library" element={<AllowRoles roles={['STUDENT']}><LibraryPage /></AllowRoles>} />
          <Route path="files" element={<FilesPage />} />
          <Route path="homework" element={<AllowRoles roles={['ADMIN', 'MANAGER', 'TEACHER', 'STUDENT']}><HomeworkPage /></AllowRoles>} />
          <Route path="tests" element={<AllowRoles roles={['ADMIN', 'MANAGER', 'TEACHER', 'STUDENT']}><TestsPage /></AllowRoles>} />
          <Route path="tests/:id/edit" element={<AllowRoles roles={['ADMIN', 'MANAGER', 'TEACHER']}><TestEditorPage /></AllowRoles>} />
          <Route path="tests/:id/take" element={<AllowRoles roles={['STUDENT']}><TestTakePage /></AllowRoles>} />
          <Route path="attempts/:id/result" element={<AllowRoles roles={['ADMIN', 'MANAGER', 'TEACHER', 'STUDENT']}><AttemptResultPage /></AllowRoles>} />
          <Route path="exams" element={<AllowRoles roles={['ADMIN', 'MANAGER', 'TEACHER', 'STUDENT']}><ExamsPage /></AllowRoles>} />
          <Route path="grading" element={<AllowRoles roles={['ADMIN', 'MANAGER']}><GradingPage /></AllowRoles>} />
          <Route path="schedule" element={<AllowRoles roles={['ADMIN', 'MANAGER', 'TEACHER']}><SchedulePage /></AllowRoles>} />
          <Route path="calendar" element={<AllowRoles roles={['ADMIN', 'TEACHER', 'STUDENT']}><CalendarPage /></AllowRoles>} />
          <Route path="recordings" element={<AllowRoles roles={['ADMIN', 'TEACHER', 'STUDENT']}><RecordingsPage /></AllowRoles>} />
          <Route path="lesson/:id" element={<AllowRoles roles={['ADMIN', 'TEACHER', 'STUDENT']}><VideoRoomPage /></AllowRoles>} />
          <Route path="review" element={<AllowRoles roles={['ADMIN', 'TEACHER']}><ReviewPage /></AllowRoles>} />
          <Route path="certificates" element={<AllowRoles roles={['ADMIN']}><CertificatesPage /></AllowRoles>} />
          <Route path="my-certificates" element={<AllowRoles roles={['STUDENT']}><MyCertificatesPage /></AllowRoles>} />
          <Route path="community" element={<CommunityPage />} />
          <Route path="notifications" element={<NotificationSettingsPage />} />
          <Route path="finance" element={<AllowRoles roles={['ADMIN']}><FinancePage /></AllowRoles>} />
          <Route path="analytics" element={<AllowRoles roles={['STUDENT', 'TEACHER', 'MANAGER', 'ADMIN']}><AnalyticsPage /></AllowRoles>} />
          <Route path="my-payments" element={<AllowRoles roles={['STUDENT', 'PARENT']}><MyPaymentsPage /></AllowRoles>} />
          <Route path="cash" element={<AllowRoles roles={['ADMIN', 'MANAGER']}><CashPage /></AllowRoles>} />
          <Route path="shop" element={<AllowRoles roles={['ADMIN', 'TEACHER', 'STUDENT']}><ShopPage /></AllowRoles>} />
          <Route path="coins" element={<AllowRoles roles={['ADMIN', 'TEACHER', 'STUDENT', 'PARENT']}><CoinsPage /></AllowRoles>} />
          <Route path="ai" element={<AllowRoles roles={['ADMIN', 'MANAGER', 'TEACHER', 'STUDENT']}><AiCenterPage /></AllowRoles>} />
          <Route path="reports" element={<AllowRoles roles={['ADMIN', 'MANAGER']}><ReportsPage /></AllowRoles>} />
          <Route path="support" element={<SupportPage />} />
          <Route path="backups" element={<AllowRoles roles={['ADMIN']}><BackupsPage /></AllowRoles>} />
          <Route path="integrations" element={<AllowRoles roles={['ADMIN']}><IntegrationsPage /></AllowRoles>} />
          <Route path="audit" element={<AllowRoles roles={['ADMIN']}><AuditPage /></AllowRoles>} />
          <Route path="privacy-admin" element={<AllowRoles roles={['ADMIN']}><PrivacyAdminPage /></AllowRoles>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </>
  )
}
