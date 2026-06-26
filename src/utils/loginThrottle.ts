const KEY = 'login-attempts';
const MAX_ATTEMPTS = 5;
// Matches the sidecar default (LOGIN_LOCK_MS = 15 min) so the local and server
// locks don't disagree. The server is the source of truth: if they ever drift,
// setLockFor() reconciles with the Retry-After from the 429.
const LOCK_MS = 15 * 60_000;

type State = { fails: number; lockedUntil: number };

function read(): State {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '');
    if (parsed && typeof parsed.fails === 'number' && typeof parsed.lockedUntil === 'number') {
      return parsed;
    }
  } catch {
    // ignore malformed/empty storage
  }
  return { fails: 0, lockedUntil: 0 };
}

function write(s: State) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

/** Milliseconds of lock left, 0 if the user can try again. */
export function lockRemainingMs(): number {
  return Math.max(0, read().lockedUntil - Date.now());
}

/** Count a failed password attempt; locks once MAX_ATTEMPTS is reached. */
export function registerFail(): void {
  const s = read();
  const fails = s.fails + 1;
  write({ fails, lockedUntil: fails >= MAX_ATTEMPTS ? Date.now() + LOCK_MS : 0 });
}

/** Reset the counter after a successful login. */
export function resetAttempts(): void {
  write({ fails: 0, lockedUntil: 0 });
}

/**
 * Mirror the lock the server (sidecar) imposes, in ms. Called on a 429: the
 * server is the one that decides, so the UI countdown should reflect its
 * Retry-After rather than the local counter.
 */
export function setLockFor(ms: number): void {
  write({ fails: MAX_ATTEMPTS, lockedUntil: Date.now() + ms });
}
