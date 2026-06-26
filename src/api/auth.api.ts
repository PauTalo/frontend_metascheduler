const metaEnv = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env;

const sshAuthBaseUrl = metaEnv?.VITE_SSH_AUTH_URL ?? '/ssh-auth';

interface LoginResponse {
  exists: boolean;
  user?: string;
}

export type LoginResult =
  | { status: 'ok'; user: string }
  | { status: 'not_found' }
  | { status: 'rate_limited'; retryAfterSecs: number; message: string }
  | { status: 'unreachable'; message: string };

// thrown when the SSH auth sidecar (or the cluster behind it) can't be reached
export class SshAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SshAuthError';
  }
}

function buildAuthUrl(path: string) {
  const normalizedBase = sshAuthBaseUrl.endsWith('/') ? sshAuthBaseUrl.slice(0, -1) : sshAuthBaseUrl;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export interface JobSshLaunchPayload {
  user: string;
  password: string;
  name: string;
  queue: number;
  path: string;
  pwd: string;
  options: string;
  scheduler_type: 'S' | 'H';
}

export type JobSshLaunchResult =
  | { status: 'submitted'; message: string }
  | { status: 'permission_denied'; message: string }
  | { status: 'auth_failed' }
  | { status: 'unreachable'; message: string }
  | { status: 'error'; message: string };

// guest launch: no SSH, no password. The sidecar holds one fixed job per
// scheduler type and uses only the scheduler_type we send to pick it; every
// other field (owner, path, options…) comes from the server, so a tampered POST
// can't change the job — only choose between the two predefined ones.
export type GuestLaunchResult =
  | { status: 'submitted'; message: string }
  | { status: 'error'; message: string };

// editable job fields; only the changed ones are sent (partial update)
export interface JobUpdateChanges {
  name?: string;
  queue?: number;
  path?: string;
  options?: string;
}

export interface JobSshUpdatePayload {
  user: string;
  password: string;
  jobId: number;
  // resulting path and dir; the sidecar uses them to re-check permissions over SSH
  path: string;
  pwd: string;
  scheduler_type: 'S' | 'H';
  changes: JobUpdateChanges;
}

export type JobUpdateResult =
  | { status: 'updated'; message: string }
  | { status: 'permission_denied'; message: string }
  | { status: 'auth_failed' }
  | { status: 'invalid'; message: string }
  | { status: 'unreachable'; message: string }
  | { status: 'error'; message: string };

// map the sidecar's HTTP status onto a typed JobUpdateResult
function mapUpdateResponse(response: Response, body: { message?: string } | null): JobUpdateResult {
  if (body === null && response.ok) {
    return { status: 'error', message: 'Respuesta inesperada del servicio SSH' };
  }
  if (response.status === 401) return { status: 'auth_failed' };
  if (response.status === 403) {
    return { status: 'permission_denied', message: body?.message ?? 'Sin permisos para editar el trabajo' };
  }
  if (response.status === 400 || response.status === 404) {
    return { status: 'invalid', message: body?.message ?? 'No se pudo actualizar el trabajo' };
  }
  if (response.status === 502) {
    return { status: 'unreachable', message: body?.message ?? 'No se pudo contactar con el cluster' };
  }
  if (!response.ok) {
    return { status: 'error', message: body?.message ?? 'Error al actualizar el trabajo' };
  }
  return { status: 'updated', message: body?.message ?? 'Trabajo actualizado correctamente' };
}

export const sshJobsService = {
  launch: async (payload: JobSshLaunchPayload): Promise<JobSshLaunchResult> => {
    let response: Response;

    try {
      response = await fetch(buildAuthUrl('/jobs/launch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new SshAuthError('No se pudo contactar con el servicio SSH');
    }

    let body: { message?: string } | null = null;
    try {
      body = await response.json();
    } catch {
      // non-JSON response (e.g. HTML from a misconfigured proxy)
    }

    // parse failed but the response looked OK -> proxy/routing issue
    if (body === null && response.ok) {
      return { status: 'error', message: 'Respuesta inesperada del servicio SSH (¿proxy no configurado?)' };
    }

    if (response.status === 502) {
      return { status: 'unreachable', message: body?.message ?? 'No se pudo contactar con el cluster' };
    }

    if (response.status === 401) {
      return { status: 'auth_failed' };
    }

    if (response.status === 403) {
      return { status: 'permission_denied', message: body?.message ?? 'Sin permisos para ejecutar el trabajo' };
    }

    if (!response.ok) {
      return { status: 'error', message: body?.message ?? 'Error al lanzar el trabajo' };
    }

    return { status: 'submitted', message: body?.message ?? 'Trabajo enviado correctamente' };
  },

  // Lanza el trabajo fijo del invitado para el tipo de scheduler elegido. Lo
  // único que controla el cliente es scheduler_type ('S' = SGE, 'H' = Hadoop);
  // el sidecar valida ese tipo y construye la petición con sus propios valores
  // (GUEST_*). Un POST manipulado desde las DevTools solo puede elegir entre los
  // dos trabajos predefinidos, no cambiar owner, path ni opciones.
  launchGuest: async (schedulerType: 'S' | 'H'): Promise<GuestLaunchResult> => {
    let response: Response;

    try {
      response = await fetch(buildAuthUrl('/jobs/launch-guest'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduler_type: schedulerType }),
      });
    } catch {
      throw new SshAuthError('No se pudo contactar con el servicio SSH');
    }

    let body: { message?: string } | null = null;
    try {
      body = await response.json();
    } catch {
      // non-JSON response (e.g. HTML from a misconfigured proxy)
    }

    if (!response.ok) {
      return { status: 'error', message: body?.message ?? 'Error al lanzar el trabajo' };
    }

    return { status: 'submitted', message: body?.message ?? 'Trabajo enviado correctamente' };
  },

  update: async (payload: JobSshUpdatePayload): Promise<JobUpdateResult> => {
    let response: Response;

    try {
      response = await fetch(buildAuthUrl('/jobs/update'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new SshAuthError('No se pudo contactar con el servicio SSH');
    }

    let body: { message?: string } | null = null;
    try {
      body = await response.json();
    } catch {
      // non-JSON response
    }

    return mapUpdateResponse(response, body);
  },
};

export const authService = {
  // validates a user against the cluster over SSH (via the sidecar)
  login: async (user: string, password: string): Promise<LoginResult> => {
    let response: Response;

    try {
      response = await fetch(buildAuthUrl('/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, password }),
      });
    } catch {
      throw new SshAuthError('No se pudo contactar con el servicio de autenticación SSH');
    }

    if (response.status === 502) {
      return { status: 'unreachable', message: 'No se pudo contactar con el cluster' };
    }

    // The sidecar rate-limits attempts per IP and answers 429 with the wait time
    // in the Retry-After header. That's the source of truth, not the browser.
    if (response.status === 429) {
      let body: { message?: string } | null = null;
      try {
        body = await response.json();
      } catch {
        // no JSON body
      }
      const headerRetry = Number(response.headers.get('Retry-After'));
      const retryAfterSecs = Number.isFinite(headerRetry) && headerRetry > 0 ? headerRetry : 60;
      return {
        status: 'rate_limited',
        retryAfterSecs,
        message: body?.message ?? `Demasiados intentos. Espera ${retryAfterSecs}s.`,
      };
    }

    if (!response.ok) {
      throw new SshAuthError(`La autenticación SSH falló (estado ${response.status})`);
    }

    const data = (await response.json()) as LoginResponse;

    if (data.exists) {
      return { status: 'ok', user: data.user ?? user };
    }

    return { status: 'not_found' };
  },
};
