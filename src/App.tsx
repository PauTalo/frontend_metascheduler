import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { Navbar } from './components/layout/Navbar';
import { Dashboard } from './pages/Dashboard';
import { JobMonitor } from './pages/JobMonitor';
import { JobSubmit } from './pages/JobSubmit';
import { Performance } from './pages/Performance';
import { Configuration } from './pages/Configuration';
import { Login } from './pages/Login';
import { normalizeUserName, useAuthStore } from './store/authStore';

function ProtectedLayout() {
  const { user } = useAuthStore();
  const normalizedUser = normalizeUserName(user);

  if (!normalizedUser) return <Navigate to="/login" replace />;

  return (
    <div className="flex min-h-screen bg-transparent text-slate-100">
      <Navbar />
      <main className="ml-56 flex min-h-screen flex-1 justify-center p-8">
        <div className="w-full max-w-7xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function AdminOnly() {
  const { role } = useAuthStore();
  if (role === 'guest') return <Navigate to="/" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/monitor" element={<JobMonitor />} />
          <Route path="/performance" element={<Performance />} />
          {/* /submit is open to guests too: the page shows the fixed guest job
              and the sidecar enforces the prefixed values server-side */}
          <Route path="/submit" element={<JobSubmit />} />
          <Route element={<AdminOnly />}>
            <Route path="/config" element={<Configuration />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
