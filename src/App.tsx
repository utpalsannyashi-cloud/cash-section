import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Login } from '@/pages/Login';
import { Signup } from '@/pages/Signup';
import { Home } from '@/pages/Home';
import { Groups } from '@/pages/Groups';
import { GroupDashboard } from '@/pages/GroupDashboard';
import { SessionDetail } from '@/pages/SessionDetail';
import { AdminInsights } from '@/pages/AdminInsights';
import { AllGroupsInsights } from '@/pages/AllGroupsInsights';
import { MasterAdmin } from '@/pages/MasterAdmin';
import { PartnerInviteAccept } from '@/pages/PartnerInviteAccept';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/partner-invite/:token" element={<PartnerInviteAccept />} />
      <Route path="/" element={<Home />} />
      <Route
        path="/groups"
        element={
          <ProtectedRoute requireFull>
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
        path="/insights"
        element={
          <ProtectedRoute requireFull>
            <AllGroupsInsights />
          </ProtectedRoute>
        }
      />
      <Route
        path="/master"
        element={
          <ProtectedRoute requireFull>
            <MasterAdmin />
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
