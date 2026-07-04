import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Login } from '@/pages/Login';
import { Signup } from '@/pages/Signup';
import { Groups } from '@/pages/Groups';
import { GroupDashboard } from '@/pages/GroupDashboard';
import { SessionDetail } from '@/pages/SessionDetail';
import { AdminInsights } from '@/pages/AdminInsights';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/" element={<Navigate to="/groups" replace />} />
      <Route
        path="/groups"
        element={
          <ProtectedRoute>
            <Groups />
          </ProtectedRoute>
        }
      />
      <Route
        path="/groups/:groupId"
        element={
          <ProtectedRoute>
            <GroupDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/groups/:groupId/insights"
        element={
          <ProtectedRoute>
            <AdminInsights />
          </ProtectedRoute>
        }
      />
      <Route
        path="/sessions/:sessionId"
        element={
          <ProtectedRoute>
            <SessionDetail />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/groups" replace />} />
    </Routes>
  );
}
