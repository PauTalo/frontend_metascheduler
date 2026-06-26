import { createServer } from 'node:http';
import { Client } from 'ssh2';
import { createLoginGuard, createRateLimiter } from './rateLimit.mjs';

/**
 * SSH auth sidecar.
 *
 * Browsers can't open SSH connections, so this little service takes a username
 * and password over HTTP, tries `ssh <user>@<host>` with them, and reports back
 * whether the login worked.
 */

const PORT = Number(process.env.SSH_AUTH_PORT ?? 4000);
const SSH_HOST = process.env.SSH_HOST ?? 'localhost';
const SSH_PORT = Number(process.env.SSH_PORT ?? 22);
const SSH_READY_TIMEOUT = Number(process.env.SSH_READY_TIMEOUT ?? 10000);
// Metascheduler API URL as seen from the sidecar (not from the cluster).
const API_URL = process.env.API_URL ?? 'http://host.docker.internal:8000';

// ── CORS ────────────────────────────────────────────────────────────────────
// Comma-separated allowlist of origins. '*' allows everything (dev only); in
// production set this to the frontend's domain.
const ALLOW_ORIGINS = (process.env.SSH_AUTH_ALLOW_ORIGIN ?? '*')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// ── Abuse limits ────────────────────────────────────────────────────────────
// The browser throttle (localStorage) is easy to skip with curl, so the real
// per-IP limit lives here.
const LOGIN_MAX_FAILS = Number(process.env.LOGIN_MAX_FAILS ?? 5);
const LOGIN_LOCK_MS = Number(process.env.LOGIN_LOCK_MS ?? 15 * 60_000);
const GUEST_MAX_PER_MIN = Number(process.env.GUEST_MAX_PER_MIN ?? 10);
// Behind a reverse proxy (nginx/traefik) the real client IP comes in
// X-Forwarded-For. Only trust that header when TRUST_PROXY=true.
const TRUST_PROXY = (process.env.TRUST_PROXY ?? 'false') === 'true';

const loginGuard = createLoginGuard({ maxFails: LOGIN_MAX_FAILS, lockMs: LOGIN_LOCK_MS });
const guestLimiter = createRateLimiter({ max: GUEST_MAX_PER_MIN, windowMs: 60_000 });

/** Client IP, used as the key for the limiters. */
function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  }
  return req.socket?.remoteAddress ?? 'unknown';
}

/**
 * Works out what to put in Access-Control-Allow-Origin for this request: '*' if
 * the allowlist has it, the request's own Origin if it's listed, or null when
 * it isn't (then we omit the header and the browser blocks the reply).
 */
function resolveCorsOrigin(req) {
  if (ALLOW_ORIGINS.includes('*')) return '*';
  const origin = req.headers.origin;
  return origin && ALLOW_ORIGINS.includes(origin) ? origin : null;
}

// ── Fixed guest jobs ────────────────────────────────────────────────────────
// The guest doesn't authenticate or open SSH. It launches one of two predefined
// jobs (one SGE, one Hadoop). The ONLY thing it picks is the scheduler type;
// everything else (owner, path, pwd, queue, options) is fixed here on the
// server, per type. Since the owner is a fixed low-privilege account and the
// script is a known asset that exists and that account can run, there's no
// identity to verify and nothing to check at runtime → no SSH or password needed.
//
// SECURITY — why these values live HERE and not in the form:
//   Pre-filling the React form fields (readonly/disabled) is just cosmetic. A
//   guest can open DevTools and send a tampered POST to /jobs/launch-guest (or
//   straight to the API) with a different owner, path or options. That's why the
//   /jobs/launch-guest endpoint only reads scheduler_type from the body
//   (validated to 'S' or 'H') and uses only the variables below. This is the one
//   source of truth for the pre-filling.
const GUEST_OWNER = process.env.GUEST_OWNER ?? 'metascheduler';

// Config per scheduler type. The specific vars (GUEST_SGE_* / GUEST_HADOOP_*)
// fall back to the legacy GUEST_* (SGE job) when missing.
const GUEST_JOBS = {
  S: {
    name: process.env.GUEST_SGE_NAME ?? process.env.GUEST_NAME ?? 'guest_demo_sge',
    path: process.env.GUEST_SGE_PATH ?? process.env.GUEST_PATH ?? '',
    pwd: process.env.GUEST_SGE_PWD ?? process.env.GUEST_PWD ?? '',
    queue: Number(process.env.GUEST_SGE_QUEUE ?? process.env.GUEST_QUEUE ?? 0),
    options: process.env.GUEST_SGE_OPTIONS ?? process.env.GUEST_OPTIONS ?? '',
    scheduler_type: 'S',
  },
  H: {
    name: process.env.GUEST_HADOOP_NAME ?? 'guest_demo_hadoop',
    path: process.env.GUEST_HADOOP_PATH ?? '',
    pwd: process.env.GUEST_HADOOP_PWD ?? '',
    queue: Number(process.env.GUEST_HADOOP_QUEUE ?? 0),
    options: process.env.GUEST_HADOOP_OPTIONS ?? '',
    scheduler_type: 'H',
  },
};

// Valid characters for a Unix username; keeps weird input out.
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;

/**
 * Builds the shell command that checks file permissions. Uses a different exit
 * code per error type so the sidecar can give a precise message.
 *   exit 1 → file doesn't exist
 *   exit 2 → not readable
 *   exit 3 → not executable  (SGE only; Hadoop uses 644 jars)
 *   exit 4 → working dir not writable (SGE writes .o/.e files there)
 */
function buildPermCheckCmd(absPath, pwd, schedulerType) {
  const p = absPath.replace(/'/g, `'\\''`);
  const d = pwd.replace(/'/g, `'\\''`);
  const checks = `test -e '${p}' || exit 1; test -r '${p}' || exit 2`;
  const dirCheck = `test -w '${d}' || exit 4`;
  return schedulerType === 'H'
    ? `${checks}; ${dirCheck}`
    : `${checks}; test -x '${p}' || exit 3; ${dirCheck}`;
}

/**
 * Tries to open an SSH session as `user` with `password`. Resolves with the
 * outcome: exists (auth OK), not_found (wrong user/password) or unreachable
 * (couldn't reach the cluster).
 */
function checkUserViaSsh(user, password) {
  return new Promise(resolve => {
    const conn = new Client();
    let settled = false;

    const finish = result => {
      if (settled) return;
      settled = true;
      conn.end();
      resolve(result);
    };

    conn.on('ready', () => {
      conn.exec('id -u', (err, stream) => {
        if (err) {
          finish({ outcome: 'exists', isRoot: false });
          return;
        }
        let output = '';
        stream.on('data', data => { output += data.toString(); });
        stream.stderr.on('data', () => {});
        stream.on('close', () => {
          const uid = parseInt(output.trim(), 10);
          finish({ outcome: 'exists', isRoot: uid === 0 });
        });
      });
    });

    // Some SSH servers use keyboard-interactive instead of a plain password.
    conn.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish_kb) => {
      finish_kb(prompts.map(() => password));
    });

    conn.on('error', error => {
      // A rejected authentication means wrong user or password.
      // Anything else is a connectivity problem.
      const isAuthFailure = error?.level === 'client-authentication';
      finish(
        isAuthFailure
          ? { outcome: 'not_found' }
          : { outcome: 'unreachable', detail: error?.message ?? 'Error de conexión SSH' },
      );
    });

    try {
      conn.connect({
        host: SSH_HOST,
        port: SSH_PORT,
        username: user,
        password,
        tryKeyboard: true,
        readyTimeout: SSH_READY_TIMEOUT,
      });
    } catch (error) {
      finish({ outcome: 'unreachable', detail: error?.message ?? 'Error iniciando la conexión SSH' });
    }
  });
}

/**
 * Launches a job on the cluster over SSH using the user's credentials. Checks
 * the user can access the path before running it.
 *
 * scheduler_type: 'S' = SGE (qsub), 'H' = Hadoop (yarn jar)
 */
function launchJobViaSsh(user, password, { name, queue, path, pwd, options, scheduler_type }) {
  return new Promise(resolve => {
    const conn = new Client();
    let settled = false;

    // Safety timeout: if the SSH channel goes quiet for 30s, give up.
    const safetyTimer = setTimeout(() => {
      finish({ outcome: 'error', message: 'Tiempo de espera agotado al lanzar el trabajo' });
    }, 30000);

    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(safetyTimer);
      conn.end();
      resolve(result);
    };

    conn.on('ready', () => {
      // Resolve a relative path on the sidecar before sending it to the cluster.
      const absPath = path.startsWith('/') ? path : `${pwd.replace(/\/$/, '')}/${path}`;
      const cmd = buildPermCheckCmd(absPath, pwd, scheduler_type);

      conn.exec(cmd, (err, stream) => {
        if (err) {
          finish({ outcome: 'error', message: err.message });
          return;
        }

        stream.on('data', () => {});
        stream.stderr.on('data', () => {});
        stream.on('close', async code => {
          if (code === 1) {
            finish({ outcome: 'permission_denied', message: `ERROR: path does not exist: ${absPath}` });
            return;
          }
          if (code === 2) {
            finish({ outcome: 'permission_denied', message: `ERROR: permission denied (not readable): ${absPath} (user=${user})` });
            return;
          }
          if (code === 3) {
            finish({ outcome: 'permission_denied', message: `ERROR: permission denied (not executable): ${absPath} (user=${user})` });
            return;
          }
          if (code === 4) {
            finish({ outcome: 'permission_denied', message: `ERROR: permission denied (not writable): working directory ${pwd} (user=${user})` });
            return;
          }
          if (code !== 0) {
            finish({ outcome: 'error', message: `Error en el cluster (código ${code})` });
            return;
          }

          // Permissions checked. The owner is the SSH username — it can't be faked.
          try {
            const res = await fetch(`${API_URL}/jobs`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name, queue: Number(queue), owner: user,
                path: absPath, scheduler_type,
                options: options || '', qsub_options: '', pwd: pwd.replace(/\/$/, ''),
              }),
            });

            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              finish({ outcome: 'error', message: `API error ${res.status}: ${body.detail ?? ''}` });
              return;
            }

            const jobsRes = await fetch(`${API_URL}/jobs?owner=${encodeURIComponent(user)}`);
            if (jobsRes.ok) {
              const jobs = await jobsRes.json();
              const candidates = jobs.filter(j => j.name === name && j.owner === user);
              const jobId = candidates.length > 0
                ? Math.max(...candidates.map(j => j.id_ ?? 0))
                : 'UNKNOWN';
              finish({ outcome: 'submitted', output: `Trabajo enviado (JOB_ID=${jobId})` });
            } else {
              finish({ outcome: 'submitted', output: 'Trabajo enviado (JOB_ID=UNKNOWN)' });
            }
          } catch (apiErr) {
            finish({ outcome: 'error', message: `No se pudo contactar con la API: ${apiErr.message}` });
          }
        });
      });
    });

    // Some SSH servers use keyboard-interactive instead of a plain password.
    conn.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish_kb) => {
      finish_kb(prompts.map(() => password));
    });

    conn.on('error', error => {
      const isAuthFailure = error?.level === 'client-authentication';
      finish(
        isAuthFailure
          ? { outcome: 'auth_failed', message: 'Credenciales inválidas' }
          : { outcome: 'unreachable', message: error?.message ?? 'Error de conexión SSH' },
      );
    });

    try {
      conn.connect({
        host: SSH_HOST,
        port: SSH_PORT,
        username: user,
        password,
        tryKeyboard: true,
        readyTimeout: SSH_READY_TIMEOUT,
      });
    } catch (error) {
      finish({ outcome: 'unreachable', message: error?.message ?? 'Error iniciando la conexión SSH' });
    }
  });
}

/**
 * Updates an existing job over SSH using the user's credentials. Like the
 * launch, it checks the user has permissions on the resulting path/pwd before
 * applying the change, then calls `PUT /jobs/{id}?owner=user`. Only the fields
 * present in `changes` are forwarded (partial update).
 *
 * scheduler_type: 'S' = SGE, 'H' = Hadoop. Used only for the permission check.
 */
function updateJobViaSsh(user, password, { jobId, path, pwd, scheduler_type, changes }) {
  return new Promise(resolve => {
    const conn = new Client();
    let settled = false;

    const safetyTimer = setTimeout(() => {
      finish({ outcome: 'error', message: 'Tiempo de espera agotado al actualizar el trabajo' });
    }, 30000);

    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(safetyTimer);
      conn.end();
      resolve(result);
    };

    conn.on('ready', () => {
      const absPath = path.startsWith('/') ? path : `${pwd.replace(/\/$/, '')}/${path}`;
      const cmd = buildPermCheckCmd(absPath, pwd, scheduler_type);

      conn.exec(cmd, (err, stream) => {
        if (err) {
          finish({ outcome: 'error', message: err.message });
          return;
        }

        stream.on('data', () => {});
        stream.stderr.on('data', () => {});
        stream.on('close', async code => {
          if (code === 1) {
            finish({ outcome: 'permission_denied', message: `ERROR: path does not exist: ${absPath}` });
            return;
          }
          if (code === 2) {
            finish({ outcome: 'permission_denied', message: `ERROR: permission denied (not readable): ${absPath} (user=${user})` });
            return;
          }
          if (code === 3) {
            finish({ outcome: 'permission_denied', message: `ERROR: permission denied (not executable): ${absPath} (user=${user})` });
            return;
          }
          if (code === 4) {
            finish({ outcome: 'permission_denied', message: `ERROR: permission denied (not writable): working directory ${pwd} (user=${user})` });
            return;
          }
          if (code !== 0) {
            finish({ outcome: 'error', message: `Error en el cluster (código ${code})` });
            return;
          }

          // Permissions checked. Build the partial body with only the changed fields.
          const payload = {};
          if (typeof changes.name === 'string') payload.name = changes.name;
          if (Number.isInteger(changes.queue)) payload.queue = changes.queue;
          if (typeof changes.options === 'string') payload.options = changes.options;
          if (typeof changes.path === 'string') payload.path = absPath;

          // The owner is the SSH username — it can't be faked.
          try {
            const res = await fetch(`${API_URL}/jobs/${jobId}?owner=${encodeURIComponent(user)}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });

            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              finish({ outcome: 'api_error', status: res.status, message: body.detail ?? `API error ${res.status}` });
              return;
            }

            const body = await res.json().catch(() => ({}));
            finish({ outcome: 'updated', output: body.message ?? 'Trabajo actualizado correctamente' });
          } catch (apiErr) {
            finish({ outcome: 'error', message: `No se pudo contactar con la API: ${apiErr.message}` });
          }
        });
      });
    });

    // Some SSH servers use keyboard-interactive instead of a plain password.
    conn.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish_kb) => {
      finish_kb(prompts.map(() => password));
    });

    conn.on('error', error => {
      const isAuthFailure = error?.level === 'client-authentication';
      finish(
        isAuthFailure
          ? { outcome: 'auth_failed', message: 'Credenciales inválidas' }
          : { outcome: 'unreachable', message: error?.message ?? 'Error de conexión SSH' },
      );
    });

    try {
      conn.connect({
        host: SSH_HOST,
        port: SSH_PORT,
        username: user,
        password,
        tryKeyboard: true,
        readyTimeout: SSH_READY_TIMEOUT,
      });
    } catch (error) {
      finish({ outcome: 'unreachable', message: error?.message ?? 'Error iniciando la conexión SSH' });
    }
  });
}

/**
 * Launches the fixed guest job for the given scheduler type. No SSH, no
 * password: every value (except the type) comes from the sidecar's GUEST_JOBS
 * config, not from the client. Posts straight to the API /jobs with those fixed
 * values.
 */
async function launchGuestJob(schedulerType) {
  const job = GUEST_JOBS[schedulerType];
  const absPath = job.path.startsWith('/')
    ? job.path
    : `${job.pwd.replace(/\/$/, '')}/${job.path}`;
  try {
    const res = await fetch(`${API_URL}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: job.name, queue: job.queue, owner: GUEST_OWNER,
        path: absPath, scheduler_type: job.scheduler_type,
        options: job.options, qsub_options: '', pwd: job.pwd.replace(/\/$/, ''),
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { outcome: 'error', message: `API error ${res.status}: ${body.detail ?? ''}` };
    }

    const jobsRes = await fetch(`${API_URL}/jobs?owner=${encodeURIComponent(GUEST_OWNER)}`);
    if (jobsRes.ok) {
      const jobs = await jobsRes.json();
      const candidates = jobs.filter(j => j.name === job.name && j.owner === GUEST_OWNER);
      const jobId = candidates.length > 0
        ? Math.max(...candidates.map(j => j.id_ ?? 0))
        : 'UNKNOWN';
      return { outcome: 'submitted', output: `Trabajo enviado (JOB_ID=${jobId})` };
    }
    return { outcome: 'submitted', output: 'Trabajo enviado (JOB_ID=UNKNOWN)' };
  } catch (apiErr) {
    return { outcome: 'error', message: `No se pudo contactar con la API: ${apiErr.message}` };
  }
}

/**
 * Reads and parses the JSON body of a request. Caps the size to avoid abuse.
 */
function readJsonBody(req, maxBytes = 4096) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Cuerpo de la petición demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('JSON inválido'));
      }
    });

    req.on('error', reject);
  });
}

/**
 * Send a JSON response with the CORS headers. The allowed origin is resolved
 * per request against the allowlist; if it isn't allowed we leave out
 * Access-Control-Allow-Origin so the browser blocks the reply.
 */
function sendJson(req, res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extraHeaders,
  };
  const corsOrigin = resolveCorsOrigin(req);
  if (corsOrigin) {
    headers['Access-Control-Allow-Origin'] = corsOrigin;
    // If we echo a specific origin, the response varies by Origin.
    if (corsOrigin !== '*') headers['Vary'] = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(body);
}

const server = createServer(async (req, res) => {
  console.log(`[ssh-auth] ${req.method} ${req.url}`);

  if (req.method === 'OPTIONS') {
    sendJson(req, res, 204, {});
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(req, res, 200, { status: 'ok' });
    return;
  }

  // ── POST /auth/login ─────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/auth/login') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendJson(req, res, 400, { error: 'bad_request', message: error.message });
      return;
    }

    const ip = clientIp(req);
    const wait = loginGuard.retryAfter(ip);
    if (wait > 0) {
      const secs = Math.ceil(wait / 1000);
      sendJson(req, res, 429, { error: 'too_many_attempts', message: `Demasiados intentos. Espera ${secs}s.` }, { 'Retry-After': String(secs) });
      return;
    }

    const user = typeof body.user === 'string' ? body.user.trim() : '';
    if (!USERNAME_PATTERN.test(user)) {
      sendJson(req, res, 400, { error: 'invalid_user', message: 'Usuario inválido' });
      return;
    }

    const password = typeof body.password === 'string' ? body.password : '';

    const result = await checkUserViaSsh(user, password);
    console.log(`[ssh-auth] login "${user}" → outcome=${result.outcome}`);

    if (result.outcome === 'exists') {
      loginGuard.recordSuccess(ip);
      sendJson(req, res, 200, { exists: true, user, isRoot: result.isRoot ?? false });
      return;
    }

    if (result.outcome === 'not_found') {
      loginGuard.recordFailure(ip);
      sendJson(req, res, 200, { exists: false });
      return;
    }

    console.error(`[ssh-auth] Cluster inalcanzable al validar "${user}": ${result.detail}`);
    sendJson(req, res, 502, { error: 'cluster_unreachable', message: 'No se pudo contactar con el cluster' });
    return;
  }

  // ── POST /jobs/launch ────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/jobs/launch') {
    let body;
    try {
      body = await readJsonBody(req, 16384);
    } catch (error) {
      sendJson(req, res, 400, { error: 'bad_request', message: error.message });
      return;
    }

    const ip = clientIp(req);
    const wait = loginGuard.retryAfter(ip);
    if (wait > 0) {
      const secs = Math.ceil(wait / 1000);
      sendJson(req, res, 429, { error: 'too_many_attempts', message: `Demasiados intentos. Espera ${secs}s.` }, { 'Retry-After': String(secs) });
      return;
    }

    const user = typeof body.user === 'string' ? body.user.trim() : '';
    if (!USERNAME_PATTERN.test(user)) {
      sendJson(req, res, 400, { error: 'invalid_user', message: 'Usuario inválido' });
      return;
    }

    const password = typeof body.password === 'string' ? body.password : '';

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      sendJson(req, res, 400, { error: 'invalid_name', message: 'Nombre del trabajo requerido' });
      return;
    }

    const queue = Number(body.queue);
    if (!Number.isInteger(queue) || queue <= 0) {
      sendJson(req, res, 400, { error: 'invalid_queue', message: 'ID de cola inválido' });
      return;
    }

    const path = typeof body.path === 'string' ? body.path.trim() : '';
    if (!path) {
      sendJson(req, res, 400, { error: 'invalid_path', message: 'Ruta del script requerida' });
      return;
    }

    const pwd = typeof body.pwd === 'string' ? body.pwd.trim() : '';
    if (!pwd) {
      sendJson(req, res, 400, { error: 'invalid_pwd', message: 'Directorio de trabajo requerido' });
      return;
    }

    const scheduler_type = typeof body.scheduler_type === 'string' ? body.scheduler_type : '';
    if (scheduler_type !== 'S' && scheduler_type !== 'H') {
      sendJson(req, res, 400, { error: 'invalid_scheduler_type', message: 'scheduler_type debe ser S o H' });
      return;
    }

    const options = typeof body.options === 'string' ? body.options : '';

    const result = await launchJobViaSsh(user, password, { name, queue, path, pwd, options, scheduler_type });
    console.log(`[ssh-auth] launch "${user}" path=${path} → outcome=${result.outcome}${result.message ? ' msg=' + result.message : ''}`);

    if (result.outcome === 'submitted') {
      loginGuard.recordSuccess(ip);
      sendJson(req, res, 200, { message: result.output || 'Trabajo enviado correctamente' });
      return;
    }

    if (result.outcome === 'permission_denied') {
      loginGuard.recordSuccess(ip); // creds were valid, only the file perms failed
      sendJson(req, res, 403, { error: 'permission_denied', message: result.message });
      return;
    }

    if (result.outcome === 'auth_failed') {
      loginGuard.recordFailure(ip);
      sendJson(req, res, 401, { error: 'auth_failed', message: result.message ?? 'Credenciales inválidas' });
      return;
    }

    if (result.outcome === 'unreachable') {
      console.error(`[ssh-auth] Cluster inalcanzable al lanzar trabajo de "${user}": ${result.message}`);
      sendJson(req, res, 502, { error: 'cluster_unreachable', message: 'No se pudo contactar con el cluster' });
      return;
    }

    console.error(`[ssh-auth] Error al lanzar trabajo de "${user}": ${result.message}`);
    sendJson(req, res, 500, { error: 'launch_error', message: result.message ?? 'Error al lanzar el trabajo' });
    return;
  }

  // ── POST /jobs/update ────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/jobs/update') {
    let body;
    try {
      body = await readJsonBody(req, 16384);
    } catch (error) {
      sendJson(req, res, 400, { error: 'bad_request', message: error.message });
      return;
    }

    const ip = clientIp(req);
    const wait = loginGuard.retryAfter(ip);
    if (wait > 0) {
      const secs = Math.ceil(wait / 1000);
      sendJson(req, res, 429, { error: 'too_many_attempts', message: `Demasiados intentos. Espera ${secs}s.` }, { 'Retry-After': String(secs) });
      return;
    }

    const user = typeof body.user === 'string' ? body.user.trim() : '';
    if (!USERNAME_PATTERN.test(user)) {
      sendJson(req, res, 400, { error: 'invalid_user', message: 'Usuario inválido' });
      return;
    }

    const password = typeof body.password === 'string' ? body.password : '';

    const validation = validateUpdateBody(body);
    if (validation.error) {
      sendJson(req, res, 400, { error: validation.error, message: validation.message });
      return;
    }

    const result = await updateJobViaSsh(user, password, validation.params);
    console.log(`[ssh-auth] update "${user}" job=${validation.params.jobId} → outcome=${result.outcome}${result.message ? ' msg=' + result.message : ''}`);
    // Feed the attempt into the brute-force guard.
    if (result.outcome === 'auth_failed') loginGuard.recordFailure(ip);
    else if (result.outcome === 'updated' || result.outcome === 'permission_denied') loginGuard.recordSuccess(ip);
    respondUpdate(req, res, user, result);
    return;
  }

  // ── POST /jobs/launch-guest ──────────────────────────────────────────────
  // Fixed guest job: no SSH, no password. Only scheduler_type is read from the
  // body (validated to 'S' or 'H'); everything else comes from the server's
  // GUEST_JOBS config (see the security note next to GUEST_*).
  if (req.method === 'POST' && req.url === '/jobs/launch-guest') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendJson(req, res, 400, { error: 'bad_request', message: error.message });
      return;
    }

    // No auth on this endpoint, so limit per IP — otherwise someone could spam
    // the guest job and flood the cluster.
    const { allowed, retryAfterMs } = guestLimiter.allow(clientIp(req));
    if (!allowed) {
      const secs = Math.ceil(retryAfterMs / 1000);
      sendJson(req, res, 429, { error: 'too_many_requests', message: `Demasiadas peticiones. Espera ${secs}s.` }, { 'Retry-After': String(secs) });
      return;
    }

    const schedulerType = typeof body.scheduler_type === 'string' ? body.scheduler_type : '';
    if (schedulerType !== 'S' && schedulerType !== 'H') {
      sendJson(req, res, 400, { error: 'invalid_scheduler_type', message: 'scheduler_type debe ser S o H' });
      return;
    }

    const job = GUEST_JOBS[schedulerType];
    if (!job.path || !job.pwd || !Number.isInteger(job.queue) || job.queue <= 0) {
      console.error(`[ssh-auth] launch-guest (${schedulerType}) mal configurado (faltan PATH/PWD/QUEUE)`);
      sendJson(req, res, 500, { error: 'guest_misconfigured', message: 'El trabajo de invitado no está configurado en el servidor' });
      return;
    }

    const result = await launchGuestJob(schedulerType);
    console.log(`[ssh-auth] launch-guest type=${schedulerType} owner=${GUEST_OWNER} path=${job.path} → outcome=${result.outcome}${result.message ? ' msg=' + result.message : ''}`);

    if (result.outcome === 'submitted') {
      sendJson(req, res, 200, { message: result.output || 'Trabajo enviado correctamente' });
      return;
    }

    console.error(`[ssh-auth] Error al lanzar trabajo de invitado: ${result.message}`);
    sendJson(req, res, 500, { error: 'launch_error', message: result.message ?? 'Error al lanzar el trabajo' });
    return;
  }

  sendJson(req, res, 404, { error: 'not_found' });
});

/**
 * Validates and normalizes the body of a job update request. Returns
 * `{ error, message }` if invalid, or `{ params }` ready for updateJobViaSsh.
 */
function validateUpdateBody(body) {
  const jobId = Number(body.jobId);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    return { error: 'invalid_job_id', message: 'ID de trabajo inválido' };
  }

  const path = typeof body.path === 'string' ? body.path.trim() : '';
  if (!path) {
    return { error: 'invalid_path', message: 'Ruta del script requerida' };
  }

  const pwd = typeof body.pwd === 'string' ? body.pwd.trim() : '';
  if (!pwd) {
    return { error: 'invalid_pwd', message: 'Directorio de trabajo requerido' };
  }

  const scheduler_type = typeof body.scheduler_type === 'string' ? body.scheduler_type : '';
  if (scheduler_type !== 'S' && scheduler_type !== 'H') {
    return { error: 'invalid_scheduler_type', message: 'scheduler_type debe ser S o H' };
  }

  const rawChanges = body.changes && typeof body.changes === 'object' ? body.changes : {};
  const changes = {};
  if (typeof rawChanges.name === 'string') changes.name = rawChanges.name.trim();
  if (typeof rawChanges.options === 'string') changes.options = rawChanges.options;
  if (typeof rawChanges.path === 'string') changes.path = rawChanges.path.trim();
  if (rawChanges.queue !== undefined) {
    const queue = Number(rawChanges.queue);
    if (Number.isInteger(queue) && queue > 0) changes.queue = queue;
  }

  if (Object.keys(changes).length === 0) {
    return { error: 'no_changes', message: 'No hay cambios que aplicar' };
  }

  return { params: { jobId, path, pwd, scheduler_type, changes } };
}

/**
 * Maps the updateJobViaSsh outcome to an HTTP response.
 */
function respondUpdate(req, res, user, result) {
  if (result.outcome === 'updated') {
    sendJson(req, res, 200, { message: result.output || 'Trabajo actualizado correctamente' });
    return;
  }
  if (result.outcome === 'permission_denied') {
    sendJson(req, res, 403, { error: 'permission_denied', message: result.message });
    return;
  }
  if (result.outcome === 'auth_failed') {
    sendJson(req, res, 401, { error: 'auth_failed', message: result.message ?? 'Credenciales inválidas' });
    return;
  }
  if (result.outcome === 'api_error') {
    sendJson(req, res, result.status ?? 400, { error: 'api_error', message: result.message });
    return;
  }
  if (result.outcome === 'unreachable') {
    console.error(`[ssh-auth] Cluster inalcanzable al actualizar trabajo de "${user}": ${result.message}`);
    sendJson(req, res, 502, { error: 'cluster_unreachable', message: 'No se pudo contactar con el cluster' });
    return;
  }
  console.error(`[ssh-auth] Error al actualizar trabajo de "${user}": ${result.message}`);
  sendJson(req, res, 500, { error: 'update_error', message: result.message ?? 'Error al actualizar el trabajo' });
}

server.listen(PORT, () => {
  console.log(`[ssh-auth] Escuchando en http://localhost:${PORT} → SSH ${SSH_HOST}:${SSH_PORT}`);
});
