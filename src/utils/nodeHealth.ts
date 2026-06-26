// Represents the three possible health states of a cluster node.
export type NodeHealthState = 'alive' | 'down' | 'unknown';

// null means we never got a heartbeat back, hence 'unknown'
export function getNodeHealthState(isAlive: boolean | null): NodeHealthState {
  if (isAlive === true) {
    return 'alive';
  }

  if (isAlive === false) {
    return 'down';
  }

  return 'unknown';
}

export function getNodeHealthLabel(isAlive: boolean | null): string {
  const state = getNodeHealthState(isAlive);

  if (state === 'alive') {
    return 'vivo';
  }

  if (state === 'down') {
    return 'caido';
  }

  return 'desconocido';
}
