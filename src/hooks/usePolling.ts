import { useEffect, useRef, type DependencyList } from 'react';

export function usePolling(fn: () => void, intervalMs: number, enabled = true, deps: DependencyList = []) {
  // keep the latest fn in a ref so the interval doesn't capture a stale closure
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;
    fnRef.current();
    const id = setInterval(() => fnRef.current(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled, ...deps]);
}
