import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import LoginPage from './auth/LoginPage';
import ReportForm from './components/ReportForm';
import AdminPanel from './components/AdminPanel';
import BauleiterDashboard from './components/BauleiterDashboard';
import FtpBrowser from './components/FtpBrowser';

function HomePage() {
  const { user } = useAuth();
  if (user?.role === 'admin') {
    return <Navigate to="/admin" replace />;
  }
  return <BauleiterDashboard />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={
        <ProtectedRoute><HomePage /></ProtectedRoute>
      } />
      <Route path="/report" element={
        <ProtectedRoute><ReportForm /></ProtectedRoute>
      } />
      <Route path="/ftp" element={
        <ProtectedRoute><FtpBrowser /></ProtectedRoute>
      } />
      <Route path="/admin/*" element={
        <ProtectedRoute requiredRole="admin"><AdminPanel /></ProtectedRoute>
      } />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
