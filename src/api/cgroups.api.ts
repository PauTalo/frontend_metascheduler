import { ApiRequestError, apiClient } from './client';
import type {
  ApiMessage,
  ApiStatus,
  ClusterMode,
  ClusterModeResponse,
  Job,
  JobStatus,
  Node,
  Queue,
} from '../types/job.types';
import type { ClusterNodeMetric, JobMetric, JobNodeMetric } from '../types/metrics.types';

type ClusterModeApiResponse = ClusterMode | ClusterModeResponse;

interface ApiValidationDetail {
  detail?: Array<{
    loc?: Array<string | number>;
    msg?: string;
  }> | string;
}

function isApiMessage(value: unknown): value is ApiMessage {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'message' in value &&
      typeof value.message === 'string',
  );
}

function isApiValidationDetail(value: unknown): value is ApiValidationDetail {
  return Boolean(value && typeof value === 'object' && 'detail' in value);
}

// FastAPI returns validation errors under `detail`, either a string or a list of issues
function getValidationErrorMessage(value: ApiValidationDetail) {
  if (typeof value.detail === 'string') {
    return value.detail;
  }

  if (Array.isArray(value.detail) && value.detail.length > 0) {
    const [firstIssue] = value.detail;
    const location = firstIssue.loc?.join('.') ?? '';

    if (firstIssue.msg && location) {
      return `${firstIssue.msg} (${location})`;
    }

    return firstIssue.msg ?? null;
  }

  return null;
}

// the endpoint sometimes returns a bare string and sometimes { mode: string }
function extractClusterMode(response: ClusterModeApiResponse): ClusterMode {
  if (typeof response === 'string') {
    return response;
  }

  return response.mode;
}

export function getApiErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError) {
    if (isApiMessage(error.data)) {
      return error.data.message;
    }

    if (isApiValidationDetail(error.data)) {
      return getValidationErrorMessage(error.data) ?? error.message ?? fallback;
    }

    return error.message || fallback;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

export const statusService = {
  get: () => apiClient.get<ApiStatus>('/status'),
};

export const jobsService = {
  getAll: (owner: string, status?: JobStatus, queue?: number) =>
    apiClient.get<Job[]>('/jobs', { params: { owner, status, queue } }),

  getById: (jobId: number, owner: string) =>
    apiClient.get<Job>(`/jobs/${jobId}`, { params: { owner } }),

  delete: (jobId: number, owner: string) =>
    apiClient.delete<ApiMessage>(`/jobs/${jobId}`, { params: { owner } }),
};

export const clusterService = {
  getMode: () =>
    apiClient.get<ClusterModeApiResponse>('/cluster/mode').then(extractClusterMode),

  setMode: (user: string, mode: ClusterMode) =>
    apiClient.put<void>('/cluster/mode', { user, mode }),
};

export const nodesService = {
  getAll: () => apiClient.get<Node[]>('/cluster/nodes'),

  getMaster: () => apiClient.get<Node>('/cluster/nodes/master'),

  getMetrics: () => apiClient.get<ClusterNodeMetric[]>('/cluster/nodes/metrics'),
};

export const queuesService = {
  getAll: () => apiClient.get<Queue[]>('/queues'),
};

export const metricsService = {
  getJobMetrics: (jobId: number, owner: string) =>
    apiClient.get<JobMetric[]>(`/jobs/${jobId}/metrics`, { params: { owner } }),

  getJobNodeMetrics: (jobId: number, owner: string) =>
    apiClient.get<JobNodeMetric[]>(`/jobs/${jobId}/metrics/nodes`, { params: { owner } }),
};
