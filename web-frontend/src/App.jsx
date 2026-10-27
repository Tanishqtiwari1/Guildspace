import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth.jsx'
import Layout from './components/Layout.jsx'
import { Spinner } from './components/ui.jsx'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Profile from './pages/Profile.jsx'
import FindMentors from './pages/FindMentors.jsx'
import UserProfile from './pages/UserProfile.jsx'
import Requests from './pages/Requests.jsx'
import Sessions from './pages/Sessions.jsx'
import Messages from './pages/Messages.jsx'
import LearningPlans from './pages/LearningPlans.jsx'
import Notifications from './pages/Notifications.jsx'
import Reports from './pages/Reports.jsx'
import Admin from './pages/Admin.jsx'
import Academics from './pages/Academics.jsx'
import Credits from './pages/Credits.jsx'
import LearningRecord from './pages/LearningRecord.jsx'
import FacultyDashboard from './pages/faculty/FacultyDashboard.jsx'
import FacultyCourses from './pages/faculty/FacultyCourses.jsx'
import FacultyCourseDetail from './pages/faculty/FacultyCourseDetail.jsx'
import FacultyClasses from './pages/faculty/FacultyClasses.jsx'
import FacultyAnnouncements from './pages/faculty/FacultyAnnouncements.jsx'
import FacultyMarks from './pages/faculty/FacultyMarks.jsx'

/**
 * Route guard. `role` hides pages that don't apply to an account type; the backend
 * enforces the same rules independently on every API call.
 */
function Protected({ children, admin, role }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="center-page"><Spinner /></div>
  if (!user) return <Navigate to="/login" replace />
  if (admin && !user.is_admin) return <Navigate to="/" replace />
  if (role && user.account_type !== role) return <Navigate to="/" replace />
  return <Layout>{children}</Layout>
}

function Home() {
  const { user } = useAuth()
  return user?.account_type === 'FACULTY' ? <FacultyDashboard /> : <Dashboard />
}

export default function App() {
  const { user } = useAuth()
  const S = 'STUDENT'
  const F = 'FACULTY'
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to="/" /> : <Register />} />
      <Route path="/" element={<Protected><Home /></Protected>} />
      <Route path="/profile" element={<Protected><Profile /></Protected>} />
      <Route path="/users/:id" element={<Protected><UserProfile /></Protected>} />
      <Route path="/messages" element={<Protected><Messages /></Protected>} />
      <Route path="/messages/:id" element={<Protected><Messages /></Protected>} />
      <Route path="/notifications" element={<Protected><Notifications /></Protected>} />
      <Route path="/reports" element={<Protected><Reports /></Protected>} />
      <Route path="/admin" element={<Protected admin><Admin /></Protected>} />

      {/* Students: peer learning + academics */}
      <Route path="/find" element={<Protected role={S}><FindMentors /></Protected>} />
      <Route path="/requests" element={<Protected role={S}><Requests /></Protected>} />
      <Route path="/sessions" element={<Protected role={S}><Sessions /></Protected>} />
      <Route path="/plans" element={<Protected role={S}><LearningPlans /></Protected>} />
      <Route path="/academics" element={<Protected role={S}><Academics /></Protected>} />
      <Route path="/credits" element={<Protected role={S}><Credits /></Protected>} />
      <Route path="/record/:id" element={<Protected><LearningRecord /></Protected>} />

      {/* Faculty */}
      <Route path="/faculty/courses" element={<Protected role={F}><FacultyCourses /></Protected>} />
      <Route path="/faculty/courses/:id" element={<Protected role={F}><FacultyCourseDetail /></Protected>} />
      <Route path="/faculty/classes" element={<Protected role={F}><FacultyClasses /></Protected>} />
      <Route path="/faculty/announcements" element={<Protected role={F}><FacultyAnnouncements /></Protected>} />
      <Route path="/faculty/marks" element={<Protected role={F}><FacultyMarks /></Protected>} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  )
}
