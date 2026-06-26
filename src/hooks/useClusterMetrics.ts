import { useState } from 'react';
import { getApiErrorMessage, nodesService } from '../api/cgroups.api';
import type { ClusterNodeMetric } from '../types/metrics.types';
import { usePolling } from './usePolling';

export function useClusterMetrics() {
  const [metrics, setMetrics] = useState<ClusterNodeMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await nodesService.getMetrics();
      setMetrics(data);
      setError(null);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Error al cargar las métricas del clúster'));
    } finally {
      setLoading(false);
    }
  };

  usePolling(refresh, 15000);

  return { metrics, loading, error };
}
