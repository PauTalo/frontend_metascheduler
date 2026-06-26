const metaEnv = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env;

// Valores de los trabajos fijos del invitado, solo para mostrarlos en el
// formulario. El prefijado real lo impone el sidecar (GUEST_* en su .env);
// estos VITE_GUEST_* son únicamente informativos.
export type GuestSchedulerType = 'S' | 'H';

export interface GuestJobInfo {
  owner: string;
  name: string;
  path: string;
  pwd: string;
  schedulerType: GuestSchedulerType;
  options: string;
}

// Info del trabajo de invitado para el tipo elegido. Las vars por tipo
// (VITE_GUEST_SGE_* / VITE_GUEST_HADOOP_*) caen sobre las VITE_GUEST_* legacy.
export function getGuestJobInfo(schedulerType: GuestSchedulerType): GuestJobInfo {
  const owner = metaEnv?.VITE_GUEST_OWNER?.trim() || 'metascheduler';

  if (schedulerType === 'H') {
    return {
      owner,
      name: metaEnv?.VITE_GUEST_HADOOP_NAME?.trim() || 'guest_demo_hadoop',
      path: metaEnv?.VITE_GUEST_HADOOP_PATH?.trim() || '',
      pwd: metaEnv?.VITE_GUEST_HADOOP_PWD?.trim() || '',
      schedulerType: 'H',
      options: metaEnv?.VITE_GUEST_HADOOP_OPTIONS?.trim() || '',
    };
  }

  return {
    owner,
    name: metaEnv?.VITE_GUEST_SGE_NAME?.trim() || metaEnv?.VITE_GUEST_NAME?.trim() || 'guest_demo_sge',
    path: metaEnv?.VITE_GUEST_SGE_PATH?.trim() || metaEnv?.VITE_GUEST_PATH?.trim() || '',
    pwd: metaEnv?.VITE_GUEST_SGE_PWD?.trim() || metaEnv?.VITE_GUEST_PWD?.trim() || '',
    schedulerType: 'S',
    options: metaEnv?.VITE_GUEST_SGE_OPTIONS?.trim() || metaEnv?.VITE_GUEST_OPTIONS?.trim() || '',
  };
}
