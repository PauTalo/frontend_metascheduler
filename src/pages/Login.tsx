import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { normalizeUserName, useAuthStore } from '../store/authStore';
import { authService, SshAuthError } from '../api/auth.api';
import { getLocalAdminUser } from '../utils/localAuth';
import { lockRemainingMs, registerFail, resetAttempts, setLockFor } from '../utils/loginThrottle';
import { useNavigate, Navigate } from 'react-router-dom';

type LoginMode = 'ssh' | 'local';
type LocalRole = 'admin' | 'guest';

export function Login() {
  const { login, loginGuest, user } = useAuthStore();
  const navigate = useNavigate();
  const normalizedUser = normalizeUserName(user);

  const [mode, setMode] = useState<LoginMode>('local');
  const [role, setRole] = useState<LocalRole>('admin');
  const [sshUser, setSshUser] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockSecs, setLockSecs] = useState(() => Math.ceil(lockRemainingMs() / 1000));

  useEffect(() => {
    if (lockSecs <= 0) return;
    const id = setInterval(() => setLockSecs(Math.ceil(lockRemainingMs() / 1000)), 1000);
    return () => clearInterval(id);
  }, [lockSecs]);

  if (normalizedUser) return <Navigate to="/" replace />;

  const locked = lockSecs > 0;

  const switchMode = (next: LoginMode) => {
    setMode(next);
    setError(null);
  };

  // shared by both flows: validate the credentials against the cluster over SSH
  const tryLogin = async (loginUser: string, asAdmin: boolean) => {
    const remaining = lockRemainingMs();
    if (remaining > 0) {
      const secs = Math.ceil(remaining / 1000);
      setLockSecs(secs);
      setError(`Demasiados intentos. Espera ${secs}s.`);
      return;
    }
    setSubmitting(true);
    try {
      const result = await authService.login(loginUser, password);
      if (result.status === 'ok') {
        resetAttempts();
        login(result.user, asAdmin ? 'admin' : undefined);
        navigate('/');
      } else if (result.status === 'unreachable') {
        // cluster caído: no cuenta como intento de credenciales fallido
        setError(result.message);
        toast.error(result.message);
      } else if (result.status === 'rate_limited') {
        // the sidecar already locked this IP; mirror its Retry-After locally so
        // the countdown matches what the server will actually allow
        setLockFor(result.retryAfterSecs * 1000);
        setLockSecs(result.retryAfterSecs);
        setError(result.message);
      } else {
        registerFail();
        setLockSecs(Math.ceil(lockRemainingMs() / 1000));
        setError(asAdmin ? 'Contraseña incorrecta' : 'Usuario o contraseña incorrectos');
      }
    } catch (err) {
      const message = err instanceof SshAuthError ? err.message : 'Error al validar las credenciales por SSH';
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSsh = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!sshUser.trim()) {
      setError('Usuario requerido');
      return;
    }
    tryLogin(sshUser.trim(), false);
  };

  const handleLocal = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (role === 'guest') {
      loginGuest();
      navigate('/');
      return;
    }

    if (!password) {
      setError('Contraseña requerida');
      return;
    }

    const adminUser = getLocalAdminUser();
    if (!adminUser) {
      const msg = 'Acceso admin no configurado (falta VITE_LOCAL_ADMIN_USER en .env)';
      setError(msg);
      toast.error(msg);
      return;
    }

    // admin is an SSH login with the fixed install user; the user types the
    // password and it's validated against the cluster
    tryLogin(adminUser, true);
  };

  const tabClass = (active: boolean) =>
    `flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
      active
        ? 'bg-indigo-600 text-white'
        : 'text-slate-400 hover:text-slate-200'
    }`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-transparent px-6">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-800 bg-slate-900/90 p-8 shadow-2xl shadow-slate-950/40 backdrop-blur-sm">
        <h1 className="text-xl font-bold text-slate-50">CGroups</h1>

        <div className="flex gap-1 rounded-lg bg-slate-800 p-1">
          <button type="button" className={tabClass(mode === 'local')} onClick={() => switchMode('local')}>
            Acceso local
          </button>
          <button type="button" className={tabClass(mode === 'ssh')} onClick={() => switchMode('ssh')}>
            SSH
          </button>
        </div>

        {mode === 'local' && (
          <form onSubmit={handleLocal} className="space-y-3">
            <p className="text-xs text-slate-400">Acceso sin SSH. El invitado entra directamente; el admin requiere contraseña.</p>

            <div className="space-y-1">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-400">Perfil</label>
              <div className="flex gap-2">
                {(['admin', 'guest'] as const).map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      role === r
                        ? 'bg-indigo-600 border-indigo-500 text-white'
                        : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                    }`}
                  >
                    {r === 'admin' ? 'Admin' : 'Invitado'}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                {role === 'admin'
                  ? 'Acceso completo: lanzar trabajos, ver métricas, cambiar políticas.'
                  : 'Lectura y lanzar el trabajo de invitado predefinido (sin contraseña).'}
              </p>
            </div>

            {role === 'admin' && (
              <div className="space-y-1">
                <label className="text-xs font-medium uppercase tracking-wide text-slate-400">Contraseña</label>
                <input
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  type="password"
                  autoFocus
                  className="w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="Contraseña de administrador"
                />
              </div>
            )}

            {error && <p className="text-xs text-red-500">{error}</p>}

            <button
              type="submit"
              disabled={submitting || locked}
              className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {locked ? `Bloqueado (${lockSecs}s)` : submitting ? 'Validando…' : 'Entrar'}
            </button>
          </form>
        )}

        {mode === 'ssh' && (
          <form onSubmit={handleSsh} className="space-y-3">
            <p className="text-xs text-slate-400">Introduce tus credenciales para conectar por SSH al cluster.</p>

            <div className="space-y-1">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-400">Usuario</label>
              <input
                value={sshUser}
                onChange={e => setSshUser(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="tu_usuario"
                autoFocus
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-400">Contraseña</label>
              <input
                value={password}
                onChange={e => setPassword(e.target.value)}
                type="password"
                className="w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="tu_contraseña"
              />
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <button
              type="submit"
              disabled={submitting || locked}
              className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {locked ? `Bloqueado (${lockSecs}s)` : submitting ? 'Validando…' : 'Entrar'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
