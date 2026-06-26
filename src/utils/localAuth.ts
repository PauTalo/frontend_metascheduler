const metaEnv = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env;

// Cluster Linux user the local admin logs in as, set via VITE_LOCAL_ADMIN_USER
// (e.g. `root` in Docker, `metascheduler` in a real deploy). The admin does a
// normal SSH login with this fixed user and only types the password.
export function getLocalAdminUser(): string | null {
  const user = metaEnv?.VITE_LOCAL_ADMIN_USER?.trim();
  return user ? user : null;
}
