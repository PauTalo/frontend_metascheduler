import { useState } from 'react';
import { getApiErrorMessage, jobsService } from '../api/cgroups.api';
import type { Job, JobStatus } from '../types/job.types';
import { usePolling } from './usePolling';

interface UseJobsFilters {
  status?: JobStatus;
  queue?: number;
  enabled?: boolean;
}

export function useJobs(owner: string, filters: UseJobsFilters = {}) {
  const { status, queue, enabled = true } = filters;
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const data = await jobsService.getAll(owner, status, queue);
      setJobs(data);
      setError(null);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'No se pudo conectar con la API Metascheduler'));
    } finally {
      setLoading(false);
    }
  };

  usePolling(refresh, 5000, enabled, [owner, status, queue]);

  return { jobs, loading, error, refresh };
}
