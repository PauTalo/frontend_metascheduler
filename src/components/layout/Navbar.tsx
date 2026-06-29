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

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <nav className="fixed top-0 left-0 h-full w-56 bg-white border-r border-slate-200 text-slate-700 flex flex-col py-6 px-3 gap-1 z-10">
      <div className="text-lg font-bold text-brand-600 px-3 mb-6">
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
                ? 'bg-brand-600 text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`
          }
        >
          <Icon size={16} />
          {label}
        </NavLink>
      ))}

      <div className="mt-auto border-t border-slate-200 pt-4 px-3">
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span className="flex items-center gap-2">
            {role === 'admin' ? (
              <>
                <Shield size={14} />
                Administrador
              </>
            ) : role === 'guest' ? (
              <>
                <Shield size={14} />
                Invitado
              </>
            ) : (
              <>
                <User size={14} />
                {user ?? 'sin sesión'}
              </>
            )}
          </span>
          {user && (
            <button onClick={handleLogout} title="Cerrar sesión">
              <LogOut size={14} className="hover:text-red-500" />
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
