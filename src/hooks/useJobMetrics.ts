import { useState } from 'react';
import { getApiErrorMessage, metricsService } from '../api/cgroups.api';
import type { JobMetric, JobNodeMetric } from '../types/metrics.types';
import { usePolling } from './usePolling';

export function useJobMetrics(jobId: number | null, owner: string) {
  const [metrics, setMetrics] = useState<JobMetric[]>([]);
  const [nodeMetrics, setNodeMetrics] = useState<JobNodeMetric[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!jobId) {
      setMetrics([]);
      setNodeMetrics([]);
      return;
    }
    setLoading(true);
    try {
      const jobMetrics = await metricsService.getJobMetrics(jobId, owner);
      setMetrics(jobMetrics);
      const jobNodeMetrics = await metricsService.getJobNodeMetrics(jobId, owner);
      setNodeMetrics(jobNodeMetrics);
      setError(null);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Error al cargar las métricas'));
      setMetrics([]);
      setNodeMetrics([]);
    } finally {
      setLoading(false);
    }
  };

  usePolling(refresh, 10000, jobId !== null, [jobId, owner]);

  return { metrics, nodeMetrics, loading, error, refresh };
}
