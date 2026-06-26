import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  List,
  PlusCircle,
  BarChart2,
  Settings,
  LogOut,
  User,
  Shield,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

// hideForGuest oculta el enlace al invitado (cosmético). El acceso real a la
// ruta lo protege el guard <AdminOnly> en App.tsx; mantenlos coordinados.
const allLinks = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, hideForGuest: false },
  { to: '/monitor', label: 'Monitor', icon: List, hideForGuest: false },
  { to: '/submit', label: 'Lanzar trabajo', icon: PlusCircle, hideForGuest: false },
  { to: '/performance', label: 'Rendimiento', icon: BarChart2, hideForGuest: false },
  { to: '/config', label: 'Configuración', icon: Settings, hideForGuest: true },
];

export function Navbar() {
  const { user, role, logout } = useAuthStore();
  const navigate = useNavigate();

  const isGuest = role === 'guest';
  const links = allLinks.filter(link => !isGuest || !link.hideForGuest);
  // guest queries as `root` (backend workaround), but we show "invitado" so the
  // real owner used in the requests isn't exposed
  const displayName = isGuest ? 'invitado' : user;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <nav className="fixed top-0 left-0 h-full w-56 bg-gray-900 text-white flex flex-col py-6 px-3 gap-1 z-10">
      <div className="text-lg font-bold text-indigo-400 px-3 mb-6">
        Metascheduler Frontend
      </div>

      {links.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              isActive
                ? 'bg-indigo-600 text-white'
                : 'text-gray-300 hover:bg-gray-800 hover:text-white'
            }`
          }
        >
          <Icon size={16} />
          {label}
        </NavLink>
      ))}

      <div className="mt-auto border-t border-gray-700 pt-4 px-3 space-y-2">
        {role && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Shield size={11} />
            <span>{role === 'admin' ? 'Administrador' : 'Invitado'}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-sm text-gray-400">
          <span className="flex items-center gap-2">
            <User size={14} />
            {displayName ?? 'sin sesión'}
          </span>
          {user && (
            <button onClick={handleLogout} title="Cerrar sesión">
              <LogOut size={14} className="hover:text-red-400" />
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
