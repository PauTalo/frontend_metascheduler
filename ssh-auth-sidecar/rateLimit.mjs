// Simple in-memory rate limiters. The sidecar is basically an SSH auth proxy
// over HTTP, so without a server-side limit anyone who reaches POST /auth/login
// can brute-force passwords forever (the browser throttle in localStorage is
// trivial to skip with curl). These keep a counter per key — the client IP in
// practice — and block once it goes over the limit.
//
// State lives in memory in a single process, which is fine for one sidecar. If
// we ever run several replicas this would need a shared store like Redis.

/**
 * Brute-force guard for the credential flows (login / launch / update). Counts
 * auth failures per key inside a sliding window and locks for `lockMs` once
 * `maxFails` is hit. A success clears the counter.
 */
export function createLoginGuard({ maxFails = 5, lockMs = 15 * 60_000, windowMs = 15 * 60_000 } = {}) {
  /** @type {Map<string, { fails: number, firstAt: number, lockedUntil: number }>} */
  const attempts = new Map();

  // Drop stale entries now and then so the Map can't grow forever. unref() keeps
  // this timer from holding the process open on its own.
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, s] of attempts) {
      if (s.lockedUntil <= now && now - s.firstAt > windowMs) attempts.delete(key);
    }
  }, windowMs);
  timer.unref?.();

  return {
    /** Milliseconds of lock left for `key` (0 means it can try again). */
    retryAfter(key) {
      const s = attempts.get(key);
      return s ? Math.max(0, s.lockedUntil - Date.now()) : 0;
    },

    /** Record a failed attempt; locks once `maxFails` is reached. */
    recordFailure(key) {
      const now = Date.now();
      const s = attempts.get(key) ?? { fails: 0, firstAt: now, lockedUntil: 0 };
      if (now - s.firstAt > windowMs) { s.fails = 0; s.firstAt = now; } // window expired, start over
      s.fails += 1;
      if (s.fails >= maxFails) s.lockedUntil = now + lockMs;
      attempts.set(key, s);
    },

    /** Clear the counter after a successful auth. */
    recordSuccess(key) {
      attempts.delete(key);
    },
  };
}

/**
 * Fixed-window rate limiter for endpoints with no auth (e.g. the guest launch):
 * at most `max` requests per `windowMs` and key. Stops someone from flooding the
 * cluster with guest jobs.
 */
export function createRateLimiter({ max = 10, windowMs = 60_000 } = {}) {
  /** @type {Map<string, { count: number, resetAt: number }>} */
  const hits = new Map();

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, s] of hits) {
      if (now > s.resetAt) hits.delete(key);
    }
  }, windowMs);
  timer.unref?.();

  return {
    /** Returns `{ allowed, retryAfterMs }` and counts the request. */
    allow(key) {
      const now = Date.now();
      const s = hits.get(key);
      if (!s || now > s.resetAt) {
        hits.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, retryAfterMs: 0 };
      }
      s.count += 1;
      if (s.count > max) return { allowed: false, retryAfterMs: s.resetAt - now };
      return { allowed: true, retryAfterMs: 0 };
    },
  };
}
