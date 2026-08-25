export function createLoginRateLimiter({ windowMs, maxAttempts, now = () => Date.now() }) {
  const attempts = new Map();

  function keyFor(ip, email) {
    return `${String(ip || "unknown")}:${String(email || "").trim().toLowerCase()}`;
  }

  function state(ip, email) {
    const key = keyFor(ip, email);
    const currentTime = now();
    const entry = attempts.get(key);
    if (!entry || currentTime - entry.startedAt >= windowMs) {
      if (entry) attempts.delete(key);
      return { blocked: false, retryAfterSeconds: 0 };
    }
    return {
      blocked: entry.failures >= maxAttempts,
      retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (currentTime - entry.startedAt)) / 1000))
    };
  }

  function recordFailure(ip, email) {
    const key = keyFor(ip, email);
    const currentTime = now();
    const entry = attempts.get(key);
    if (!entry || currentTime - entry.startedAt >= windowMs) {
      attempts.set(key, { startedAt: currentTime, failures: 1 });
      return;
    }
    entry.failures += 1;
  }

  function clear(ip, email) {
    attempts.delete(keyFor(ip, email));
  }

  return { state, recordFailure, clear };
}
