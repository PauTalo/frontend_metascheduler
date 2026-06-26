import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type UserRole = 'admin' | 'guest' | null;

export function normalizeUserName(user: string | null | undefined) {
  return user?.trim() || null;
}

interface AuthState {
  user: string | null;
  pwd: string | null;
  role: UserRole;
  // role tells the local admin (fixed install user) apart from a normal SSH user (null)
  login: (user: string, role?: UserRole) => void;
  loginGuest: () => void;
  logout: () => void;
}

function deriveWorkingDir(user: string): string {
  return user === 'root' ? '/root/' : `/home/${user}/`;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      pwd: null,
      role: null,
      login: (user: string, role: UserRole = null) => {
        const normalizedUser = normalizeUserName(user);
        const pwd = normalizedUser ? deriveWorkingDir(normalizedUser) : null;
        set({ user: normalizedUser, pwd, role });
      },
      // Guest isn't authenticated but still needs an owner for the GETs. The API
      // doesn't actually filter by owner when it's `root` (returns every job), so
      // guest queries as `root` to see everything read-only. Can't change this on
      // the backend side.
      loginGuest: () => set({ user: 'root', pwd: null, role: 'guest' }),
      logout: () => set({ user: null, pwd: null, role: null }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ user: state.user, pwd: state.pwd, role: state.role }),
    }
  )
);
